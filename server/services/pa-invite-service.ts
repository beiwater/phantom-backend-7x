import { db } from '../db/database.ts';
import { socialRepository } from '../repositories/social-repository.ts';
import { companyRepository } from '../repositories/company-repository.ts';
import { virtualClock } from '../core/virtual-clock.ts';
import { broadcastAll, broadcastToCompany } from '../ws/websocket.ts';
import { logger } from '../core/logger.ts';

export interface PaInviteResult {
  checkedCount: number;
  invitedCount: number;
  invitedCompanyIds: number[];
}

/**
 * Check whether a company already has established contact with Personal Assistant (company ID 0).
 */
export function hasPersonalAssistant(companyId: number): boolean {
  if (companyId <= 0) return true;
  try {
    const row = db.prepare(`
      SELECT 1 FROM direct_messages
      WHERE (sender_company_id = 0 AND recipient_company_id = ?)
         OR (sender_company_id = ? AND recipient_company_id = 0)
      LIMIT 1
    `).get(companyId, companyId);
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Generate standard Personal Assistant invitation HTML.
 */
export function buildPaInviteHtml(companyName: string): string {
  return `<div><b>💼 个人助理（PA）入职与服务邀请</b><br/><br/>` +
    `总裁您好！我是您的专属<b>个人助理（Personal Assistant）</b>。<br/><br/>` +
    `检测到您的企业 <b>${companyName}</b> 尚未建立个人助理秘书处的日常联络。为了协助您在模拟公司商界中脱颖而出，我已全面就绪，将竭诚为您提供以下全方位顾问服务：<br/>` +
    `• <b>产业协同与运营</b>：生产排产、零售策略、仓库与物流实时监控<br/>` +
    `• <b>高管与战略管理</b>：高管团队搭建、薪水谈判与人才培训推进<br/>` +
    `• <b>商界风云·剧情推演</b>：随时开启专属商业推演剧本，与商界财阀博弈并赢取丰厚奖励！<br/><br/>` +
    `💡 <i>您可以随时在对话框输入 <code>/help</code> 查看助理支持的各项管理指令，或输入 <code>/story</code> 开启剧情推演。在总部（HQ）的高管页面也可以随时更换助理形象。</i><br/><br/>` +
    `<a class="pa-reply" href="/pa-action/welcome/accept/"><i class="fa fa-handshake-o"></i> 接受助理邀请，开启商业腾飞</a>` +
    `</div>`;
}

/**
 * Send Personal Assistant invitation to a specific company.
 */
export function sendPersonalAssistantInvite(companyId: number, options?: { force?: boolean }): boolean {
  if (companyId <= 0) return false;

  if (!options?.force && hasPersonalAssistant(companyId)) {
    return false;
  }

  const comp = companyRepository.findById(companyId);
  const companyName = comp?.name || `企业#${companyId}`;
  const now = virtualClock.nowIso();
  const inviteHtml = buildPaInviteHtml(companyName);

  try {
    // 1. Persist direct message from PA (id 0) to company
    const messageId = socialRepository.insertDirectMessage(0, companyId, inviteHtml, now);

    // 2. Ensure company has personal_assistant attribute set
    if (!comp?.personalAssistant) {
      try {
        db.prepare('UPDATE companies SET personal_assistant = ? WHERE company_id = ? AND (personal_assistant IS NULL OR personal_assistant = \'\')')
          .run('old', companyId);
      } catch {
        // ignore
      }
    }

    // 3. Format payload for WebSocket notification
    const formatted = {
      id: messageId,
      sender: {
        id: 0,
        company: '个人助理',
        logo: '/static/images/personal-assistant/old.png',
        certificates: 0,
        supporter: true,
        realmId: comp?.realmId ?? 0
      },
      receiver: {
        id: companyId,
        company: companyName,
        logo: comp?.logo || '',
        certificates: 0,
        supporter: false,
        realmId: comp?.realmId ?? 0
      },
      body: inviteHtml,
      text: inviteHtml,
      datetime: now,
      pinned: false,
      isHtml: true
    };

    // 4. Real-time push via WebSocket
    broadcastToCompany(companyId, formatted);
    broadcastAll('NEW_MESSAGE', formatted);

    logger.info(`[PA Service] Automatically sent PA invitation to company ${companyId} (${companyName})`);
    return true;
  } catch (err) {
    logger.error(`[PA Service] Failed to send PA invite to company ${companyId}:`, err);
    return false;
  }
}

/**
 * Auto-detect companies without PA and send them a PA invitation.
 * If targetCompanyId is specified, only that company is checked and invited.
 * Otherwise, scans all registered companies across the server.
 */
export function autoDetectAndInviteMissingPa(targetCompanyId?: number): PaInviteResult {
  if (targetCompanyId !== undefined) {
    const withoutPa = !hasPersonalAssistant(targetCompanyId);
    if (withoutPa) {
      const sent = sendPersonalAssistantInvite(targetCompanyId);
      return {
        checkedCount: 1,
        invitedCount: sent ? 1 : 0,
        invitedCompanyIds: sent ? [targetCompanyId] : []
      };
    }
    return { checkedCount: 1, invitedCount: 0, invitedCompanyIds: [] };
  }

  // Scan all companies without any direct messages from 0
  const rows = db.prepare(`
    SELECT company_id, name FROM companies
    WHERE company_id > 0
      AND company_id NOT IN (
        SELECT DISTINCT recipient_company_id FROM direct_messages WHERE sender_company_id = 0
      )
      AND company_id NOT IN (
        SELECT DISTINCT sender_company_id FROM direct_messages WHERE recipient_company_id = 0
      )
  `).all() as Array<{ company_id: number; name: string }>;

  const invitedCompanyIds: number[] = [];
  for (const row of rows) {
    const success = sendPersonalAssistantInvite(row.company_id);
    if (success) {
      invitedCompanyIds.push(row.company_id);
    }
  }

  if (invitedCompanyIds.length > 0) {
    logger.info(`[PA Service] Auto-detection completed: invited ${invitedCompanyIds.length} companies without PA.`);
  }

  return {
    checkedCount: rows.length,
    invitedCount: invitedCompanyIds.length,
    invitedCompanyIds
  };
}

let detectionTimer: NodeJS.Timeout | null = null;

/**
 * Start periodic automatic detection and invitation.
 */
export function startAutoPaDetection(intervalMs = 60000): void {
  // Run an immediate sweep on boot
  try {
    autoDetectAndInviteMissingPa();
  } catch (err) {
    logger.error('[PA Service] Initial PA detection failed:', err);
  }

  if (detectionTimer) {
    clearInterval(detectionTimer);
  }

  detectionTimer = setInterval(() => {
    try {
      autoDetectAndInviteMissingPa();
    } catch (err) {
      logger.error('[PA Service] Periodic PA detection sweep error:', err);
    }
  }, intervalMs);

  // Unref timer so it doesn't hold process alive
  if (detectionTimer.unref) {
    detectionTimer.unref();
  }
}

/**
 * Stop periodic automatic detection.
 */
export function stopAutoPaDetection(): void {
  if (detectionTimer) {
    clearInterval(detectionTimer);
    detectionTimer = null;
  }
}
