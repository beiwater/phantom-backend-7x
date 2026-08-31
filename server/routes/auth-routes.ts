import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  createSession,
  destroySession,
  switchSessionCompany
} from '../auth/session.ts';
import { registerPlayer, authenticatePlayer, registerOrAuthenticatePlayer, db } from '../db/database.ts';
import {
  getAuthData,
  getPlayerCompanies,
  getCompanyById,
  createCompanyForPlayer,
  resetCompany,
  updatePlayerPreferences,
  getPersonalData
} from '../game/company.ts';
import { getCompanyBuildings } from '../game/buildings.ts';

export async function handleAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  sessionToken: string | null,
  currentPlayerId: number | null,
  currentCompanyId: number | null
): Promise<boolean> {
  // Signout / Logout
  if (pathname === '/signout/' || pathname === '/zh-cn/signout/' || pathname === '/logout/' || pathname.endsWith('/signout/')) {
    if (sessionToken) destroySession(sessionToken);
    res.writeHead(302, {
      'Location': '/zh-cn/',
      'Set-Cookie': 'sessionid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly'
    });
    res.end();
    return true;
  }

  // Tutorial & Direct Form Signup POST Handler: /tutorial/, /zh-cn/tutorial/, /:locale/tutorial/...
  const tutorialPostMatch = pathname.match(/^(?:\/[a-zA-Z0-9_-]+)?\/tutorial\/?(?:\d+\/?)?$/);
  if (tutorialPostMatch && method === 'POST') {
    const body = await readJsonBody<{
      email?: string;
      password?: string;
      name?: string;
      uuid?: string;
      brand?: string;
      countryCode?: string;
    }>(req);

    try {
      const auth = registerOrAuthenticatePlayer(body.email, body.password, body.name);
      const token = createSession(auth.playerId, auth.companyId);
      res.writeHead(302, {
        'Location': '/zh-cn/landscape/',
        'Set-Cookie': [
          `sessionid=${token}; Path=/; HttpOnly; SameSite=Lax`,
          'django_language=zh-cn; Path=/; SameSite=Lax'
        ]
      });
      res.end();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(302, {
        'Location': `/zh-cn/signup/?error=${encodeURIComponent(msg)}`
      });
      res.end();
    }
    return true;
  }

  // Tutorial GET Handler -> Redirect directly to landscape
  if (tutorialPostMatch && method === 'GET') {
    let token = sessionToken;
    if (!token) {
      const auth = registerOrAuthenticatePlayer();
      token = createSession(auth.playerId, auth.companyId);
    }
    res.writeHead(302, {
      'Location': '/zh-cn/landscape/',
      'Set-Cookie': [
        `sessionid=${token}; Path=/; HttpOnly; SameSite=Lax`,
        'django_language=zh-cn; Path=/; SameSite=Lax'
      ]
    });
    res.end();
    return true;
  }

  // Email Login
  if (pathname === '/api/v2/auth/email/auth/' && method === 'POST') {
    const body = await readJsonBody<{ email: string; password: string }>(req);
    try {
      const auth = registerOrAuthenticatePlayer(body.email, body.password);
      const token = createSession(auth.playerId, auth.companyId);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `sessionid=${token}; Path=/; HttpOnly; SameSite=Lax`
      });
      res.end(JSON.stringify({ status: 'redirect', redirectUrl: '/zh-cn/landscape/' }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Email Register
  if (pathname === '/api/v2/auth/email/connect/' && method === 'POST') {
    const body = await readJsonBody<{ email: string; password: string; company?: string; name?: string }>(req);
    try {
      const auth = registerOrAuthenticatePlayer(body.email, body.password, body.company || body.name);
      const token = createSession(auth.playerId, auth.companyId);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `sessionid=${token}; Path=/; HttpOnly; SameSite=Lax`
      });
      res.end(JSON.stringify({ status: 'redirect', redirectUrl: '/zh-cn/landscape/' }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Device / Guest Login
  if ((pathname === '/api/v2/auth/device/auth/' || pathname === '/api/v2/auth/device/connect/') && method === 'POST') {
    try {
      const auth = registerOrAuthenticatePlayer();
      const token = createSession(auth.playerId, auth.companyId);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `sessionid=${token}; Path=/; HttpOnly; SameSite=Lax`
      });
      res.end(JSON.stringify({ status: 'redirect', redirectUrl: '/zh-cn/landscape/' }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Push Devices Registration: /api/v2/players/push-devices/
  if (pathname.startsWith('/api/') && pathname.includes('/push-devices/')) {
    sendJson(res, { status: 'ok' });
    return true;
  }

  // Password Reset
  if (pathname === '/api/v2/auth/email/reset/' && method === 'POST') {
    sendJson(res, { status: 'ok', message: 'Password reset link sent' });
    return true;
  }

  // Auth Data
  if (pathname === '/api/v3/companies/auth-data/') {
    sendJson(res, getAuthData(currentPlayerId, currentCompanyId));
    return true;
  }

  // Administration overhead is a numeric multiplier in the original API.
  // The private server currently has no executive/admin ledger, so its
  // persisted company model has the neutral multiplier of 1.
  const administrationOverheadMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/administration-overhead\/(?:plus-one\/)?$/);
  if (administrationOverheadMatch) {
    const requestedCompanyId = administrationOverheadMatch[1] === 'me'
      ? currentCompanyId
      : Number(administrationOverheadMatch[1]);
    if (!currentCompanyId || requestedCompanyId !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, 1);
    return true;
  }

  // Player Companies
  const playerCompaniesMatch = pathname.match(/^\/api\/v2\/players\/(\d+|me)\/companies\/$/);
  if (playerCompaniesMatch) {
    const requestedPlayerId = playerCompaniesMatch[1] === 'me'
      ? currentPlayerId
      : Number(playerCompaniesMatch[1]);
    if (!currentPlayerId || requestedPlayerId !== currentPlayerId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getPlayerCompanies(currentPlayerId));
    return true;
  }

  // Preferences
  if (pathname === '/api/v2/player-preferences/' || pathname.match(/^\/api\/v2\/players\/(\d+|me)\/preferences\/$/)) {
    if (method === 'POST') {
      if (!currentPlayerId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const body = await readJsonBody<{ theme?: string; language?: string }>(req);
      updatePlayerPreferences(currentPlayerId, body);
      sendJson(res, { status: 'ok' });
      return true;
    }
  }

  // Referrals
  if (pathname.startsWith('/api/') && pathname.includes('/referral/')) {
    sendJson(res, {
      referrals: [],
      referralLink: 'http://127.0.0.1:3000/zh-cn/signup/?ref=private_server',
      rewardsClaimed: 0
    });
    return true;
  }

  // Tags
  if (method === 'GET' && pathname.startsWith('/api/') && pathname.includes('/tags/')) {
    sendJson(res, { tags: [] });
    return true;
  }

  // Private company note lookup used by the public profile page.
  const companyNoteMatch = pathname.match(/^\/api\/v2\/companies\/(me|\d+)\/note\/(\d+)\/$/);
  if (companyNoteMatch && method === 'GET') {
    sendJson(res, { note: '' });
    return true;
  }


  // Personal Data
  const personalDataMatch = pathname.match(/^\/api\/v2\/players\/(\d+|me)\/personal-data\/$/);
  if (personalDataMatch) {
    const requestedPlayerId = personalDataMatch[1] === 'me'
      ? currentPlayerId
      : Number(personalDataMatch[1]);
    if (!currentPlayerId || requestedPlayerId !== currentPlayerId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getPersonalData(currentPlayerId));
    return true;
  }

  // Realm Switch
  const realmSwitchMatch = pathname.match(/^\/api\/v1\/realm\/(\d+)\/switch\/$/);
  if (realmSwitchMatch && method === 'POST') {
    if (!currentPlayerId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const targetRealm = Number(realmSwitchMatch[1]);
    const comps = getPlayerCompanies(currentPlayerId);
    const targetComp = comps.find(c => c.realmId === targetRealm);

    if (targetComp) {
      if (sessionToken) switchSessionCompany(sessionToken, targetComp.id);
      sendJson(res, { status: 'ok', companyId: targetComp.id, realmId: targetRealm });
    } else {
      const newComp = createCompanyForPlayer(currentPlayerId, `Co-Realm${targetRealm}`, targetRealm);
      if (newComp && sessionToken) switchSessionCompany(sessionToken, newComp.company_id);
      sendJson(res, { status: 'ok', companyId: newComp?.company_id, realmId: targetRealm });
    }
    return true;
  }

  // Public company profile lookup: /api/v3/companies-by-company/:realm/:name/
  const companyByNameMatch = pathname.match(/^\/api\/v3\/companies-by-company\/(\d+)\/(.+?)(?:\/)?$/);
  if (companyByNameMatch && method === 'GET') {
    const realmId = Number(companyByNameMatch[1]);
    let slug: string;
    try {
      slug = decodeURIComponent(companyByNameMatch[2]);
    } catch {
      sendJson(res, { error: 'Invalid company name' }, 400);
      return true;
    }

    const companies = db.prepare(`
      SELECT company_id, player_id, name, logo, level, rating, created_at, note,
             extra_building_slots, realm_id
      FROM companies
      WHERE realm_id = ?
      ORDER BY id ASC
    `).all(realmId) as unknown as Array<{
      company_id: number;
      player_id: number;
      name: string;
      logo: string;
      level: number;
      rating: string;
      created_at: string;
      note: string;
      extra_building_slots?: number;
      realm_id: number;
    }>;
    const comp = companies.find(company => company.name.replace(/[\/\\\s]/g, '-') === slug);
    if (!comp) {
      sendJson(res, { error: 'Company not found' }, 404);
      return true;
    }

    const buildings = getCompanyBuildings(comp.company_id);
    const buildingValue = buildings.reduce(
      (total, building) => total + (Number(building.cost) || 0),
      0
    );
    const extraBuildingSlots = Number(comp.extra_building_slots) || 0;
    sendJson(res, {
      companyPublicInfo: {
        id: comp.company_id,
        company: comp.name,
        logo: comp.logo || '',
        realmId: comp.realm_id,
        deleted: false,
        moderatorSign: false,
        level: comp.level || 5,
        levelKind: 'FamilyBusiness',
        hqImage: '',
        note: comp.note || '',
        maxBuildings: 10,
        rank: null,
        evaRank: null,
        ratingCode: comp.rating || 'BBB',
        dateJoined: comp.created_at,
        dateReset: null,
        lastSeen: 'online',
        productionModifier: 0,
        salesModifier: 0,
        ratingBracket: 'A- to BBB',
        courseId: null,
        countryCodeIsoUserSet: '',
        extraBuildingSlots,
        online: 'online'
      },
      history: {
        value: (Number(comp.money) || 0) + buildingValue,
        buildingValue,
        patentsValue: 0,
        bondsPayable: 0
      },
      infrastructure: {
        recreationBonus: 0,
        workers: 300,
        administrationOverhead: 1,
        buildings
      },
      player: {
        id: comp.player_id,
        communicationRestricted: false,
        timezoneOffset: 0,
        supporter: false
      },
      previousNames: [],
      governmentOrderTierIndex: null
    });
    return true;
  }

  // Company Profile & Edit
  const companyMatch = pathname.match(/^\/api\/v3\/companies\/(\d+|me)\/$/);
  if (companyMatch) {
    const requestedCompany = companyMatch[1];
    const targetCompId = requestedCompany === 'me' ? currentCompanyId : Number(requestedCompany);
    if (!targetCompId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }

    if (method === 'PATCH') {
      if (!currentCompanyId || targetCompId !== currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const body = await readJsonBody<{ level?: number; note?: string; name?: string }>(req);
      const company = getCompanyById(currentCompanyId);
      if (!company) {
        sendJson(res, { error: 'Company not found' }, 404);
        return true;
      }
      if (body.level === 0) {
        resetCompany(currentCompanyId);
        sendJson(res, { status: 'ok', message: 'Company reset successful' });
        return true;
      }
      if (body.note !== undefined) {
        db.prepare('UPDATE companies SET note = ? WHERE company_id = ?').run(String(body.note), currentCompanyId);
      }
      if (body.name !== undefined) {
        db.prepare('UPDATE companies SET name = ? WHERE company_id = ?').run(String(body.name), currentCompanyId);
      }
      sendJson(res, { status: 'ok', company: getCompanyById(currentCompanyId) });
      return true;
    }

    const comp = getCompanyById(targetCompId);
    if (!comp) {
      sendJson(res, { error: 'Company not found' }, 404);
      return true;
    }
    const buildings = getCompanyBuildings(targetCompId);
    sendJson(res, {
      companyPublicInfo: {
        id: targetCompId,
        company: comp.name,
        logo: comp.logo,
        realmId: comp.realm_id,
        deleted: false,
        moderatorSign: false,
        level: comp.level,
        levelKind: 'FamilyBusiness',
        note: comp.note
      },
      history: [],
      infrastructure: { recreationBonus: 0, workers: 300, administrationOverhead: 1.0, buildings },
      player: { id: comp.player_id, supporter: false, certificates: 0, contestWins: 0 },
      previousNames: [],
      governmentOrderTierIndex: 0
    });
    return true;
  }

  return false;
}
