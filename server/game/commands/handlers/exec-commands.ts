import { db } from '../../../db/database.ts';
import { virtualClock } from '../../../core/virtual-clock.ts';
import { normalizePositionCode } from '../../../domain/executives.ts';
import { resolveTargets } from '../target-resolver.ts';
import type { CommandDefinition, CommandResult, TargetCompany } from '../types.ts';

interface ExecDbRow {
  id: number;
  company_id: number;
  name: string;
  position: string;
  skill_management: number;
  skill_accounting: number;
  skill_science: number;
  skill_communication: number;
  salary: number;
  status: string;
}

const POSITION_TITLES: Record<string, { title: string; mainSkill: string }> = {
  o: { title: 'COO (首席运营官)', mainSkill: 'management' },
  f: { title: 'CFO (首席财务官)', mainSkill: 'accounting' },
  m: { title: 'CMO (首席营销官)', mainSkill: 'communication' },
  t: { title: 'CTO (首席技术官)', mainSkill: 'science' }
};

export const execCommand: CommandDefinition = {
  name: 'exec',
  aliases: ['executive', 'executives'],
  description: '高管招募与管理 (hire 招募指定职位高管 / list 清单 / fire 解雇)',
  usage: '/exec <target> <hire <position> [skill] [salary] [name] | list | fire <position>>',
  requireOp: true,
  handler: (args, ctx) => {
    if (args.length < 2) {
      return {
        success: false,
        message: 'Usage: /exec <target> <hire <position> [skill] [salary] [name] | list | fire <position>>',
        assistantReply: '老板，/exec 指令格式：/exec <目标企业> <hire <COO|CFO|CMO|CTO> [技能点] [薪资] [姓名] | list | fire <职位>>'
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

    const sub = action.toLowerCase();

    // 1. /exec <target> list
    if (sub === 'list') {
      const target = targets[0];
      const rows = db.prepare(
        'SELECT * FROM executives WHERE company_id = ? ORDER BY id ASC'
      ).all(target.companyId) as unknown as ExecDbRow[];

      if (rows.length === 0) {
        return {
          success: true,
          message: `[Server: Company ${target.name} has no hired executives]`,
          assistantReply: `老板，${target.name} 目前尚未雇佣任何高级管理人员。`
        };
      }

      const lines = rows.map(r => {
        const pInfo = POSITION_TITLES[r.position] || { title: r.position.toUpperCase(), mainSkill: 'general' };
        return `• [${pInfo.title}] ${r.name}: 管理${r.skill_management} / 会计${r.skill_accounting} / 科研${r.skill_science} / 沟通${r.skill_communication} (日薪: $${r.salary.toLocaleString()})`;
      });

      const systemMsg = `[Server: Company ${target.name} has ${rows.length} executive(s)]\n${lines.join('\n')}`;
      const assistantMsg = `老板，${target.name} 当前在职高管团队如下：\n${lines.join('\n')}`;

      return {
        success: true,
        message: systemMsg,
        assistantReply: `${assistantMsg}\n§a${systemMsg}`,
        data: { companyId: target.companyId, executives: rows }
      };
    }

    // 2. /exec <target> fire <position>
    if (sub === 'fire' || sub === 'dismiss') {
      if (rest.length === 0) {
        return {
          success: false,
          message: 'Usage: /exec <target> fire <position> (e.g. /exec 1 fire COO)',
          assistantReply: '老板，请指定要解雇的职位：/exec <目标企业> fire <COO|CFO|CMO|CTO>'
        };
      }

      const posCode = normalizePositionCode(rest[0]);
      let totalFired = 0;
      for (const target of targets) {
        const res = db.prepare('DELETE FROM executives WHERE company_id = ? AND position = ?').run(target.companyId, posCode);
        totalFired += res.changes;
      }

      const pTitle = POSITION_TITLES[posCode]?.title || posCode.toUpperCase();
      const systemMsg = `[Server: Fired ${pTitle} from ${targets.length} companies (${totalFired} executives dismissed)]`;
      const assistantMsg = `老板，已成功解雇指定企业中的【${pTitle}】高管职位！`;

      return {
        success: true,
        message: systemMsg,
        assistantReply: `${assistantMsg}\n§a${systemMsg}`,
        data: { position: posCode, totalFired }
      };
    }

    // 3. /exec <target> hire <position> [skill] [salary] [name]
    if (sub === 'hire' || sub === 'recruit') {
      if (rest.length === 0) {
        return {
          success: false,
          message: 'Usage: /exec <target> hire <position> [skill] [salary] [name]',
          assistantReply: '老板，请指定要招募的高管职位：/exec <目标企业> hire <COO|CFO|CMO|CTO> [技能点数] [日薪] [姓名]'
        };
      }

      const posCode = normalizePositionCode(rest[0]);
      if (!POSITION_TITLES[posCode]) {
        return {
          success: false,
          message: `Unknown position "${rest[0]}". Allowed: COO, CFO, CMO, CTO.`,
          assistantReply: `老板，未识别的高管职位 "${rest[0]}"。仅支持：COO、CFO、CMO、CTO。`
        };
      }

      const mainSkill = Math.min(100, Math.max(1, parseInt(rest[1], 10) || 50));
      const subSkill = Math.max(0, Math.floor(mainSkill / 2));
      const salary = rest[2] !== undefined ? Math.max(0, parseFloat(rest[2]) || 0) : Math.max(500, mainSkill * 100);
      const customName = rest.slice(3).join(' ').trim() || `${posCode.toUpperCase()} Executive`;

      let sMgmt = subSkill;
      let sAcc = subSkill;
      let sSci = subSkill;
      let sComm = subSkill;

      if (posCode === 'o') sMgmt = mainSkill;
      else if (posCode === 'f') sAcc = mainSkill;
      else if (posCode === 't') sSci = mainSkill;
      else if (posCode === 'm') sComm = mainSkill;

      const now = virtualClock.nowIso();

      for (const target of targets) {
        const existing = db.prepare(
          'SELECT id FROM executives WHERE company_id = ? AND position = ? LIMIT 1'
        ).get(target.companyId, posCode) as { id: number } | undefined;

        if (existing) {
          db.prepare(`
            UPDATE executives
            SET name = ?, skill_management = ?, skill_accounting = ?, skill_science = ?,
                skill_communication = ?, salary = ?, status = 'employed'
            WHERE id = ?
          `).run(customName, sMgmt, sAcc, sSci, sComm, salary, existing.id);
        } else {
          db.prepare(`
            INSERT INTO executives (
              company_id, name, avatar, position, skill_management, skill_accounting,
              skill_science, skill_communication, salary, status, created_at
            ) VALUES (?, ?, 'images/avatars/male_01.png', ?, ?, ?, ?, ?, ?, 'employed', ?)
          `).run(target.companyId, customName, posCode, sMgmt, sAcc, sSci, sComm, salary, now);
        }
      }

      const pTitle = POSITION_TITLES[posCode].title;
      const targetNames = targets.map(t => `${t.name} (ID:${t.companyId})`).join(', ');
      const systemMsg = `[Server: Hired ${customName} as ${pTitle} (Skill: ${mainSkill}, Salary: $${salary.toLocaleString()}) for ${targetNames}]`;
      const assistantMsg = `老板，已为您成功招募 ${customName} 出任【${pTitle}】！核心技能: ${mainSkill} 点，日薪: $${salary.toLocaleString()}。`;

      return {
        success: true,
        message: systemMsg,
        assistantReply: `${assistantMsg}\n§a${systemMsg}`,
        data: {
          position: posCode,
          name: customName,
          skills: { management: sMgmt, accounting: sAcc, science: sSci, communication: sComm },
          salary
        }
      };
    }

    return {
      success: false,
      message: `Unknown exec action "${action}". Allowed: hire, list, fire.`,
      assistantReply: `老板，/exec 仅支持 hire(招募)、list(查看列表)、fire(解雇)。`
    };
  }
};
