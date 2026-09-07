import { issueCertificate, getCompanyCertificates } from '../../certificates.ts';
import { resolveTargets } from '../target-resolver.ts';
import type { CommandDefinition, CommandResult } from '../types.ts';

export const certCommand: CommandDefinition = {
  name: 'cert',
  aliases: ['certificate', 'certificates'],
  description: '为企业颁发或查询荣誉证书',
  usage: '/cert <target> <grant <kind> [resource] [rank] | list>',
  requireOp: true,
  handler: (args, ctx) => {
    if (args.length < 2) {
      return {
        success: false,
        message: 'Usage: /cert <target> <grant <kind> [resource] [rank] | list>',
        assistantReply: '老板，/cert 指令格式：/cert <目标企业> <grant <证书种类ID> [物料ID] [等级] | list>'
      };
    }

    const [targetSelector, action, ...rest] = args;
    const { targets, error } = resolveTargets(targetSelector, ctx);
    if (error || targets.length === 0) {
      return {
        success: false,
        message: `Target error: ${error || 'No target found'}`,
        assistantReply: `老板，未找到目标企业：${error}`
      };
    }

    if (action.toLowerCase() === 'list') {
      const target = targets[0];
      const certs = getCompanyCertificates(target.companyId);
      const listSummary = certs.map(c => `[Kind ${c.kind}] Rank ${c.rank} (Resource: ${c.resource_kind ?? 'None'})`).join('\n') || '无任何证书';
      const systemMsg = `[Server: Company ${target.name} has ${certs.length} certificate(s)]\n${listSummary}`;
      const assistantMsg = `老板，${target.name} 当前持有 ${certs.length} 张证书：\n${listSummary}`;

      return {
        success: true,
        message: systemMsg,
        assistantReply: `${assistantMsg}\n§a${systemMsg}`,
        data: { companyId: target.companyId, certificates: certs }
      };
    }

    if (action.toLowerCase() === 'grant' || action.toLowerCase() === 'award') {
      if (rest.length === 0) {
        return {
          success: false,
          message: 'Usage: /cert <target> grant <kind> [resource] [rank]',
          assistantReply: '老板，请指定要颁发的证书种类 ID！例如：/cert 1 grant 36'
        };
      }

      const kind = parseInt(rest[0], 10);
      if (isNaN(kind) || kind <= 0) {
        return {
          success: false,
          message: `Invalid certificate kind: "${rest[0]}". Must be a positive integer.`,
          assistantReply: `老板，证书种类 ID "${rest[0]}" 不合法。`
        };
      }

      const resourceKind = rest[1] !== undefined ? parseInt(rest[1], 10) : undefined;
      const rank = rest[2] !== undefined ? parseInt(rest[2], 10) : 1;

      const issued: unknown[] = [];
      for (const target of targets) {
        const result = issueCertificate({
          companyId: target.companyId,
          kind,
          rank,
          resourceKind,
          realmId: target.realmId
        });
        issued.push(result);
      }

      const names = targets.map(t => `${t.name} (ID:${t.companyId})`).join(', ');
      const systemMsg = `[Server: Granted Certificate (Kind ${kind}, Rank ${rank}) to ${names}]`;
      const assistantMsg = `老板，荣誉证书（种类 ${kind}，等级 ${rank}）已成功颁发给 ${names}！`;

      return {
        success: true,
        message: systemMsg,
        assistantReply: `${assistantMsg}\n§a${systemMsg}`,
        data: { kind, rank, resourceKind, issued }
      };
    }

    return {
      success: false,
      message: `Unknown cert action "${action}". Allowed: grant, list.`,
      assistantReply: `老板，未知的证书操作 "${action}"，仅支持 grant 或 list。`
    };
  }
};
