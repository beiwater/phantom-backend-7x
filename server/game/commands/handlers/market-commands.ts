import { NpcMarketService, NPC_SELLER_ID } from '../../../services/npc-market-service.ts';
import { db } from '../../../db/database.ts';
import type { CommandDefinition, CommandResult } from '../types.ts';

export const marketCommand: CommandDefinition = {
  name: 'market',
  description: '交易所管理指令 (restock 强制补货刷新全品类 NPC 挂单)',
  usage: '/market restock',
  requireOp: true,
  handler: async (args) => {
    const sub = (args[0] || 'restock').toLowerCase();

    if (sub === 'restock' || sub === 'refresh' || sub === '刷新') {
      const result = await NpcMarketService.restock({ force: true });
      const row = db.prepare(
        'SELECT COUNT(*) as activeCount FROM market_orders WHERE seller_id = ? AND active = 1'
      ).get(NPC_SELLER_ID) as { activeCount: number } | undefined;

      const totalActive = row?.activeCount ?? 0;
      const systemMsg = `[Server: NPC Market Restocked (#${result.restockCount}). Created: ${result.ordersCreated}, Updated: ${result.ordersUpdated}. Total Active NPC Orders: ${totalActive.toLocaleString()}]`;
      const assistantMsg = `老板，全服交易所 NPC 官方挂单已强制补货刷新！新建挂单 ${result.ordersCreated} 笔，更新补货 ${result.ordersUpdated} 笔。当前大盘活跃 NPC 订单共计 ${totalActive.toLocaleString()} 笔！`;

      return {
        success: true,
        message: systemMsg,
        assistantReply: `${assistantMsg}\n§a${systemMsg}`,
        data: { ...result, totalActiveNpcOrders: totalActive }
      };
    }

    return {
      success: false,
      message: `Unknown market action "${sub}". Usage: /market restock`,
      assistantReply: `老板，/market 目前仅支持 restock 补货指令：/market restock`
    };
  }
};
