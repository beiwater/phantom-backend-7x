import { db } from '../../db/database.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import type { CommandContext, TargetCompany } from './types.ts';

interface CompanyDbRow {
  id: number;
  company_id: number;
  name: string;
  realm_id: number;
}

function mapRow(row: CompanyDbRow): TargetCompany {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    realmId: row.realm_id ?? 0
  };
}

export function resolveTargets(
  selector: string,
  ctx: CommandContext
): { targets: TargetCompany[]; error?: string } {
  const token = selector.trim();
  if (!token) {
    return { targets: [], error: 'Target selector cannot be empty.' };
  }

  // 1. Selector @s (Self / Executor)
  if (token === '@s') {
    if (!ctx.executorCompanyId) {
      return {
        targets: [],
        error: 'Cannot resolve @s: No executor context provided. Please specify target company explicitly (e.g. company ID or @a).'
      };
    }
    const comp = companyRepository.findById(ctx.executorCompanyId);
    if (!comp) {
      return { targets: [], error: `Company with ID ${ctx.executorCompanyId} not found.` };
    }
    return {
      targets: [
        {
          id: comp.id,
          companyId: comp.companyId,
          name: comp.name,
          realmId: comp.realmId
        }
      ]
    };
  }

  // 2. Selector @a (All companies)
  if (token === '@a') {
    let rows: CompanyDbRow[];
    if (ctx.realmId !== undefined && ctx.realmId !== null) {
      rows = db.prepare(
        'SELECT id, company_id, name, realm_id FROM companies WHERE realm_id = ? ORDER BY id ASC'
      ).all(ctx.realmId) as unknown as CompanyDbRow[];
    } else {
      rows = db.prepare(
        'SELECT id, company_id, name, realm_id FROM companies ORDER BY id ASC'
      ).all() as unknown as CompanyDbRow[];
    }
    if (rows.length === 0) {
      return { targets: [], error: 'No companies found in realm.' };
    }
    return { targets: rows.map(mapRow) };
  }

  // 3. Numeric ID (company_id or auto-increment id)
  if (/^\d+$/.test(token)) {
    const numId = Number(token);
    const row = db.prepare(
      'SELECT id, company_id, name, realm_id FROM companies WHERE company_id = ? OR id = ? LIMIT 1'
    ).get(numId, numId) as unknown as CompanyDbRow | undefined;

    if (row) {
      return { targets: [mapRow(row)] };
    }
    return { targets: [], error: `Company with ID ${numId} not found.` };
  }

  // 4. Name match (exact or case-insensitive)
  // Strip optional quotes
  const cleanName = token.replace(/^["']|["']$/g, '');
  const row = db.prepare(
    'SELECT id, company_id, name, realm_id FROM companies WHERE name = ? COLLATE NOCASE LIMIT 1'
  ).get(cleanName) as unknown as CompanyDbRow | undefined;

  if (row) {
    return { targets: [mapRow(row)] };
  }

  return { targets: [], error: `Company with name "${cleanName}" not found.` };
}
