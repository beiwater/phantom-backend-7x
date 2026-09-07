import { virtualClock } from '../../../core/virtual-clock.ts';
import { FixtureService } from '../../../services/fixture-service.ts';
import { grantCycleCertificates } from '../../certificates.ts';
import type { CommandDefinition, CommandResult } from '../types.ts';

function parseDuration(input: string): { hours: number; days: number; minutes: number; seconds: number } {
  let days = 0;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  const regex = /(\d+(?:\.\d+)?)\s*([dhms天小时分秒]?)/gi;
  let match: RegExpExecArray | null;
  let matchedAny = false;

  while ((match = regex.exec(input)) !== null) {
    if (!match[1]) continue;
    matchedAny = true;
    const val = parseFloat(match[1]);
    const unit = (match[2] || 'h').toLowerCase();

    if (unit === 'd' || unit === '天') {
      days += val;
    } else if (unit === 'h' || unit === '小时') {
      hours += val;
    } else if (unit === 'm' || unit === '分' || unit === '分钟') {
      minutes += val;
    } else if (unit === 's' || unit === '秒') {
      seconds += val;
    } else {
      hours += val;
    }
  }

  if (!matchedAny) {
    const raw = parseFloat(input);
    if (!isNaN(raw)) hours = raw;
  }

  return { days, hours, minutes, seconds };
}

export const timeCommand: CommandDefinition = {
  name: 'time',
  aliases: ['warp'],
  description: '控制服务器虚拟时间快进或查询当前时间',
  usage: '/time <add <duration> | query | reset>',
  requireOp: true,
  handler: async (args) => {
    if (args.length === 0 || args[0].toLowerCase() === 'query') {
      const now = virtualClock.nowIso();
      const offsetHours = virtualClock.getOffsetHours();
      const msg = `[Server: Virtual Time: ${now}, Offset: +${offsetHours.toFixed(2)}h]`;
      return {
        success: true,
        message: msg,
        assistantReply: `老板，当前虚拟时钟时间为 ${now}（累计快进了 ${offsetHours.toFixed(2)} 小时）。\n§a${msg}`,
        data: { virtualNow: now, offsetHours }
      };
    }

    const sub = args[0].toLowerCase();
    if (sub === 'reset') {
      const resetRes = virtualClock.reset();
      const msg = `[Server: Virtual Clock Reset to Real Time: ${resetRes.newIso}]`;
      return {
        success: true,
        message: msg,
        assistantReply: `老板，已将服务器虚拟时间重置为现实时间！\n§a${msg}`,
        data: resetRes
      };
    }

    const durationStr = sub === 'add' ? args.slice(1).join(' ') : args.join(' ');
    if (!durationStr.trim()) {
      return {
        success: false,
        message: 'Usage: /time add <duration> (e.g. /time add 24h, /time 3d)',
        assistantReply: '老板，请输入要快进的时间跨度，例如：/time add 24h 或 /warp 3d'
      };
    }

    const parts = parseDuration(durationStr);
    const warpResult = virtualClock.advance(parts);
    const resolved = await virtualClock.resolveAllOverdue();

    const systemMsg = `[Server: Time advanced to ${warpResult.newIso} (offset: +${warpResult.offsetHours.toFixed(2)}h). Resolved: ${resolved.completedProductions} productions, ${resolved.completedConstructions} constructions, ${resolved.completedRetailOrders} retail]`;
    const assistantMsg = `老板，时间已飞速快进！当前虚拟时间：${warpResult.newIso}。\n已自动结算：${resolved.completedProductions} 项生产完成、${resolved.completedConstructions} 处建筑升级/竣工、${resolved.completedRetailOrders} 笔零售订单！`;

    return {
      success: true,
      message: systemMsg,
      assistantReply: `${assistantMsg}\n§a${systemMsg}`,
      data: { clock: warpResult, resolved }
    };
  }
};

export const economyCommand: CommandDefinition = {
  name: 'economy',
  aliases: ['econ'],
  description: '调控服务器宏观经济大环境 (boom 繁荣 / normal 平稳 / recession 萧条 / roll 随机轮转)',
  usage: '/economy <boom|normal|recession|roll|status>',
  requireOp: true,
  handler: (args, ctx) => {
    const realmId = ctx.realmId ?? 0;
    const sub = (args[0] || 'status').toLowerCase();

    if (sub === 'status' || sub === 'query') {
      const current = FixtureService.getEconomyState(realmId);
      const systemMsg = `[Server: Economy is currently ${current.stateName.toUpperCase()} (Phase: ${current.phase}, Modifier: ${(current.productionModifier * 100).toFixed(1)}%)]`;
      const assistantMsg = `老板，当前经济处于【${current.stateName === 'boom' ? '繁荣' : current.stateName === 'recession' ? '萧条' : '平稳'}】状态（阶段: ${current.phase}，生产修正: ${(current.productionModifier * 100).toFixed(1)}%）。`;
      return {
        success: true,
        message: systemMsg,
        assistantReply: `${assistantMsg}\n§a${systemMsg}`,
        data: current
      };
    }

    if (sub === 'roll') {
      const rolled = FixtureService.rollEconomyState(realmId);
      const systemMsg = `[Server: Rolled economy phase to ${rolled.stateName.toUpperCase()} (Phase: ${rolled.phase})]`;
      const assistantMsg = `老板，已按照经济马尔可夫转移轮转到【${rolled.stateName === 'boom' ? '繁荣' : rolled.stateName === 'recession' ? '萧条' : '平稳'}】状态！`;
      return {
        success: true,
        message: systemMsg,
        assistantReply: `${assistantMsg}\n§a${systemMsg}`,
        data: rolled
      };
    }

    let targetState = 'normal';
    if (sub === 'boom' || sub === '繁荣' || sub === '景气') {
      targetState = 'boom';
    } else if (sub === 'recession' || sub === '萧条' || sub === '衰退') {
      targetState = 'recession';
    } else if (sub === 'normal' || sub === '平稳' || sub === '正常') {
      targetState = 'normal';
    } else {
      return {
        success: false,
        message: `Unknown economy state: "${sub}". Allowed: boom, normal, recession, roll, status.`,
        assistantReply: `老板，未知的经济状态 "${sub}"。支持：boom(繁荣)、normal(平稳)、recession(萧条)、roll(随机轮转)。`
      };
    }

    const updated = FixtureService.setEconomyState(targetState, { realmId, random: false });
    const stateCn = targetState === 'boom' ? '繁荣' : targetState === 'recession' ? '萧条' : '平稳';
    const systemMsg = `[Server: Economy state set to ${updated.stateName.toUpperCase()} (Modifier: ${(updated.productionModifier * 100).toFixed(1)}%)]`;
    const assistantMsg = `老板，全服经济大环境已调整为【${stateCn}】！当前生产修正为 ${(updated.productionModifier * 100).toFixed(1)}%。`;

    return {
      success: true,
      message: systemMsg,
      assistantReply: `${assistantMsg}\n§a${systemMsg}`,
      data: updated
    };
  }
};

export const cycleCommand: CommandDefinition = {
  name: 'cycle',
  description: '强制执行经济周期结算并自动评选颁发周期荣誉证书',
  usage: '/cycle [force]',
  requireOp: true,
  handler: async (args, ctx) => {
    const realmId = ctx.realmId ?? 0;
    const certResults = grantCycleCertificates(realmId);
    const resolved = await virtualClock.resolveAllOverdue();

    const systemMsg = `[Server: Settled cycle for realm ${realmId}. Issued ${certResults.issued.length} certificates.]`;
    const assistantMsg = `老板，本轮经济周期已强制结算！共计评选并颁发了 ${certResults.issued.length} 张荣誉证书，并完成了所有待处理的生产与建筑任务！`;

    return {
      success: true,
      message: systemMsg,
      assistantReply: `${assistantMsg}\n§a${systemMsg}`,
      data: { certificates: certResults, resolved }
    };
  }
};
