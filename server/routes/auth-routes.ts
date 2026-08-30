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
    if (sessionToken) destroySession(sessionToken);
    res.writeHead(302, {
      'Location': '/zh-cn/',
      'Set-Cookie': 'sessionid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly'
    });
    res.end();
    return true;
  }

  // Email Login
  if (pathname === '/api/v2/auth/email/auth/' && method === 'POST') {
    const body = await readJsonBody<{ email: string; password: string }>(req);
    try {
      const auth = authenticatePlayer(body.email, body.password);
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
    const body = await readJsonBody<{ email: string; password: string; company?: string }>(req);
    try {
      const auth = registerPlayer(body.email, body.password, body.company);
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
  const playerCompaniesMatch = pathname.match(/^\/api\/v2\/players\/(\d+|me)\/companies\/$/);
  if (playerCompaniesMatch) {
    const pId = playerCompaniesMatch[1] === 'me' ? (currentPlayerId || 2920233) : Number(playerCompaniesMatch[1]);
    sendJson(res, getPlayerCompanies(pId));
    return true;
  }

  // Preferences
  if (pathname === '/api/v2/player-preferences/' || pathname.match(/^\/api\/v2\/players\/(\d+|me)\/preferences\/$/)) {
    if (method === 'POST') {
      const body = await readJsonBody<{ theme?: string; language?: string }>(req);
      if (currentPlayerId) updatePlayerPreferences(currentPlayerId, body);
      sendJson(res, { status: 'ok' });
      return true;
    }
  }

  // Referrals
  if (pathname.includes('/referral/')) {
    sendJson(res, {
      referrals: [],
      referralLink: 'http://127.0.0.1:3000/zh-cn/signup/?ref=private_server',
      rewardsClaimed: 0
    });
    return true;
  }

  // Tags
  if (pathname.includes('/tags/')) {
    sendJson(res, { tags: [] });
    return true;
  }

  // Personal Data
  const personalDataMatch = pathname.match(/^\/api\/v2\/players\/(\d+|me)\/personal-data\/$/);
  if (personalDataMatch) {
    const pId = personalDataMatch[1] === 'me' ? (currentPlayerId || 2920233) : Number(personalDataMatch[1]);
    sendJson(res, getPersonalData(pId));
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
  const companyMatch = pathname.match(/^\/api\/v3\/companies\/(\d+|me)\/$/);
  if (companyMatch) {
    const targetCompId = companyMatch[1] === 'me' ? (currentCompanyId || 4259175) : Number(companyMatch[1]);
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
