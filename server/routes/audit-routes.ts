import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../db/database.ts';
import { sendJson, readJsonBody } from './utils.ts';
import { getCompanyById } from '../game/company.ts';
import { buildingRepository } from '../repositories/building-repository.ts';
import { toSimCompaniesBuildingDTO } from '../compatibility/simcompanies/building-dto.ts';

export async function handleAuditRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  _currentCompanyId: number | null
): Promise<boolean> {
  const now = new Date();

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

  // 3. Global audits / moderator notes list: /api/v2/audits/
  if (pathname === '/api/v2/audits/' && method === 'GET') {
    sendJson(res, [
      {
        id: 101,
        company: { id: 7706929, name: "Shadow Automation Ltd." },
        reason: "Detected high-frequency automated retail calls (10 requests/sec). Account flagged for bot audit.",
        datetime: new Date(now.getTime() - 3600 * 1000 * 5).toISOString(),
        auditor: "UN Security Bot"
      },
      {
        id: 102,
        company: { id: 4775639, name: "Zero Cent Resource Dumping Co." },
        reason: "Contract audit flagged: 50,000 units of Q5 Aerospace components transferred at $0.01 to sub-account.",
        datetime: new Date(now.getTime() - 3600 * 1000 * 19).toISOString(),
        auditor: "UN Market Compliance"
      },
      {
        id: 103,
        company: { id: 4259175, name: "lifeline" },
        reason: "Initial baseline bootstrap verified. All ledger transactions reconciled.",
        datetime: new Date(now.getTime() - 3600 * 1000 * 120).toISOString(),
        auditor: "UN System Superadmin"
      }
    ]);
    return true;
  }

  // 4. Moderator notes: /api/v2/moderator-notes/
  if (pathname === '/api/v2/moderator-notes/' && method === 'GET') {
    sendJson(res, [
      {
        id: 201,
        companyId: 7706929,
        companyName: "Shadow Automation Ltd.",
        note: "Suspected multi-boxing farm across residential IP pool.",
        datetime: new Date(now.getTime() - 3600 * 1000 * 6).toISOString(),
        moderator: "UN Chief Inspector"
      },
      {
        id: 202,
        companyId: 4775639,
        companyName: "Zero Cent Resource Dumping Co.",
        note: "Contract transfer history shows recurring $0.01 contracts under investigation.",
        datetime: new Date(now.getTime() - 3600 * 1000 * 20).toISOString(),
        moderator: "UN Auditor Alpha"
      }
    ]);
    return true;
  }

  // 5. Messages cases (reported chats): /api/v2/messages-cases/
  if (pathname === '/api/v2/messages-cases/' && method === 'GET') {
    sendJson(res, [
      {
        id: 301,
        sender: { id: 6804787, name: "Off-Platform RMT Spammer" },
        reportedBy: { id: 4259175, name: "lifeline" },
        message: "Selling 1M SimBoosts and Q10 items on external Discord! PM me for link!",
        datetime: new Date(now.getTime() - 3600 * 1000 * 43).toISOString(),
        status: "RESOLVED_BANNED"
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
    if (pathname.includes('/revenue-') || pathname.includes('/simboosts-spend/') || pathname.includes('/player-')) {
      sendJson(res, []);
      return true;
    }
    sendJson(res, {});
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

  // 9g. /api/v2/companies/:id/ban/
  const banMatch = pathname.match(/^\/api\/v2\/companies\/(\d+)\/ban\/?$/);
  if (banMatch) {
    if (method === 'GET') {
      sendJson(res, []);
      return true;
    }
    if (method === 'POST') {
      sendJson(res, { success: true, message: 'Ban status updated' });
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
    sendJson(res, { data: 'Personal data export ready' });
    return true;
  }

  return false;
}
