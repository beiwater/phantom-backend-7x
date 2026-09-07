import type { CommandDefinition, CommandResult, CommandContext } from '../types.ts';
import { storyLoader } from '../../story/story-loader.ts';
import { storyEngine } from '../../story/story-engine.ts';

export const storyCommand: CommandDefinition = {
  name: 'story',
  aliases: ['plot', 'drama', '剧本'],
  description: '剧本演绎互动指令，查看剧本列表、开启商战剧本或重置剧情',
  usage: '/story [start <id> | reset | reload | list]',
  requireOp: false,
  handler: async (args: string[], ctx: CommandContext): Promise<CommandResult> => {
    const companyId = ctx.executorCompanyId;
    if (!companyId) {
      return {
        success: false,
        message: 'Only authenticated companies can participate in story mode.',
        assistantReply: '老板，需要登录公司账号才能参与剧本演绎。'
      };
    }

    const sub = (args[0] || '').toLowerCase();

    // 1. /story reload (hot reload story JSON files)
    if (sub === 'reload') {
      storyLoader.reloadStories();
      const stories = storyLoader.listStories();
      const reply = `已重载所有剧本 JSON 配置，当前可用剧本共 ${stories.length} 个：\n${stories.map(s => `• ${s.id}: ${s.title}`).join('\n')}`;
      return { success: true, message: reply, assistantReply: reply };
    }

    // 2. /story reset
    if (sub === 'reset') {
      const targetId = args[1];
      const res = await storyEngine.resetStory(companyId, targetId);
      return { success: true, message: res.message, assistantReply: `老板，${res.message}` };
    }

    // 3. /story start <id>
    if (sub === 'start') {
      const targetId = args[1] || 'dragon_return';
      const res = await storyEngine.startStory(companyId, targetId);
      return {
        success: res.success,
        message: res.message,
        assistantReply: `老板，${res.message}`
      };
    }

    // 4. Default: /story or /story list
    const stories = storyLoader.listStories();
    const currentState = storyEngine.getStoryState(companyId);
    let stateInfo = '当前暂无进行中的剧本。';
    if (currentState) {
      const activeStory = storyLoader.getStory(currentState.story_id);
      stateInfo = `当前剧本：【${activeStory?.title || currentState.story_id}】\n阶段：${currentState.current_stage} | 状态：${currentState.status === 'completed' ? '已通关 🎉' : '进行中 ⏳'}${currentState.ending_id ? ` (结局: ${currentState.ending_id})` : ''}`;
    }

    const storyListText = stories.length > 0
      ? stories.map(s => `• /story start ${s.id} —— ${s.title}（${s.description}）`).join('\n')
      : '暂无可用剧本，可将 JSON 文件放入 server/data/stories/ 目录后输入 /story reload。';

    const msg = `【剧本演绎系统】\n${stateInfo}\n\n可用剧本列表：\n${storyListText}\n\n常用指令：\n- /story start <id> : 开始剧本\n- /story reset : 重置剧本进度\n- /story reload : 重载剧本配置`;

    return {
      success: true,
      message: msg,
      assistantReply: msg,
      data: { currentState, availableStories: stories.map(s => ({ id: s.id, title: s.title })) }
    };
  }
};
