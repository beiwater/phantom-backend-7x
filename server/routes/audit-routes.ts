import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../db/database.ts';
import { sendJson, readJsonBody } from './utils.ts';
import { auditRepository, banCompany } from '../repositories/audit-repository.ts';
import { getCompanyById } from '../game/company.ts';
import { buildingRepository } from '../repositories/building-repository.ts';
import { toSimCompaniesBuildingDTO } from '../compatibility/simcompanies/building-dto.ts';

export async function handleAuditRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentPlayerId: number | null,
  currentCompanyId: number | null
): Promise<boolean> {
  const now = new Date();

  // Issue #84: Admin authorization check
  let isAdmin = false;
  if (currentPlayerId) {
    const player = db.prepare('SELECT is_admin FROM players WHERE player_id = ?').get(currentPlayerId) as { is_admin?: number } | undefined;
    isAdmin = Boolean(player && player.is_admin === 1);
  } else if (currentCompanyId) {
    const player = db.prepare('SELECT p.is_admin FROM players p JOIN companies c ON c.player_id = p.player_id WHERE c.company_id = ?').get(currentCompanyId) as { is_admin?: number } | undefined;
    isAdmin = Boolean(player && player.is_admin === 1);
  }

  const isAdminOnlyRoute =
    pathname.startsWith('/api/v2/audit/') ||
    pathname === '/api/v2/audits/' ||
    pathname === '/api/v2/audits' ||
    pathname.startsWith('/api/v2/moderator-notes') ||
    Boolean(pathname.match(/^\/api\/v2\/players\/\d+\/moderator-notes/)) ||
    pathname.startsWith('/api/v2/messages-cases') ||
    pathname.startsWith('/api/v2/audit-ip/') ||
    pathname.startsWith('/api/v1/audit-requests') ||
    pathname.startsWith('/api/v2/admin/') ||
    pathname.startsWith('/api/v2/analytics/') ||
    pathname.startsWith('/api/v3/analytics/') ||
    Boolean(pathname.match(/^\/api\/v2\/companies\/\d+\/ban/));

  if (isAdminOnlyRoute) {
    if (!isAdmin) {
      sendJson(res, { error: 'Forbidden' }, 403);
      return true;
    }
  }
  // 1. Recently deleted companies/players: /api/v2/audit/recently-deleted/
  if (pathname === '/api/v2/audit/recently-deleted/' && method === 'GET') {
    sendJson(res, {
      players: [
        {
          id: 80112,
          email: "shadow_botter_99@darknet.io",
          deleteReason: "违规使用自动化挂机脚本进行 24 小时高频零售与倒买倒卖 (Bot Scripting & Multi-Accounting)",
          deleteDatetime: new Date(now.getTime() - 3600 * 1000 * 4).toISOString(),
          companies: [
            {
              id: 7706929,
              company: "Shadow Automation Ltd.",
              logo: "images/buildings/other/hq_cyberpunk_tier01.png",
              realmId: 0
            }
          ]
        },
        {
          id: 80113,
          email: "market_manipulator_01@protonmail.com",
          deleteReason: "利用多个关联小号向主号低价（$0.01）倾销高等级科技物料 (Illicit Below-Market Transfer)",
          deleteDatetime: new Date(now.getTime() - 3600 * 1000 * 18).toISOString(),
          companies: [
            {
              id: 4775639,
              company: "Zero Cent Resource Dumping Co.",
              logo: "images/buildings/other/hq_tier02.png",
              realmId: 0
            }
          ]
        },
        {
          id: 80114,
          email: "spammer_vip_888@tempmail.org",
          deleteReason: "在公共交易与社交聊天室持续发布非法的场外交易广告与钓鱼链接 (Spamming & Chatroom Abuse)",
          deleteDatetime: new Date(now.getTime() - 3600 * 1000 * 42).toISOString(),
          companies: [
            {
              id: 6804787,
              company: "Off-Platform RMT Spammer",
              logo: "images/buildings/other/hq_banana.png",
              realmId: 0
            }
          ]
        },
        {
          id: 80115,
          email: "chargeback_scam_77@burner.net",
          deleteReason: "恶意发起支付退款申请并转移账户内 SimBoosts 资产 (Payment Chargeback Abuse)",
          deleteDatetime: new Date(now.getTime() - 3600 * 1000 * 96).toISOString(),
          companies: [
            {
              id: 8570017,
              company: "Fraudulent Chargeback Corp.",
              logo: "images/buildings/other/hq_haunted.svg",
              realmId: 0
            }
          ]
        }
      ]
    });
    return true;
  }

  // 2. Currently suspended companies: /api/v2/audit/suspended-companies/
  if (pathname === '/api/v2/audit/suspended-companies/' && method === 'GET') {
    sendJson(res, {
      suspendedCompanies: [
        {
          id: 7706929,
          company: "Shadow Automation Ltd.",
          logo: "images/buildings/other/hq_cyberpunk_tier01.png",
          realmId: 0,
          reason: "s",
          lastAction: new Date(now.getTime() - 3600 * 1000 * 2).toISOString()
        },
        {
          id: 4775639,
          company: "Zero Cent Resource Dumping Co.",
          logo: "images/buildings/other/hq_tier02.png",
          realmId: 0,
          reason: "m",
          lastAction: new Date(now.getTime() - 3600 * 1000 * 14).toISOString()
        },
        {
          id: 6804787,
          company: "Off-Platform RMT Spammer",
          logo: "images/buildings/other/hq_banana.png",
          realmId: 0,
          reason: "c",
          lastAction: new Date(now.getTime() - 3600 * 1000 * 30).toISOString()
        }
      ]
    });
    return true;
  }

  // 3. Global audits list: /api/v2/audits/ — real persisted moderation rows
  if (pathname === '/api/v2/audits/' && method === 'GET') {
    if (!isAdmin) {
      sendJson(res, { error: 'Forbidden' }, 403);
      return true;
    }
    const rows = auditRepository.list(200);
    sendJson(res, rows.map(a => ({
      id: a.id,
      company: { id: a.targetCompanyId },
      action: a.action,
      reason: a.reason,
      datetime: a.createdAt,
      auditorCompanyId: a.actorCompanyId
    })));
    return true;
  }

  // 4. Moderator notes: /api/v2/moderator-notes/
  const playerModNotesMatch = pathname.match(/^\/api\/v2\/players\/(\d+)\/moderator-notes\/?(?:\d+\/?)?$/);
  if ((pathname.startsWith('/api/v2/moderator-notes/') || pathname === '/api/v2/moderator-notes' || playerModNotesMatch) && method === 'GET') {
    sendJson(res, [
      {
        id: 201,
        company: {
          id: 7706929,
          company: "Shadow Automation Ltd.",
          logo: "images/buildings/other/hq_cyberpunk_tier01.png",
          realmId: 0
        },
        note: "Suspected multi-boxing farm across residential IP pool.",
        moderatorNote: "Suspected multi-boxing farm across residential IP pool.",
        datetime: new Date(now.getTime() - 3600 * 1000 * 6).toISOString(),
        moderator: {
          id: 1,
          name: "UN Chief Inspector",
          company: "UN Compliance"
        },
        author: {
          id: 1,
          name: "UN Chief Inspector",
          company: { id: 1, company: "UN Compliance", logo: "", realmId: 0 }
        },
        about: {
          id: 7706929,
          company: "Shadow Automation Ltd.",
          logo: "images/buildings/other/hq_cyberpunk_tier01.png",
          realmId: 0
        }
      },
      {
        id: 202,
        company: {
          id: 4775639,
          company: "Zero Cent Resource Dumping Co.",
          logo: "images/buildings/other/hq_tier02.png",
          realmId: 0
        },
        note: "Contract transfer history shows recurring $0.01 contracts under investigation.",
        moderatorNote: "Contract transfer history shows recurring $0.01 contracts under investigation.",
        datetime: new Date(now.getTime() - 3600 * 1000 * 20).toISOString(),
        moderator: {
          id: 2,
          name: "UN Auditor Alpha",
          company: "UN Market Compliance"
        },
        author: {
          id: 2,
          name: "UN Auditor Alpha",
          company: { id: 2, company: "UN Market Compliance", logo: "", realmId: 0 }
        },
        about: {
          id: 4775639,
          company: "Zero Cent Resource Dumping Co.",
          logo: "images/buildings/other/hq_tier02.png",
          realmId: 0
        }
      }
    ]);
    return true;
  }

  // 5. Messages cases (reported chats): /api/v2/messages-cases/ & /api/v2/messages-cases/:id/
  const messageCaseDetailMatch = pathname.match(/^\/api\/v2\/messages-cases\/(\d+)\/?$/);
  if (messageCaseDetailMatch) {
    const caseId = Number(messageCaseDetailMatch[1]);
    const caseDetail = {
      id: caseId,
      snitch: { id: 4259175, company: "lifeline", logo: "images/buildings/other/hq_tier01.png" },
      offender: { id: 6804787, company: "Off-Platform RMT Spammer", logo: "images/buildings/other/hq_banana.png" },
      snitchBanned: false,
      offenderBanned: true,
      datetime: new Date(now.getTime() - 3600 * 1000 * 43).toISOString(),
      message: "Selling 1M SimBoosts and Q10 items on external Discord! PM me for link!",
      resolvedBy: { id: 1, company: "UN System Superadmin", logo: "images/buildings/other/hq_tier01.png" },
      messages: [
        {
          id: 1001,
          sender: { id: 6804787, company: "Off-Platform RMT Spammer" },
          text: "Selling 1M SimBoosts and Q10 items on external Discord! PM me for link!",
          body: "Selling 1M SimBoosts and Q10 items on external Discord! PM me for link!",
          datetime: new Date(now.getTime() - 3600 * 1000 * 43).toISOString()
        },
        {
          id: 1002,
          sender: { id: 4259175, company: "lifeline" },
          text: "Reported to UN Compliance.",
          body: "Reported to UN Compliance.",
          datetime: new Date(now.getTime() - 3600 * 1000 * 42).toISOString()
        }
      ]
    };

    if (method === 'GET') {
      sendJson(res, caseDetail);
      return true;
    }
    if (method === 'PATCH') {
      const body = await readJsonBody<{ banOffender?: boolean; banSnitch?: boolean }>(req);
      const updatedCase = {
        ...caseDetail,
        offenderBanned: body?.banOffender ?? caseDetail.offenderBanned,
        snitchBanned: body?.banSnitch ?? caseDetail.snitchBanned,
        resolvedBy: { id: 1, company: "UN System Superadmin", logo: "images/buildings/other/hq_tier01.png" }
      };
      sendJson(res, updatedCase);
      return true;
    }
  }

  if ((pathname === '/api/v2/messages-cases/' || pathname === '/api/v2/messages-cases') && method === 'GET') {
    sendJson(res, [
      {
        id: 301,
        snitch: { id: 4259175, company: "lifeline", logo: "images/buildings/other/hq_tier01.png" },
        offender: { id: 6804787, company: "Off-Platform RMT Spammer", logo: "images/buildings/other/hq_banana.png" },
        snitchBanned: false,
        offenderBanned: true,
        datetime: new Date(now.getTime() - 3600 * 1000 * 43).toISOString(),
        message: "Selling 1M SimBoosts and Q10 items on external Discord! PM me for link!",
        resolvedBy: null
      }
    ]);
    return true;
  }

  // 6. Audit requests (v1): /api/v1/audit-requests/
  if (pathname === '/api/v1/audit-requests/' && method === 'GET') {
    sendJson(res, [
      {
        id: 401,
        targetCompanyId: 7706929,
        targetCompanyName: "Shadow Automation Ltd.",
        requester: "Automated Fraud Detection",
        reason: "Unusual continuous transaction pattern detected",
        status: "pending",
        created: new Date(now.getTime() - 3600 * 1000 * 3).toISOString()
      }
    ]);
    return true;
  }

  // 7. Purchase detective (v2 admin)
  if (pathname === '/api/v2/admin/purchase-detective/' && method === 'GET') {
    sendJson(res, { purchases: [] });
    return true;
  }

  // 8. Admin analytics endpoints
  if (pathname.startsWith('/api/v2/analytics/') || pathname.startsWith('/api/v3/analytics/')) {
    sendJson(res, []);
    return true;
  }

  // 9. Company specific audit endpoints
  // 9a. /api/v2/audit/:id/personal/
  const auditPersonalMatch = pathname.match(/^\/api\/v2\/audit\/(\d+)\/personal\/?$/);
  if (auditPersonalMatch && method === 'GET') {
    const targetCompanyId = Number(auditPersonalMatch[1]);
    const comp = getCompanyById(targetCompanyId) || {
      company_id: targetCompanyId,
      player_id: targetCompanyId + 10000,
      name: `Audited Company #${targetCompanyId}`,
      money: 154200,
      simboosts: 250,
      level: 12,
      rating: "BBB",
      logo: "images/buildings/other/hq_tier01.png",
      created_at: new Date(now.getTime() - 86400000 * 30).toISOString()
    };
    const player = db.prepare('SELECT * FROM players WHERE player_id = ?').get(comp.player_id) as Record<string, unknown> | undefined;
    const rawBuildings = buildingRepository.findByCompany(targetCompanyId);
    const buildingsDTO = rawBuildings.map(toSimCompaniesBuildingDTO);
    sendJson(res, {
      player: {
        id: comp.player_id,
        email: player?.email || `user_${targetCompanyId}@simcompanies.local`,
        created: player?.created_at || comp.created_at,
        language: player?.language || 'zh-cn',
        countryCodeIso: 'AU',
        banned: false,
        suspended: false
      },
      auditInfo: {
        company: {
          id: comp.company_id,
          name: comp.name,
          money: comp.money,
          simboosts: comp.simboosts,
          level: comp.level,
          rating: comp.rating,
          created: comp.created_at
        }
      },
      companyPublicInfo: {
        id: comp.company_id,
        name: comp.name,
        money: comp.money,
        simboosts: comp.simboosts,
        level: comp.level,
        rating: comp.rating,
        logo: comp.logo || ''
      },
      moderatorInfo: {
        player: {
          id: comp.player_id,
          ip: '127.0.0.1',
          lastSeen: new Date().toISOString()
        }
      },
      buildings: buildingsDTO,
      email: player?.email || `user_${targetCompanyId}@simcompanies.local`,
      language: player?.language || 'zh-cn',
      countryCode: 'AU',
      previousEmailAddresses: [],
      recentIpAddresses: ['127.0.0.1'],
      moderatorNotes: [],
      companiesRegisteredFromTheSameIP: [],
      teachingCourses: [],
      course: null,
      featureFlags: '{}',
      botSuspicion: false,
      selloutSuspension: false,
      suspendedReason: null,
      referrals: [],
      collectibles: [],
      adminCanDelete: true
    });
    return true;
  }

  // 9b. /api/v2/audit/:id/audits/
  const auditAuditsMatch = pathname.match(/^\/api\/v2\/audit\/(\d+)\/audits\/?$/);
  if (auditAuditsMatch && method === 'GET') {
    sendJson(res, []);
    return true;
  }

  // 9c. /api/v2/audit/:id/auth/
  const auditAuthMatch = pathname.match(/^\/api\/v2\/audit\/(\d+)\/auth\/?$/);
  if (auditAuthMatch && method === 'GET') {
    sendJson(res, []);
    return true;
  }

  // 9d. /api/v2/audit/:id/payments/
  const auditPaymentsMatch = pathname.match(/^\/api\/v2\/audit\/(\d+)\/payments\/?$/);
  if (auditPaymentsMatch && method === 'GET') {
    sendJson(res, []);
    return true;
  }

  // 9e. /api/v2/audit/:id/contracts/
  const auditContractsMatch = pathname.match(/^\/api\/v2\/audit\/(\d+)\/contracts\/?$/);
  if (auditContractsMatch && method === 'GET') {
    sendJson(res, []);
    return true;
  }

  // 9f. /api/v2/audit/:id/market-trades/
  const auditTradesMatch = pathname.match(/^\/api\/v2\/audit\/(\d+)\/market-trades\/?$/);
  if (auditTradesMatch && method === 'GET') {
    sendJson(res, []);
    return true;
  }

  // 9g. /api/v2/companies/:id/ban/ — real ban (deleted flag + session revoke)
  const banMatch = pathname.match(/^\/api\/v2\/companies\/(\d+)\/ban\/?$/);
  if (banMatch) {
    if (!isAdmin) {
      sendJson(res, { error: 'Forbidden' }, 403);
      return true;
    }
    const targetCompanyId = Number(banMatch[1]);
    if (method === 'GET') {
      sendJson(res, auditRepository.listForCompany(targetCompanyId));
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody<{ reason?: string }>(req);
      const result = banCompany(targetCompanyId, currentCompanyId, body.reason || '');
      if (!result.banned) {
        sendJson(res, { error: 'Company not found' }, 404);
        return true;
      }
      sendJson(res, { success: true, message: 'Company banned', auditId: result.audits.id });
      return true;
    }
  }

  // 10. IP Audit: /api/v2/audit-ip/:playerId/:ipHash/
  const ipAuditMatch = pathname.match(/^\/api\/v2\/audit-ip\/(\d+)\/([^/]+)\/?$/);
  if (ipAuditMatch && method === 'GET') {
    sendJson(res, { events: [] });
    return true;
  }

  // 11. Player personal data export: /api/v2/players/:id/personal-data/
  const personalDataMatch = pathname.match(/^\/api\/v2\/players\/(\d+)\/personal-data\/?$/);
  if (personalDataMatch && method === 'GET') {
    const targetPlayerId = Number(personalDataMatch[1]);
    if (!isAdmin && (!currentPlayerId || targetPlayerId !== currentPlayerId)) {
      sendJson(res, { error: 'Forbidden' }, 403);
      return true;
    }
    sendJson(res, { data: 'Personal data export ready' });
    return true;
  }
  // 12. Newcomers: /api/v2/newcomers/
  if ((pathname === '/api/v2/newcomers/' || pathname === '/api/v2/newcomers') && method === 'GET') {
    const rows = db.prepare(`
      SELECT company_id, name, logo, realm_id, created_at, note
      FROM companies
      ORDER BY id DESC
      LIMIT 50
    `).all() as Array<{
      company_id: number;
      name: string;
      logo: string | null;
      realm_id: number | null;
      created_at: string | null;
      note: string | null;
    }>;

    const newcomers = rows.map(r => ({
      id: r.company_id,
      company: r.name,
      logo: r.logo || '',
      realmId: r.realm_id ?? 0,
      dateJoined: r.created_at || new Date().toISOString(),
      noteTop: r.note || ''
    }));

    sendJson(res, newcomers);
    return true;
  }

  // 13. Redeem bonus code: /api/v2/redeem-code/:playerId/
  const redeemCodeMatch = pathname.match(/^\/api\/v2\/redeem-code\/(\d+)\/?$/);
  if (redeemCodeMatch && method === 'POST') {
    const playerId = Number(redeemCodeMatch[1]);
    const body = await readJsonBody<{ code?: string }>(req);
    const code = (body?.code || '').trim().toUpperCase();

    const VALID_CODES: Record<string, true> = {
      'WELCOME2026': true,
      'PROMO50': true,
      'SIMBOOSTS': true,
      'BONUS2026': true
    };
    if (!code || !VALID_CODES[code]) {
      sendJson(res, {
        error: 'Invalid or expired bonus code',
        code: 'INVALID_CODE'
      }, 400);
      return true;
    }

    // Credit 50 SimBoosts to player's first company if it exists
    const company = db.prepare('SELECT company_id, simboosts FROM companies WHERE player_id = ? ORDER BY id ASC LIMIT 1').get(playerId) as { company_id: number; simboosts: number } | undefined;
    if (company) {
      db.prepare('UPDATE companies SET simboosts = simboosts + 50 WHERE company_id = ?').run(company.company_id);
    }

    sendJson(res, {
      success: true,
      reward: '50 SimBoosts'
    });
    return true;
  }

  return false;
}
