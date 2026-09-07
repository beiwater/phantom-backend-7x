import { db } from '../../../db/database.ts';
import { socialRepository } from '../../../repositories/social-repository.ts';
import { broadcastAll } from '../../../ws/websocket.ts';
import { virtualClock } from '../../../core/virtual-clock.ts';
import { resolveTargets } from '../target-resolver.ts';
import type { CommandDefinition, CommandResult } from '../types.ts';

export const opCommand: CommandDefinition = {
  name: 'op',
  description: '输入管理密钥认证为管理员，或为指定企业赋予管理权限',
  usage: '/op <secret_key | target>',
  requireOp: false, // Allows unauthenticated users to authenticate with secret
  handler: (args, ctx) => {
    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: /op <secret_key | target>',
        assistantReply: '老板，/op 指令格式：/op <密钥> 或在控制台输入 /op <目标企业>'
      };
    }

    const arg = args[0];
    const configuredKey = process.env.ADMIN_OP_KEY || 'phantom-admin';

    // 1. Secret Key authentication branch
    if (arg === configuredKey) {
      if (!ctx.executorCompanyId) {
        return {
          success: true,
          message: '[Server: Admin OP authenticated in session]',
          assistantReply: '老板，密钥校验成功，管理员权限已激活！'
        };
      }

      socialRepository.upsertCompanySetting(ctx.executorCompanyId, 'is_admin_op', '1');
      const systemMsg = `[Server: Company ${ctx.executorCompanyId} granted operator status via secret key]`;
      const assistantMsg = '老板，管理员口令验证通过！已为您正式解锁全服管理权限，快试试各种黑科技指令吧！';

      return {
        success: true,
        message: systemMsg,
        assistantReply: `${assistantMsg}\n§a${systemMsg}`,
        data: { companyId: ctx.executorCompanyId, isOp: true }
      };
    }

    // 2. Grant OP by target (only if already OP or from CLI)
    if (!ctx.isOp) {
      return {
        success: false,
        message: 'Invalid OP secret key or insufficient permissions to grant OP.',
        assistantReply: '老板，您输入的管理密钥不正确，请检查后重新输入！'
      };
    }

    const { targets, error } = resolveTargets(arg, ctx);
    if (error || targets.length === 0) {
      return {
        success: false,
        message: `Target error: ${error || 'No target found'}`,
        assistantReply: `老板，未找到目标企业：${error}`
      };
    }

    for (const target of targets) {
      socialRepository.upsertCompanySetting(target.companyId, 'is_admin_op', '1');
    }

    const names = targets.map(t => `${t.name} (ID:${t.companyId})`).join(', ');
    const systemMsg = `[Server: Granted OP to ${names}]`;
    const assistantMsg = `老板，已成功为 ${names} 赋予全服管理员权限！`;

    return {
      success: true,
      message: systemMsg,
      assistantReply: `${assistantMsg}\n§a${systemMsg}`,
      data: { targets: targets.map(t => t.companyId) }
    };
  }
};

export const deopCommand: CommandDefinition = {
  name: 'deop',
  description: '撤销指定企业的全服管理员权限',
  usage: '/deop <target>',
  requireOp: true,
  handler: (args, ctx) => {
    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: /deop <target>',
        assistantReply: '老板，/deop 指令格式：/deop <目标企业/@s>'
      };
    }

    const { targets, error } = resolveTargets(args[0], ctx);
    if (error || targets.length === 0) {
      return {
        success: false,
        message: `Target error: ${error || 'No target found'}`,
        assistantReply: `老板，未找到目标企业：${error}`
      };
    }

    for (const target of targets) {
      socialRepository.upsertCompanySetting(target.companyId, 'is_admin_op', '0');
    }

    const names = targets.map(t => `${t.name} (ID:${t.companyId})`).join(', ');
    const systemMsg = `[Server: Revoked OP from ${names}]`;
    const assistantMsg = `老板，已撤销 ${names} 的管理员权限。`;

    return {
      success: true,
      message: systemMsg,
      assistantReply: `${assistantMsg}\n§a${systemMsg}`,
      data: { targets: targets.map(t => t.companyId) }
    };
  }
};

export const kickCommand: CommandDefinition = {
  name: 'kick',
  description: '强制注销指定玩家/企业的在线会话将其踢下线',
  usage: '/kick <target> [reason]',
  requireOp: true,
  handler: (args, ctx) => {
    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: /kick <target> [reason]',
        assistantReply: '老板，/kick 指令格式：/kick <目标企业> [踢出原因]'
      };
    }

    const [targetSelector, ...reasonParts] = args;
    const reason = reasonParts.join(' ') || 'Kicked by administrator';

    const { targets, error } = resolveTargets(targetSelector, ctx);
    if (error || targets.length === 0) {
      return {
        success: false,
        message: `Target error: ${error || 'No target found'}`,
        assistantReply: `老板，未找到目标企业：${error}`
      };
    }

    let kickedSessions = 0;
    for (const target of targets) {
      const res = db.prepare(`
        DELETE FROM sessions WHERE player_id IN (
          SELECT player_id FROM companies WHERE company_id = ?
        )
      `).run(target.companyId);
      kickedSessions += res.changes;
    }

    const names = targets.map(t => `${t.name} (ID:${t.companyId})`).join(', ');
    const systemMsg = `[Server: Kicked ${names} (${kickedSessions} active session(s) terminated). Reason: ${reason}]`;
    const assistantMsg = `老板，已将 ${names} 强制踢下线（清理了 ${kickedSessions} 个登录会话）！原因：${reason}`;

    return {
      success: true,
      message: systemMsg,
      assistantReply: `${assistantMsg}\n§a${systemMsg}`,
      data: { kickedSessions, targets: targets.map(t => t.companyId), reason }
    };
  }
};

export const banCommand: CommandDefinition = {
  name: 'ban',
  description: '封禁指定企业并立即强制踢出',
  usage: '/ban <target> [reason]',
  requireOp: true,
  handler: (args, ctx) => {
    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: /ban <target> [reason]',
        assistantReply: '老板，/ban 指令格式：/ban <目标企业> [封禁原因]'
      };
    }

    const [targetSelector, ...reasonParts] = args;
    const reason = reasonParts.join(' ') || 'Banned by administrator';

    const { targets, error } = resolveTargets(targetSelector, ctx);
    if (error || targets.length === 0) {
      return {
        success: false,
        message: `Target error: ${error || 'No target found'}`,
        assistantReply: `老板，未找到目标企业：${error}`
      };
    }

    for (const target of targets) {
      socialRepository.upsertCompanySetting(target.companyId, 'is_banned', '1');
      db.prepare(`
        DELETE FROM sessions WHERE player_id IN (
          SELECT player_id FROM companies WHERE company_id = ?
        )
      `).run(target.companyId);
    }

    const names = targets.map(t => `${t.name} (ID:${t.companyId})`).join(', ');
    const systemMsg = `[Server: Banned ${names}. Reason: ${reason}]`;
    const assistantMsg = `老板，已对 ${names} 执行全服封禁并踢下线！原因：${reason}`;

    return {
      success: true,
      message: systemMsg,
      assistantReply: `${assistantMsg}\n§a${systemMsg}`,
      data: { targets: targets.map(t => t.companyId), reason }
    };
  }
};

export const sayCommand: CommandDefinition = {
  name: 'say',
  aliases: ['broadcast', 'announce'],
  description: '以管理员/系统身份向全服广播公告',
  usage: '/say <message>',
  requireOp: true,
  handler: (args) => {
    const text = args.join(' ').trim();
    if (!text) {
      return {
        success: false,
        message: 'Usage: /say <message>',
        assistantReply: '老板，请输入广播内容：/say <公告内容>'
      };
    }

    const now = virtualClock.nowIso();
    // Broadcast via WebSocket
    broadcastAll('NEW_MESSAGE', {
      id: Date.now(),
      room: 'G',
      sender_id: 0,
      sender_company: '[全服系统广播]',
      text: `📢 [全服公告]: ${text}`,
      body: `📢 [全服公告]: ${text}`,
      sent_at: now,
      datetime: now,
      pinned: true
    });

    // Also persist into default public chatroom
    try {
      socialRepository.insertChatMessage('G', 0, '[全服公告]', text, now);
      socialRepository.insertChatMessage('N', 0, '[全服公告]', text, now);
    } catch {
      // safe fallback
    }

    const systemMsg = `[Server: Broadcasted announcement: "${text}"]`;
    const assistantMsg = `老板，全服广播已发出！所有在线玩家均已收到通知。`;

    return {
      success: true,
      message: systemMsg,
      assistantReply: `${assistantMsg}\n§a${systemMsg}`,
      data: { text, sentAt: now }
    };
  }
};
