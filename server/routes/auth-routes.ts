import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  createSession,
  destroySession,
  switchSessionCompany,
  buildSessionCookie
} from '../auth/session.ts';
import { registerPlayer, authenticatePlayer, registerOrAuthenticatePlayer, db } from '../db/database.ts';
import { checkRateLimit } from '../security/rate-limiter.ts';
import {
  getAuthData,
  getPlayerCompanies,
  getCompanyById,
  createCompanyForPlayer,
  resetCompany,
  updatePlayerPreferences,
  updateCompanySettings,
  getPersonalData
} from '../game/company.ts';
import { getCompanyBuildings } from '../game/buildings.ts';

const COMPANY_NAME_COLORS = ['Aero', 'Almond', 'Amaranth', 'Amber', 'Amethyst', 'Apricot', 'Auburn', 'Azure', 'Beige', 'Bistre', 'Blue', 'Brass', 'Bronze', 'Cedar', 'Cerulean', 'Cobalt', 'Copper', 'Coral', 'Crimson', 'Cyan'];
const COMPANY_NAME_SIZES = ['Big', 'Colossal', 'Gigantic', 'Great', 'Huge', 'Immense', 'Little', 'Mighty', 'Mini', 'Vast'];
const COMPANY_NAME_ADJECTIVES = ['Abundant', 'Excellent', 'Outstanding', 'Superb', 'Superior', 'Supreme', 'Splendid', 'Magnificent', 'Wonderful', 'Dynamic'];
const COMPANY_NAME_TRADES = ['Aerospace', 'Agriculture', 'Agro', 'Automotive', 'Bank', 'Carbon', 'Construction', 'Design', 'Electronics', 'Energy', 'Factory', 'Farms', 'Food', 'Innovations', 'Labs', 'Materials', 'Mining', 'Motors', 'Ore', 'Trade', 'Trading'];

/**
 * P1-04: naming-flow conflict suggestions, mirroring the original
 * frontend suggestion generator (color/size/adjective/trade word pool).
 */
function buildCompanyNameSuggestions(count = 3): string[] {
  const pick = (list: string[]): string => list[Math.floor(Math.random() * list.length)];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const suggestion = [pick(COMPANY_NAME_ADJECTIVES), pick(COMPANY_NAME_SIZES), pick(COMPANY_NAME_TRADES)].join(' ');
    if (!out.includes(suggestion)) out.push(suggestion);
  }
  return out;
}

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
      'Set-Cookie': buildSessionCookie('')
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

    // P1-04: the original signup form posts the device/user-agent derived
    // `name` field. It must never become the company name: new companies
    // start unnamed and the player names them via /create/.
    try {
      const auth = registerOrAuthenticatePlayer(body.email, body.password);
      const token = createSession(auth.playerId, auth.companyId);
      res.writeHead(302, {
        'Location': '/zh-cn/create/',
        'Set-Cookie': [
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
        buildSessionCookie(token),
        'django_language=zh-cn; Path=/; SameSite=Lax'
      ]
    });
    res.end();
    return true;
  }

  // Email Login
  if (pathname === '/api/v2/auth/email/auth/' && method === 'POST') {
    const ip = req.socket.remoteAddress || '127.0.0.1';
    const rateCheck = checkRateLimit(`auth:login:${ip}`, 30, 60000);
    if (!rateCheck.allowed) {
      sendJson(res, { error: 'Too many login attempts. Please try again later.', code: 'RATE_LIMITED' }, 429, {
        'Retry-After': String(Math.ceil(rateCheck.resetMs / 1000))
      });
      return true;
    }

    const body = await readJsonBody<{ email: string; password: string }>(req);
    try {
      if (!body.email || !body.password) {
        sendJson(res, { error: 'Email and password are required' }, 400);
        return true;
      }
      const auth = authenticatePlayer(body.email, body.password);
      const token = createSession(auth.playerId, auth.companyId);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': buildSessionCookie(token)
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
    const ip = req.socket.remoteAddress || '127.0.0.1';
    const rateCheck = checkRateLimit(`auth:register:${ip}`, 30, 60000);
    if (!rateCheck.allowed) {
      sendJson(res, { error: 'Too many registration attempts. Please try again later.', code: 'RATE_LIMITED' }, 429, {
        'Retry-After': String(Math.ceil(rateCheck.resetMs / 1000))
      });
      return true;
    }

    const body = await readJsonBody<{ email: string; password: string; company?: string; name?: string }>(req);
    try {
      // P1-04: ignore device-derived `name`; only an explicit non-empty
      // `company` from the signup form is honored as a business name.
      const auth = registerOrAuthenticatePlayer(body.email, body.password, body.company);
      const token = createSession(auth.playerId, auth.companyId);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': buildSessionCookie(token)
      });
      const redirectUrl = auth.created ? '/zh-cn/create/' : '/zh-cn/landscape/';
      res.end(JSON.stringify({ status: 'redirect', redirectUrl }));
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
        'Set-Cookie': buildSessionCookie(token)
      });
      res.end(JSON.stringify({ status: 'redirect', redirectUrl: auth.created ? '/zh-cn/create/' : '/zh-cn/landscape/' }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // P1-06: settings page renders registered push devices; the frontend does
  // `pushDevices && pushDevices.length > 0`, so GET must return an array, not
  // an object — a plain object crashed the page on `.length of undefined`.
  if (pathname.startsWith('/api/') && pathname.includes('/push-devices/')) {
    if (method === 'GET') {
      sendJson(res, []);
      return true;
    }
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

  // P1-06: language selector on the account-settings page saves via
  // POST /api/v2/players/language/ { code }. Without it the save 404s.
  if (pathname === '/api/v2/players/language/' && method === 'POST') {
    if (!currentPlayerId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<{ code?: string }>(req);
    const code = String(body.code ?? '').trim();
    if (!code) {
      sendJson(res, { error: 'Language code is required' }, 400);
      return true;
    }
    updatePlayerPreferences(currentPlayerId, { language: code });
    sendJson(res, { status: 'ok' });
    return true;
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



  // Personal Data
  const personalDataMatch = pathname.match(/^\/api\/v2\/players\/(\d+|me)\/personal-data\/$/);
  if (personalDataMatch) {
    if (!currentPlayerId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const requestedPlayerId = personalDataMatch[1] === 'me'
      ? currentPlayerId
      : Number(personalDataMatch[1]);
    if (requestedPlayerId !== currentPlayerId) {
      sendJson(res, { error: 'Forbidden' }, 403);
      return true;
    }
    sendJson(res, getPersonalData(currentPlayerId));
    return true;
  }

  // Realm Switch & Realm Create Company
  const realmSwitchMatch = pathname.match(/^\/api\/v1\/realm\/(\d+)\/switch\/?$/);
  const realmCreateMatch = pathname.match(/^\/api\/v1\/realm-create-company\/(\d+)\/?$/);
  if ((realmSwitchMatch || realmCreateMatch) && method === 'POST') {
    if (!currentPlayerId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const targetRealm = Number((realmSwitchMatch || realmCreateMatch)![1]);
    const comps = getPlayerCompanies(currentPlayerId);
    const targetComp = comps.find(c => c.realmId === targetRealm);

    if (targetComp && realmSwitchMatch) {
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
  const companyMatch = pathname.match(/^\/api\/(?:v2|v3)\/companies\/(\d+|me)\/?$/);
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
      const body = await readJsonBody<{
        level?: number; note?: string; name?: string; company?: string;
        showOnlineIndicator?: boolean; moderatorSign?: boolean;
      }>(req);
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
      // P1-06: settings-page display flags must persist and the response must
      // be a full auth-data payload: the frontend feeds it straight into
      // updateAuthUser(data, headers), which expects { authUser, authCompany }.
      if (body.showOnlineIndicator !== undefined || body.moderatorSign !== undefined) {
        updateCompanySettings(currentCompanyId, {
          showOnlineIndicator: body.showOnlineIndicator,
          moderatorSign: body.moderatorSign
        });
        sendJson(res, getAuthData(currentPlayerId, currentCompanyId));
        return true;
      }
      if (body.note !== undefined) {
        db.prepare('UPDATE companies SET note = ? WHERE company_id = ?').run(String(body.note), currentCompanyId);
      }
      // P1-04: the frontend naming flow (/create/) PATCHes { company }.
      // Reject empty names and names conflicting with existing companies;
      // return the error/suggestions shape the frontend expects.
      if (body.company !== undefined) {
        const requested = String(body.company).trim();
        if (requested.length < 4) {
          sendJson(res, { error: 'Try a longer company name, this is too short' }, 400);
          return true;
        }
        if (!/^[a-zA-Z0-9 .]+$/.test(requested)) {
          sendJson(res, { error: 'Please use only letters, numbers, or dots' }, 400);
          return true;
        }
        const clash = db.prepare('SELECT company_id FROM companies WHERE name = ? AND company_id != ?').get(requested, currentCompanyId);
        if (clash) {
          sendJson(res, {
            error: 'The selected name conflicts with existing companies',
            suggestions: buildCompanyNameSuggestions(),
            conflicts: [requested]
          }, 400);
          return true;
        }
        db.prepare('UPDATE companies SET name = ? WHERE company_id = ?').run(requested, currentCompanyId);
      } else if (body.name !== undefined) {
        const requested = String(body.name).trim();
        if (requested.length === 0) {
          sendJson(res, { error: 'Company name cannot be empty' }, 400);
          return true;
        }
        db.prepare('UPDATE companies SET name = ? WHERE company_id = ?').run(requested, currentCompanyId);
      }
      sendJson(res, { status: 'ok', company: getCompanyById(currentCompanyId) });
      return true;
    }

    const comp = getCompanyById(targetCompId);
    if (!comp) {
      sendJson(res, { error: 'Company not found' }, 404);
      return true;
    }
    const isCallerAdmin = currentPlayerId ? Boolean(
      (db.prepare('SELECT is_admin FROM players WHERE player_id = ?').get(currentPlayerId) as { is_admin?: number } | undefined)?.is_admin === 1
    ) : false;

    const buildings = getCompanyBuildings(targetCompId);
    const profileResponse: Record<string, unknown> = {
      companyPublicInfo: {
        id: targetCompId,
        company: comp.name,
        logo: comp.logo || '',
        realmId: comp.realm_id || 0,
        deleted: false,
        moderatorSign: Boolean(comp.moderator_sign),
        level: comp.level,
        levelKind: 'FamilyBusiness',
        note: comp.note || ''
      },
      history: [],
      infrastructure: { recreationBonus: 0, workers: 300, administrationOverhead: 1.0, buildings },
      player: { id: comp.player_id, supporter: false, certificates: 0, contestWins: 0 },
      previousNames: [],
      governmentOrderTierIndex: 0
    };

    if (isCallerAdmin) {
      profileResponse.auditInfo = {
        company: {
          id: comp.company_id,
          name: comp.name,
          money: comp.money,
          simboosts: comp.simboosts,
          level: comp.level,
          rating: comp.rating,
          created: comp.created_at
        }
      };
      profileResponse.moderatorInfo = {
        player: {
          id: comp.player_id,
          ip: '127.0.0.1',
          lastSeen: new Date().toISOString()
        }
      };
    }

    sendJson(res, profileResponse);
    return true;
  }

  return false;
}
