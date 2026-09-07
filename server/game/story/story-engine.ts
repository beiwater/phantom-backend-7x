import { db } from '../../db/database.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { socialRepository } from '../../repositories/social-repository.ts';
import { getCompanyById, updateCompanyMoney, updateCompanySimBoosts } from '../company.ts';
import { addResource } from '../warehouse.ts';
import { broadcastAll, broadcastToCompany } from '../../ws/websocket.ts';
import { storyLoader } from './story-loader.ts';
import type { PlayerStoryStateRow, StoryChoice, StoryStage, StoryJson } from './types.ts';

function interpolateTemplate(text: string, companyName: string): string {
  if (!text) return '';
  return text
    // Replace explicit mentions with player's company name
    .replace(/@\{\{company(?:Name)?\}\}/gi, `@${companyName}`)
    .replace(/@\{\{player(?:Name)?\}\}/gi, `@${companyName}`)
    .replace(/@玩家/g, `@${companyName}`)
    .replace(/@你/g, `@${companyName}`)
    // Replace non-mention company name placeholders
    .replace(/\{\{company(?:Name)?\}\}/gi, companyName)
    .replace(/\{\{player(?:Name)?\}\}/gi, companyName)
    // Strip redundant 【角色名】 prefix if present
    .replace(/^【[^】]+】\s*/, '');
}

export class StoryEngine {
  public getStoryState(companyId: number): PlayerStoryStateRow | null {
    try {
      const row = db.prepare(`
        SELECT * FROM player_story_state WHERE company_id = ?
      `).get(companyId) as unknown as PlayerStoryStateRow | undefined;
      return row || null;
    } catch {
      return null;
    }
  }

  public async startStory(companyId: number, storyId: string): Promise<{ success: boolean; message: string }> {
    const story = storyLoader.getStory(storyId);
    if (!story) {
      return { success: false, message: `未找到剧本 "${storyId}"，输入 /story 查看可用剧本。` };
    }

    const stageConfig = story.stages[story.initialStage];
    if (!stageConfig) {
      return { success: false, message: `剧本 "${storyId}" 初始阶段 "${story.initialStage}" 配置无效。` };
    }

    const now = virtualClock.nowIso();
    db.prepare(`
      INSERT INTO player_story_state (company_id, story_id, current_stage, status, choices_history, ending_id, updated_at, created_at)
      VALUES (?, ?, ?, 'active', '[]', NULL, ?, ?)
      ON CONFLICT(company_id) DO UPDATE SET
        story_id = excluded.story_id,
        current_stage = excluded.current_stage,
        status = 'active',
        choices_history = '[]',
        ending_id = NULL,
        updated_at = excluded.updated_at
    `).run(companyId, story.id, story.initialStage, now, now);

    // Execute initial stage
    await this.executeStage(companyId, story, story.initialStage, stageConfig);

    return {
      success: true,
      message: `成功启动剧本【${story.title}】！专属频道与关键私信已推送，请前往聊天区查看。`
    };
  }

  public async advanceStoryChoice(
    companyId: number,
    storyId: string,
    choiceIndex: number
  ): Promise<{ success: boolean; done: boolean; message?: string }> {
    const state = this.getStoryState(companyId);
    if (!state || state.status !== 'active' || state.story_id !== storyId) {
      return { success: false, done: true, message: '当前没有正在进行中的该剧本。' };
    }

    const story = storyLoader.getStory(storyId);
    if (!story) {
      return { success: false, done: true, message: '剧本配置未找到。' };
    }

    const stageConfig = story.stages[state.current_stage];
    if (!stageConfig || !Array.isArray(stageConfig.choices) || !stageConfig.choices[choiceIndex]) {
      return { success: false, done: true, message: '无效的抉择选项。' };
    }

    const chosen = stageConfig.choices[choiceIndex];

    // 1. Apply economic rewards / costs
    if (chosen.reward) {
      this.applyReward(companyId, chosen.reward);
    }

    // 2. Append history
    let history: Array<{ stage: string; choiceIndex: number; text: string }> = [];
    try {
      history = JSON.parse(state.choices_history);
      if (!Array.isArray(history)) history = [];
    } catch {
      history = [];
    }
    history.push({ stage: state.current_stage, choiceIndex, text: chosen.text });

    const nextStageName = chosen.nextStage;
    const nextStageConfig = story.stages[nextStageName];
    const now = virtualClock.nowIso();

    if (!nextStageConfig) {
      // Transition error fallback
      db.prepare(`
        UPDATE player_story_state SET status = 'completed', updated_at = ? WHERE company_id = ?
      `).run(now, companyId);
      return { success: true, done: true, message: '剧本演绎已结束。' };
    }

    // Update state
    const isEnding = Boolean(nextStageConfig.ending);
    db.prepare(`
      UPDATE player_story_state
      SET current_stage = ?,
          status = ?,
          choices_history = ?,
          ending_id = ?,
          updated_at = ?
      WHERE company_id = ?
    `).run(
      nextStageName,
      isEnding ? 'completed' : 'active',
      JSON.stringify(history),
      isEnding ? (nextStageConfig.ending?.id || null) : null,
      now,
      companyId
    );

    // 3. Execute next stage
    await this.executeStage(companyId, story, nextStageName, nextStageConfig);

    return { success: true, done: true };
  }

  public async resetStory(companyId: number, storyId?: string): Promise<{ success: boolean; message: string }> {
    if (storyId) {
      db.prepare(`DELETE FROM player_story_state WHERE company_id = ? AND story_id = ?`).run(companyId, storyId);
    } else {
      db.prepare(`DELETE FROM player_story_state WHERE company_id = ?`).run(companyId);
    }
    return { success: true, message: '剧本进度已重置。' };
  }

  private async executeStage(companyId: number, story: StoryJson, stageName: string, stage: StoryStage): Promise<void> {
    const comp = getCompanyById(companyId);
    const companyName = comp?.name || `公司-${companyId}`;
    const now = virtualClock.nowIso();
    const roomCode = `story_${companyId}`;

    // 1. Post group messages to dedicated story chatroom
    if (Array.isArray(stage.groupMessages)) {
      for (const gm of stage.groupMessages) {
        const char = storyLoader.getStoryCharacter(gm.characterId) || {
          id: gm.characterId,
          name: `NPC-${gm.characterId}`,
          logo: '/static/images/faces/male_01/1.png',
          realmId: 0
        };

        const interpolatedText = interpolateTemplate(gm.text, companyName);
        const msgId = socialRepository.insertChatMessage(roomCode, char.id, char.name, interpolatedText, now);
        const formatted = {
          id: msgId,
          sender: {
            id: char.id,
            company: char.name,
            realmId: char.realmId ?? 0,
            logo: char.logo,
            moderatorSign: false,
            certificates: 0,
            contest_wins: 0,
            supporter: true,
            justStarted: false
          },
          chatroom: roomCode,
          chatroom_name: '商界风云·演绎',
          realms_shared: false,
          datetime: now,
          body: gm.text,
          chatroom_logo: '/chat-icon/005F73/roleplay.png',
          ban_notification: false,
          pinned: false,
          invisible: false,
          retracted: false,
          deleted: false,
          isHtml: true
        };
        broadcastAll('NEW_MESSAGE', formatted);
      }
    }

    // 2. Post private message with choices if present
    if (stage.privateMessage && Array.isArray(stage.choices) && stage.choices.length > 0) {
      const pm = stage.privateMessage;
      const char = storyLoader.getStoryCharacter(pm.characterId) || {
        id: pm.characterId,
        name: `NPC-${pm.characterId}`,
        logo: '/static/images/personal-assistant/old/portrait.c8f2f2549a1d.png',
        realmId: 0
      };

      const choiceLinks = stage.choices.map((c, idx) => {
        const cleanChoiceText = interpolateTemplate(c.text, companyName);
        return `<a class="pa-reply" href="/pa-action/${story.id}/${idx}/"><i class="fa fa-arrow-right"></i> ${cleanChoiceText}</a>`;
      }).join('<br/><br/>');

      const cleanTitle = pm.title ? interpolateTemplate(pm.title, companyName) : '';
      const cleanText = interpolateTemplate(pm.text, companyName);
      const fullHtml = `<div>${cleanTitle ? `<b>${cleanTitle}</b><br/><br/>` : ''}${cleanText}<br/><br/>${choiceLinks}</div>`;

      const msgId = socialRepository.insertDirectMessage(char.id, companyId, fullHtml, now);
      const dmFormatted = {
        id: msgId,
        sender: {
          id: char.id,
          company: char.name,
          logo: char.logo,
          certificates: 0,
          supporter: true,
          realmId: char.realmId ?? 0
        },
        receiver: {
          id: companyId,
          company: comp?.name || '',
          logo: comp?.logo || '',
          certificates: 0,
          supporter: false,
          realmId: comp?.realm_id ?? 0
        },
        body: fullHtml,
        text: fullHtml,
        datetime: now,
        pinned: false,
        isHtml: true
      };
      broadcastToCompany(companyId, dmFormatted);
      broadcastAll('NEW_MESSAGE', dmFormatted);
    }

    // 3. Handle Ending if present
    if (stage.ending) {
      const ending = stage.ending;
      if (ending.finalBonus) {
        this.applyReward(companyId, ending.finalBonus);
      }

      const endingText = `🎉【剧本通关】恭喜达成《${story.title}》${ending.title}！\n${interpolateTemplate(ending.evaluation || '', companyName)}`;
      socialRepository.insertChatMessage(roomCode, 0, '系统旁白', endingText, now);
      const endingGroupFormatted = {
        id: Date.now(),
        sender: {
          id: 0,
          company: '系统旁白',
          realmId: 0,
          logo: '/static/images/personal-assistant/old.png',
          moderatorSign: true,
          certificates: 0,
          contest_wins: 0,
          supporter: true,
          justStarted: false
        },
        chatroom: roomCode,
        chatroom_name: '商界风云·演绎',
        realms_shared: false,
        datetime: now,
        body: endingText,
        chatroom_logo: '/chat-icon/005F73/roleplay.png',
        ban_notification: false,
        pinned: false,
        invisible: false,
        retracted: false,
        deleted: false,
        isHtml: false
      };
      broadcastAll('NEW_MESSAGE', endingGroupFormatted);

      // DM ending confirmation
      const dmEndingHtml = `<div><b>🏆 剧本达成：${ending.title}</b><br/><br/>${ending.evaluation || ''}<br/><br/><i>输入 /story 可查看剧本状态或重新开始体验其他分支结局。</i></div>`;
      const dmMsgId = socialRepository.insertDirectMessage(0, companyId, dmEndingHtml, now);
      const dmEndingFormatted = {
        id: dmMsgId,
        sender: {
          id: 0,
          company: '个人助理',
          logo: '/static/images/personal-assistant/old.png',
          certificates: 0,
          supporter: true,
          realmId: 0
        },
        receiver: {
          id: companyId,
          company: comp?.name || '',
          logo: comp?.logo || '',
          certificates: 0,
          supporter: false,
          realmId: comp?.realm_id ?? 0
        },
        body: dmEndingHtml,
        text: dmEndingHtml,
        datetime: now,
        pinned: false,
        isHtml: true
      };
      broadcastToCompany(companyId, dmEndingFormatted);
      broadcastAll('NEW_MESSAGE', dmEndingFormatted);
    }
  }

  private applyReward(companyId: number, reward: { money?: number; simboosts?: number; resources?: Array<{ resourceId: number; amount: number; quality?: number }> }): void {
    if (typeof reward.money === 'number' && reward.money !== 0) {
      updateCompanyMoney(companyId, reward.money);
    }
    if (typeof reward.simboosts === 'number' && reward.simboosts !== 0) {
      updateCompanySimBoosts(companyId, reward.simboosts);
    }
    if (Array.isArray(reward.resources)) {
      for (const res of reward.resources) {
        if (res.resourceId && res.amount > 0) {
          addResource(companyId, res.resourceId, res.quality || 0, res.amount);
        }
      }
    }
  }
}

export const storyEngine = new StoryEngine();
