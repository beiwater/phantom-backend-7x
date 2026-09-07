import { addResource } from '../../warehouse.ts';
import { updateCompanyMoney, updateCompanySimBoosts, getCompanyById } from '../../company.ts';
import { getResourceDef } from '../../constants.ts';
import { resolveTargets } from '../target-resolver.ts';
import type { CommandDefinition, CommandResult, TargetCompany } from '../types.ts';

// Resource name alias normalization lookup
const RESOURCE_ALIASES: Record<string, number> = {
  power: 1, electricity: 1, 电力: 1, 电: 1,
  water: 2, 水: 2, 水资源: 2,
  apples: 3, apple: 3, 苹果: 3,
  oranges: 4, orange: 4, 橙子: 4,
  grapes: 5, grape: 5, 葡萄: 5,
  grain: 6, 谷物: 6, 粮食: 6,
  steak: 7, 牛排: 7,
  sausages: 8, sausage: 8, 香肠: 8,
  eggs: 9, egg: 9, 鸡蛋: 9,
  'crude oil': 10, crude_oil: 10, crude: 10, oil: 10, 原油: 10, 石油: 10,
  petrol: 11, gasoline: 11, 汽油: 11,
  diesel: 12, 柴油: 12,
  transport: 13, 运输: 13,
  minerals: 14, mineral: 14, 矿物: 14,
  bauxite: 15, 铝土矿: 15,
  silicon: 16, 硅: 16,
  chemicals: 17, chemical: 17, 化学品: 17,
  aluminium: 18, aluminum: 18, 铝: 18,
  plastic: 19, 塑料: 19,
  processors: 20, processor: 20, cpu: 20, 处理器: 20,
  'electronic components': 21, electronic_components: 21, electronics: 21, 电子元件: 21,
  batteries: 22, battery: 22, 电池: 22,
  displays: 23, display: 23, screen: 23, 显示屏: 23,
  'smart phones': 24, smart_phones: 24, smartphone: 24, phone: 24, 手机: 24, 智能手机: 24,
  tablets: 25, tablet: 25, 平板: 25,
  laptops: 26, laptop: 26, 笔记本: 26, 笔记本电脑: 26,
  software: 35, 软件: 35,
  iron_ore: 42, 'iron ore': 42, 铁矿石: 42,
  steel: 43, 钢: 43, 钢铁: 43,
  sand: 44, 沙子: 44,
  glass: 45, 玻璃: 45,
  leather: 46, 皮革: 46,
  gold_ore: 67, 'gold ore': 67, 金矿石: 67,
  gold: 68, 金: 68, 黄金: 68
};

function resolveResourceKind(input: string): { kind: number; name: string } | undefined {
  const clean = input.trim().toLowerCase();
  if (/^\d+$/.test(clean)) {
    const kind = Number(clean);
    const def = getResourceDef(kind);
    if (def) {
      return { kind, name: def.name };
    }
  }

  const kind = RESOURCE_ALIASES[clean] || RESOURCE_ALIASES[clean.replace(/[\s_-]+/g, '')];
  if (kind) {
    const def = getResourceDef(kind);
    return { kind, name: def?.name || clean };
  }

  return undefined;
}

export const giveCommand: CommandDefinition = {
  name: 'give',
  description: '向指定企业发放物资与产品（支持品质设定）',
  usage: '/give <target> <resource> <amount> [quality]',
  requireOp: true,
  handler: (args, ctx) => {
    if (args.length < 3) {
      return {
        success: false,
        message: 'Usage: /give <target> <resource> <amount> [quality]',
        assistantReply: '老板，/give 指令参数不足，格式：/give <目标企业/@s/@a> <物料名称或ID> <数量> [品质]'
      };
    }

    const [targetSelector, resourceArg, amountArg, qualityArg] = args;
    const { targets, error } = resolveTargets(targetSelector, ctx);
    if (error || targets.length === 0) {
      return {
        success: false,
        message: `Target error: ${error || 'No targets resolved'}`,
        assistantReply: `老板，未找到目标企业：${error}`
      };
    }

    const resInfo = resolveResourceKind(resourceArg);
    if (!resInfo) {
      return {
        success: false,
        message: `Unknown resource: "${resourceArg}". Use valid ID or name (e.g. water, power, 1, 2).`,
        assistantReply: `老板，未识别物料 "${resourceArg}"。请输入正确的物料名（如 water、power、原油）或物料ID。`
      };
    }

    const amount = parseInt(amountArg, 10);
    if (isNaN(amount) || amount <= 0) {
      return {
        success: false,
        message: `Invalid amount: "${amountArg}". Amount must be a positive integer.`,
        assistantReply: `老板，数量 "${amountArg}" 不合法，必须为正整数。`
      };
    }

    const quality = qualityArg !== undefined ? Math.max(0, parseInt(qualityArg, 10) || 0) : 0;

    for (const target of targets) {
      addResource(target.companyId, resInfo.kind, quality, amount);
    }

    const targetNames = targets.map(t => `${t.name} (ID:${t.companyId})`).join(', ');
    const systemMsg = `[Server: Issued ${amount.toLocaleString()}x ${resInfo.name} (Q${quality}) to ${targets.length === 1 ? targetNames : `${targets.length} companies`}]`;
    const assistantMsg = `老板，已为您向 ${targets.length === 1 ? targetNames : `全服 ${targets.length} 家企业`} 调拨入库了 ${amount.toLocaleString()} 份 ${resInfo.name}（品质: Q${quality}）！`;

    return {
      success: true,
      message: systemMsg,
      assistantReply: `${assistantMsg}\n§a${systemMsg}`,
      data: {
        targets: targets.map(t => t.companyId),
        resource: resInfo.kind,
        resourceName: resInfo.name,
        amount,
        quality
      }
    };
  }
};

export const moneyCommand: CommandDefinition = {
  name: 'money',
  description: '调控指定企业的资金余额 (add 增发 / set 设定 / remove 扣减)',
  usage: '/money <target> <add|set|remove> <amount>',
  requireOp: true,
  subcommands: {
    add: { name: 'add', description: '增加资金', usage: '/money <target> add <amount>', handler: () => ({ success: false, message: '' }) },
    set: { name: 'set', description: '直接设定资金', usage: '/money <target> set <amount>', handler: () => ({ success: false, message: '' }) },
    remove: { name: 'remove', description: '扣减资金', usage: '/money <target> remove <amount>', handler: () => ({ success: false, message: '' }) }
  },
  handler: (args, ctx) => {
    if (args.length < 3) {
      return {
        success: false,
        message: 'Usage: /money <target> <add|set|remove> <amount>',
        assistantReply: '老板，/money 指令格式：/money <目标企业/@s/@a> <add|set|remove> <金额>'
      };
    }

    const [targetSelector, actionArg, amountArg] = args;
    const action = actionArg.toLowerCase();
    if (action !== 'add' && action !== 'set' && action !== 'remove') {
      return {
        success: false,
        message: `Unknown action "${actionArg}". Allowed: add, set, remove.`,
        assistantReply: `老板，未知的金钱操作 "${actionArg}"，仅支持 add、set、remove。`
      };
    }

    const amount = parseFloat(amountArg);
    if (isNaN(amount) || amount < 0) {
      return {
        success: false,
        message: `Invalid amount: "${amountArg}". Amount must be non-negative.`,
        assistantReply: `老板，金额 "${amountArg}" 不合法，请输入有效数值。`
      };
    }

    const { targets, error } = resolveTargets(targetSelector, ctx);
    if (error || targets.length === 0) {
      return {
        success: false,
        message: `Target error: ${error || 'No targets resolved'}`,
        assistantReply: `老板，未找到目标企业：${error}`
      };
    }

    const results: Array<{ companyId: number; name: string; oldMoney: number; newMoney: number }> = [];

    for (const target of targets) {
      const comp = getCompanyById(target.companyId);
      const currentMoney = comp ? Number(comp.money) : 0;
      let delta = 0;

      if (action === 'add') {
        delta = amount;
      } else if (action === 'remove') {
        delta = -amount;
      } else if (action === 'set') {
        delta = amount - currentMoney;
      }

      const newBal = updateCompanyMoney(target.companyId, delta);
      results.push({
        companyId: target.companyId,
        name: target.name,
        oldMoney: currentMoney,
        newMoney: newBal
      });
    }

    const targetDesc = targets.length === 1
      ? `${targets[0].name} (ID:${targets[0].companyId})`
      : `${targets.length} 家企业`;
    const actionText = action === 'add' ? `增加 $${amount.toLocaleString()}` : action === 'remove' ? `扣减 $${amount.toLocaleString()}` : `设定为 $${amount.toLocaleString()}`;
    const systemMsg = `[Server: Money ${action} of $${amount.toLocaleString()} applied to ${targetDesc}]`;
    const assistantMsg = `老板，已成功为 ${targetDesc} 进行资金调控（${actionText}）。${targets.length === 1 ? `当前余额: $${results[0].newMoney.toLocaleString()}` : ''}`;

    return {
      success: true,
      message: systemMsg,
      assistantReply: `${assistantMsg}\n§a${systemMsg}`,
      data: { action, amount, targets: results }
    };
  }
};

export const simboostCommand: CommandDefinition = {
  name: 'simboost',
  aliases: ['sb', 'simboosts'],
  description: '调控指定企业的 SimBoosts 数量 (add / set / remove)',
  usage: '/simboost <target> <add|set|remove> <amount>',
  requireOp: true,
  handler: (args, ctx) => {
    if (args.length < 3) {
      return {
        success: false,
        message: 'Usage: /simboost <target> <add|set|remove> <amount>',
        assistantReply: '老板，/simboost 指令格式：/simboost <目标企业/@s/@a> <add|set|remove> <数量>'
      };
    }

    const [targetSelector, actionArg, amountArg] = args;
    const action = actionArg.toLowerCase();
    if (action !== 'add' && action !== 'set' && action !== 'remove') {
      return {
        success: false,
        message: `Unknown action "${actionArg}". Allowed: add, set, remove.`,
        assistantReply: `老板，未知的 SimBoost 操作 "${actionArg}"，仅支持 add、set、remove。`
      };
    }

    const amount = parseInt(amountArg, 10);
    if (isNaN(amount) || amount < 0) {
      return {
        success: false,
        message: `Invalid amount: "${amountArg}".`,
        assistantReply: `老板，SimBoosts 数量 "${amountArg}" 不合法。`
      };
    }

    const { targets, error } = resolveTargets(targetSelector, ctx);
    if (error || targets.length === 0) {
      return {
        success: false,
        message: `Target error: ${error || 'No targets resolved'}`,
        assistantReply: `老板，未找到目标企业：${error}`
      };
    }

    const results: Array<{ companyId: number; name: string; oldSb: number; newSb: number }> = [];

    for (const target of targets) {
      const comp = getCompanyById(target.companyId);
      const currentSb = comp ? Number(comp.simboosts || 0) : 0;
      let delta = 0;

      if (action === 'add') {
        delta = amount;
      } else if (action === 'remove') {
        delta = -amount;
      } else if (action === 'set') {
        delta = amount - currentSb;
      }

      const newBal = updateCompanySimBoosts(target.companyId, delta);
      results.push({
        companyId: target.companyId,
        name: target.name,
        oldSb: currentSb,
        newSb: newBal
      });
    }

    const targetDesc = targets.length === 1
      ? `${targets[0].name} (ID:${targets[0].companyId})`
      : `${targets.length} 家企业`;
    const actionText = action === 'add' ? `增加 ${amount} SB` : action === 'remove' ? `扣减 ${amount} SB` : `设定为 ${amount} SB`;
    const systemMsg = `[Server: SimBoosts ${action} of ${amount} applied to ${targetDesc}]`;
    const assistantMsg = `老板，已成功为 ${targetDesc} 调控 SimBoosts（${actionText}）。${targets.length === 1 ? `当前余额: ${results[0].newSb} SB` : ''}`;

    return {
      success: true,
      message: systemMsg,
      assistantReply: `${assistantMsg}\n§a${systemMsg}`,
      data: { action, amount, targets: results }
    };
  }
};
