import type { CommandDefinition, CommandResult, CommandContext } from '../types.ts';
import {
  hasPersonalAssistant,
  sendPersonalAssistantInvite,
  autoDetectAndInviteMissingPa
} from '../../../services/pa-invite-service.ts';
import { companyRepository } from '../../../repositories/company-repository.ts';

export const paCommand: CommandDefinition = {
  name: 'pa',
  aliases: ['assistant', '助理'],
  description: '个人助理状态检测与邀请管理指令',
  usage: '/pa [status | invite | check [all]]',
  requireOp: false,
  handler: async (args: string[], ctx: CommandContext): Promise<CommandResult> => {
    const companyId = ctx.executorCompanyId;
    if (!companyId) {
      return {
        success: false,
        message: 'Only authenticated companies can use /pa command.',
        assistantReply: '老板，需要登录公司账号才能使用助理指令。'
      };
    }

    const sub = (args[0] || '').toLowerCase();

    // 1. /pa invite [companyId/name]
    if (sub === 'invite') {
      let targetId = companyId;
      if (args[1]) {
        if (!ctx.isOp) {
          return {
            success: false,
            message: 'Only operators can invite PA for other companies.',
            assistantReply: '老板，给其他企业补发助理邀请需要管理员权限。'
          };
        }
        const target = /^\\d+$/.test(args[1])
          ? companyRepository.findById(Number(args[1]))
          : companyRepository.findByName(args[1]);
        if (!target) {
          return {
            success: false,
            message: `Target company "${args[1]}" not found.`,
            assistantReply: `老板，未找到目标企业 "${args[1]}"。`
          };
        }
        targetId = target.companyId;
      }

      const sent = sendPersonalAssistantInvite(targetId, { force: true });
      const targetComp = companyRepository.findById(targetId);
      const name = targetComp?.name || `企业#${targetId}`;
      if (sent) {
        return {
          success: true,
          message: `PA invitation successfully sent to ${name}.`,
          assistantReply: `老板，已成功向【${name}】发出个人助理邀请与入职私信！`
        };
      } else {
        return {
          success: false,
          message: `Failed to send PA invitation to ${name}.`,
          assistantReply: `老板，向【${name}】发送助理邀请失败，请稍后重试。`
        };
      }
    }

    // 2. /pa check [all]
    if (sub === 'check') {
      if (args[1] === 'all' || ctx.isOp) {
        const res = autoDetectAndInviteMissingPa();
        const text = `全服 PA 自动检测完成！共检查 ${res.checkedCount} 家无助理企业，已自动发出 ${res.invitedCount} 份 PA 邀请函。`;
        return {
          success: true,
          message: text,
          assistantReply: `老板，${text}`,
          data: res
        };
      }

      const hasPa = hasPersonalAssistant(companyId);
      if (hasPa) {
        return {
          success: true,
          message: 'Your company already has an active Personal Assistant.',
          assistantReply: '老板，您的企业已建立个人助理日常联络，如有任何需要随时向我下达指令！'
        };
      } else {
        sendPersonalAssistantInvite(companyId);
        return {
          success: true,
          message: 'PA not detected. An invitation has been automatically dispatched to you.',
          assistantReply: '老板，检测到您此前尚未建立助理联络，我已立即向您补发了个人助理邀请函！'
        };
      }
    }

    // 3. Default: /pa or /pa status
    const comp = companyRepository.findById(companyId);
    const hasPa = hasPersonalAssistant(companyId);
    const kind = comp?.personalAssistant || 'old';

    const info = `【个人助理状态】\n` +
      `• 当前企业：${comp?.name || companyId}\n` +
      `• 助理形象：${kind}\n` +
      `• 联络状态：${hasPa ? '已建立联络 ✅' : '未建立联络 ❌（输入 /pa invite 可重发邀请）'}\n\n` +
      `可用指令：\n` +
      `- /pa status : 查看助理当前状态\n` +
      `- /pa invite : 立即发送/重发助理邀请函\n` +
      `- /pa check  : 触发自动检测与补发`;

    return {
      success: true,
      message: info,
      assistantReply: info
    };
  }
};
