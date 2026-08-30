import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  createSession,
  destroySession,
  switchSessionCompany
} from '../auth/session.ts';
import { registerPlayer, authenticatePlayer, db } from '../db/database.ts';
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
  if (pathname === '/signout/' || pathname === '/zh-cn/signout/' || pathname === '/logout/') {
    if (sessionToken) {
      destroySession(sessionToken);
    }
    res.writeHead(302, {
      'Location': '/zh-cn/signin/',
      'Set-Cookie': 'sessionid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'
    });
    res.end();
    return true;
  }

  // Email Login
  if (pathname === '/api/v2/auth/email/auth/' && method === 'POST') {
    const body = await readJsonBody<{ email?: string; password?: string }>(req);
    try {
      if (!body.email || !body.password) throw new Error('Email and password required');
      const auth = authenticatePlayer(body.email, body.password);
      const token = createSession(auth.playerId, auth.companyId);
      sendJson(res, { status: 'redirect', redirectUrl: '/zh-cn/landscape/' }, 200, {
        'Set-Cookie': [
          `sessionid=${token}; Path=/; HttpOnly; SameSite=Lax`,
          'django_language=zh-cn; Path=/; SameSite=Lax'
        ]
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { status: 'error', message: msg }, 400);
    }
    return true;
  }

  // Email Register
  if (pathname === '/api/v2/auth/email/connect/' && method === 'POST') {
    const body = await readJsonBody<{ email?: string; password?: string; companyName?: string }>(req);
    try {
      if (!body.email || !body.password) throw new Error('Email and password required');
      const reg = registerPlayer(body.email, body.password, body.companyName);
      const token = createSession(reg.playerId, reg.companyId);
      sendJson(res, { status: 'redirect', redirectUrl: '/zh-cn/landscape/' }, 200, {
        'Set-Cookie': [
          `sessionid=${token}; Path=/; HttpOnly; SameSite=Lax`,
          'django_language=zh-cn; Path=/; SameSite=Lax'
        ]
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { status: 'error', message: msg }, 400);
    }
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

  // Player Companies
  const playerCompaniesMatch = pathname.match(/^\/api\/v2\/players\/(\d+)\/companies\/$/);
  if (playerCompaniesMatch) {
    const playerId = Number(playerCompaniesMatch[1]);
    sendJson(res, getPlayerCompanies(playerId));
    return true;
  }

  // Preferences
  const preferencesMatch = pathname.match(/^\/api\/v2\/players\/(\d+)\/preferences\/$/);
  if (preferencesMatch && method === 'POST') {
    const playerId = Number(preferencesMatch[1]);
    const body = await readJsonBody<{ theme?: string; language?: string }>(req);
    updatePlayerPreferences(playerId, body);
    sendJson(res, { status: 'ok' });
    return true;
  }

  // Personal Data
  const personalDataMatch = pathname.match(/^\/api\/v2\/players\/(\d+)\/personal-data\/$/);
  if (personalDataMatch) {
    const playerId = Number(personalDataMatch[1]);
    sendJson(res, getPersonalData(playerId));
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

  // Company Profile & Edit
  const companyMatch = pathname.match(/^\/api\/v3\/companies\/(\d+)\/$/);
  if (companyMatch) {
    const targetCompId = Number(companyMatch[1]);
    if (method === 'PATCH') {
      const body = await readJsonBody<{ level?: number; note?: string; name?: string }>(req);
      if (body.level === 0) {
        resetCompany(targetCompId);
        sendJson(res, { status: 'ok', message: 'Company reset successful' });
        return true;
      }
      if (body.note !== undefined) db.prepare('UPDATE companies SET note = ? WHERE company_id = ?').run(body.note, targetCompId);
      if (body.name !== undefined) db.prepare('UPDATE companies SET name = ? WHERE company_id = ?').run(body.name, targetCompId);
      sendJson(res, { status: 'ok', company: getCompanyById(targetCompId) });
      return true;
    }

    const comp = getCompanyById(targetCompId);
    const buildings = getCompanyBuildings(targetCompId);
    sendJson(res, {
      companyPublicInfo: {
        id: targetCompId,
        company: comp ? comp.name : 'Private Co',
        logo: comp ? comp.logo : '',
        realmId: comp ? comp.realm_id : 0,
        deleted: false,
        moderatorSign: false,
        level: comp ? comp.level : 5,
        levelKind: 'FamilyBusiness',
        hqImage: '',
        note: comp ? comp.note : ''
      },
      history: [],
      infrastructure: { recreationBonus: 0, workers: 300, administrationOverhead: 1.0, buildings },
      player: { id: comp ? comp.player_id : 2920233, supporter: false, certificates: 0, contestWins: 0 },
      previousNames: [],
      governmentOrderTierIndex: 0
    });
    return true;
  }

  return false;
}
