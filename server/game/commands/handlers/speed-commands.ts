import { CONFIG } from '../../../config.ts';
import { FixtureService } from '../../../services/fixture-service.ts';
import { db } from '../../../db/database.ts';
import type { CommandDefinition, CommandResult } from '../types.ts';

export const speedCommand: CommandDefinition = {
  name: 'speed',
  aliases: ['fastforward', 'rates'],
  description: '调控全服建造与生产全局倍速（/speed 10x 或 /speed fast 极速建造）',
  usage: '/speed <multiplier | fast | normal | status>',
  requireOp: true,
  handler: async (args) => {
    const sub = (args[0] || 'status').toLowerCase();

    // 1. Query current status
    if (sub === 'status' || sub === 'query' || sub === 'info') {
      const mode = FixtureService.getConstructionTimeMode();
      const prodSpeed = CONFIG.PRODUCTION_SPEED_MULTIPLIER || 1;
      const systemMsg = `[Server: Speed Status: Production ${prodSpeed}x, Construction Mode: ${mode.mode.toUpperCase()} (${mode.speedMultiplier}x)]`;
      const assistantMsg = `老板，当前服务器倍速配置：\n• 生产速度：${prodSpeed}x 倍速\n• 建筑模式：${mode.mode === 'test' ? '极速测试模式 (10秒完工)' : '拟真官方时间'} (${mode.speedMultiplier}x 建造倍率)`;

      return {
        success: true,
        message: systemMsg,
        assistantReply: `${assistantMsg}\n§a${systemMsg}`,
        data: { productionMultiplier: prodSpeed, construction: mode }
      };
    }

    // 2. Fast construction mode (10s builds)
    if (sub === 'fast' || (sub === 'construction' && args[1]?.toLowerCase() === 'fast')) {
      const updated = await FixtureService.setConstructionTimeMode('test');
      const systemMsg = `[Server: Construction Time Mode set to TEST (Fast 10s builds)]`;
      const assistantMsg = `老板，已切换至【10秒极速建造模式】！所有新开工建筑和升级都将极速秒建！`;

      return {
        success: true,
        message: systemMsg,
        assistantReply: `${assistantMsg}\n§a${systemMsg}`,
        data: updated
      };
    }

    // 3. Normal construction mode (authentic)
    if (sub === 'normal' || sub === 'realistic' || (sub === 'construction' && (args[1]?.toLowerCase() === 'normal' || args[1]?.toLowerCase() === 'realistic'))) {
      const updated = await FixtureService.setConstructionTimeMode('realistic');
      const systemMsg = `[Server: Construction Time Mode set to REALISTIC (Authentic times)]`;
      const assistantMsg = `老板，建造时间已恢复为原版【拟真时间】模式。`;

      return {
        success: true,
        message: systemMsg,
        assistantReply: `${assistantMsg}\n§a${systemMsg}`,
        data: updated
      };
    }

    // 4. Numeric multiplier (e.g. 5, 10x, 50X)
    const cleanNum = sub.replace(/x$/i, '');
    const mult = parseFloat(cleanNum);
    if (!isNaN(mult) && mult > 0) {
      CONFIG.PRODUCTION_SPEED_MULTIPLIER = mult;

      // Persist in company_settings (company_id=0)
      db.prepare(`
        INSERT INTO company_settings (company_id, key, value)
        VALUES (0, 'production_speed_multiplier', ?)
        ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value
      `).run(String(mult));

      const currentMode = FixtureService.getConstructionTimeMode().mode;
      const updated = await FixtureService.setConstructionTimeMode(currentMode, mult);

      const systemMsg = `[Server: Global Speed Multiplier set to ${mult}x (Production & Construction)]`;
      const assistantMsg = `老板，全服生产与建筑倍速已调整为【${mult}x】倍！工人们现在工作飞起！`;

      return {
        success: true,
        message: systemMsg,
        assistantReply: `${assistantMsg}\n§a${systemMsg}`,
        data: { multiplier: mult, construction: updated }
      };
    }

    return {
      success: false,
      message: `Invalid speed parameter "${sub}". Usage: /speed <multiplier | fast | normal | status>`,
      assistantReply: `老板，未识别倍速参数 "${sub}"。示例：/speed 10x 或 /speed fast`
    };
  }
};
