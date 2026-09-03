import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, setPreparsedBody } from './utils.ts';
import { RouteRegistry, globalRouteRegistry, type HttpMethod } from '../http/route-registry.ts';
import {
  extractSessionToken,
  createSession,
  destroySession,
  switchSessionCompany,
  buildSessionCookie
} from '../auth/session.ts';
import { authenticatePlayer, registerOrAuthenticatePlayer } from '../db/seed/index.ts';
import { hashPassword } from '../db/migrations/index.ts';
import { authRepository } from '../repositories/auth-repository.ts';
import { companyRepository } from '../repositories/company-repository.ts';
import { referralsRepository, REFERRAL_JOIN_BONUS } from '../repositories/referrals-repository.ts';
import { checkRateLimit } from '../security/rate-limiter.ts';
import { addCompanyTag, deleteCompanyTag, getCompanyTags } from '../game/tags.ts';
import { unlockTagSlot } from '../game/simboosts.ts';
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
import { getTierForLevel } from '../domain/leveling/level-rules.ts';

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

  // Signout / Logout (Issue #111: redirect to landing page with Location header and expire cookies)
  if (pathname === '/signout/' || pathname === '/zh-cn/signout/' || pathname === '/logout/' || pathname.endsWith('/signout/')) {
    if (sessionToken) destroySession(sessionToken);
    const localeMatch = pathname.match(/^\/([a-zA-Z]{2}(?:-[a-zA-Z]{2,4})?)\//);
    const target = localeMatch ? `/${localeMatch[1]}/` : '/zh-cn/';
    res.writeHead(302, {
      'Location': target,
      'Set-Cookie': [
        'sessionid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly',
        'sim_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0'
      ]
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
          buildSessionCookie(token),
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

    const body = await readJsonBody<{ email: string; password: string; company?: string; name?: string; referralCode?: string }>(req);
    try {
      // P1-04: ignore device-derived `name`; only an explicit non-empty
      // `company` from the signup form is honored as a business name.
      const auth = registerOrAuthenticatePlayer(body.email, body.password, body.company);
      applyReferralOnSignup(auth, body.referralCode);
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
    if (!currentPlayerId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (method === 'GET') {
      const rows = authRepository.listPlayerDevices(currentPlayerId);
      sendJson(res, rows);
      return true;
    }
    // POST: register/update the caller's device
    const body = await readJsonBody<{ deviceUuid?: string; deviceName?: string }>(req);
    const uuid = body.deviceUuid || 'unknown-device';
    const existing = authRepository.findPlayerDevice(currentPlayerId, uuid);
    if (existing) {
      authRepository.updatePlayerDevice(existing.id, body.deviceName || 'device', new Date().toISOString());
    } else {
      authRepository.insertPlayerDevice(currentPlayerId, uuid, body.deviceName || 'device', new Date().toISOString());
    }
    sendJson(res, { status: 'ok' });
    return true;
  }

  // Password Reset
  if (pathname === '/api/v2/auth/email/reset/' && method === 'POST') {
    // Private-server semantics: no outbound mail, so reset takes the email +
    // a new password directly (rate-limited) and updates the hash.
    const ip = req.socket.remoteAddress || '127.0.0.1';
    const rateCheck = checkRateLimit('auth:reset:' + ip, 5, 60000);
    if (!rateCheck.allowed) {
      sendJson(res, { error: 'Too many reset attempts. Please try again later.', code: 'RATE_LIMITED' }, 429);
      return true;
    }
    const body = await readJsonBody<{ email?: string; newPassword?: string }>(req);
    const email = (body.email || '').trim();
    const newPassword = body.newPassword || '';
    if (!email || newPassword.length < 8) {
      sendJson(res, { error: 'Email and a new password (min 8 chars) are required' }, 400);
      return true;
    }
    const player = authRepository.findPlayerIdByEmail(email);
    if (!player) {
      // Same response for unknown email — no account enumeration.
      sendJson(res, { status: 'ok', message: 'Password reset link sent' });
      return true;
    }
    authRepository.updatePlayerPasswordHash(player.player_id, hashPassword(newPassword));
    sendJson(res, { status: 'ok', message: 'Password has been reset' });
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
    const isPlusOne = pathname.endsWith('/plus-one/');
    const stats = companyRepository.getAccountingOverheadStats(requestedCompanyId);
    const count = stats.buildingCount + (isPlusOne ? 1 : 0);
    const ao = 1 + Math.max(0, count - 1) * 0.035;
    const cooSkill = Math.max(0, Math.min(100, stats.cooSkill));
    const effective = ao - (ao - 1) * cooSkill / 100;
    sendJson(res, Math.round(effective * 1000) / 1000);
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
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    // Stable per-company referral code (generated once, stored in company_settings)
    let row = authRepository.findReferralCode(currentCompanyId);
    if (!row || !row.value) {
      const code = `ref-${currentCompanyId}-${Math.random().toString(36).slice(2, 8)}`;
      authRepository.upsertReferralCode(currentCompanyId, code);
      row = { value: code };
    }
    const referred = referralsRepository.findReferredBy(currentCompanyId);
    let rewardsClaimed = 0;
    for (const r of referred) {
      rewardsClaimed += Object.keys(r.rewardsPaid).length;
    }
    sendJson(res, {
      referralCode: row.value,
      referralLink: `/zh-cn/signup/?ref=${row.value}`,
      referrals: referred,
      rewardsClaimed
    });
    return true;
  }

  // Tags (profile trade tags). Exact routes only, so /warehouse/tags/ and
  // other *tags* URLs are never swallowed.
  const companyTagsMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/tags\/?$/);
  if (companyTagsMatch) {
    const targetId = companyTagsMatch[1] === 'me' ? currentCompanyId : Number(companyTagsMatch[1]);
    if (method === 'GET') {
      if (!targetId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      sendJson(res, getCompanyTags(targetId));
      return true;
    }
    if (method === 'POST') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const body = await readJsonBody(req);
      const count = getCompanyTags(currentCompanyId).length;
      const comp = getCompanyById(currentCompanyId);
      if (comp && count >= Math.max(1, comp.max_tags ?? 1)) {
        sendJson(res, { error: 'No free tag slots — unlock more with SimBoosts' }, 400);
        return true;
      }
      sendJson(res, addCompanyTag(currentCompanyId, String(body.kind ?? ''), String(body.buySell ?? 'b')));
      return true;
    }
    if (method === 'PATCH') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      try {
        sendJson(res, await unlockTagSlot(currentCompanyId));
      } catch (err) {
        sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
      return true;
    }
  }
  const tagDeleteMatch = pathname.match(/^\/api\/v2\/companies\/tags\/(\d+)\/?$/);
  if (tagDeleteMatch && method === 'DELETE') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, deleteCompanyTag(Number(tagDeleteMatch[1]), currentCompanyId));
    return true;
  }
  if (
    method === 'GET' && pathname.startsWith('/api/') && pathname.includes('/tags/') &&
    !pathname.includes('/warehouse/')
  ) {
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
  // Realm Sync
  const realmSyncMatch = pathname.match(/^\/api\/v1\/realm\/(\d+)\/sync\/?$/);
  if (realmSyncMatch && method === 'GET') {
    sendJson(res, getAuthData(currentPlayerId, currentCompanyId));
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

    const companies = authRepository.listCompaniesByRealm(realmId);
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
    const level = Number(comp.level) || 5;
    const tier = getTierForLevel(level);
    const maxBuildings = tier.maxBuildings + extraBuildingSlots;
    sendJson(res, {
      companyPublicInfo: {
        id: comp.company_id,
        company: comp.name,
        logo: comp.logo || '',
        realmId: comp.realm_id,
        deleted: false,
        moderatorSign: false,
        level,
        levelKind: tier.kind,
        hqImage: '',
        note: comp.note || '',
        maxBuildings,
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
        authRepository.updateCompanyNote(currentCompanyId, String(body.note));
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
        const clash = authRepository.findCompanyNameClash(requested, currentCompanyId);
        if (clash) {
          sendJson(res, {
            error: 'The selected name conflicts with existing companies',
            suggestions: buildCompanyNameSuggestions(),
            conflicts: [requested]
          }, 400);
          return true;
        }
        authRepository.updateCompanyName(currentCompanyId, requested);
      } else if (body.name !== undefined) {
        const requested = String(body.name).trim();
        if (requested.length === 0) {
          sendJson(res, { error: 'Company name cannot be empty' }, 400);
          return true;
        }
        authRepository.updateCompanyName(currentCompanyId, requested);
      }
      sendJson(res, { status: 'ok', company: getCompanyById(currentCompanyId) });
      return true;
    }

    const comp = getCompanyById(targetCompId);
    if (!comp) {
      sendJson(res, { error: 'Company not found' }, 404);
      return true;
    }
    const isCallerAdmin = currentPlayerId ? companyRepository.isPlayerAdmin(currentPlayerId) : false;

    const buildings = getCompanyBuildings(targetCompId);
    const compLevel = Number(comp.level) || 1;
    const compTier = getTierForLevel(compLevel);
    const compExtraSlots = Number(comp.extra_building_slots) || 0;
    const compMaxBuildings = compTier.maxBuildings + compExtraSlots;
    const profileResponse: Record<string, unknown> = {
      companyPublicInfo: {
        id: targetCompId,
        company: comp.name,
        logo: comp.logo || '',
        realmId: comp.realm_id || 0,
        deleted: false,
        moderatorSign: Boolean(comp.moderator_sign),
        level: compLevel,
        levelKind: compTier.kind,
        note: comp.note || '',
        maxBuildings: compMaxBuildings,
        extraBuildingSlots: compExtraSlots
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

/**
 * Referral signup hook (Issue #109 build-out): bind the new company to the
 * referrer's code and grant the one-time $2,000 join bonus
 * (data/referral.json refereeRewards). Failures are logged, never fatal —
 * a broken referral must not block signup.
 */
function applyReferralOnSignup(
  auth: { playerId: number; companyId: number; created: boolean },
  referralCode?: string
): void {
  if (!auth.created || !referralCode || referralCode.trim() === '') return;
  try {
    const code = referralCode.trim();
    const owner = authRepository.findCompanyIdByReferralCode(code);
    if (!owner) return;
    const referrerCompanyId = Number(owner.company_id);
    if (referrerCompanyId === auth.companyId) return;
    const bound = referralsRepository.bindReferred(referrerCompanyId, auth.companyId, code);
    if (bound && !referralsRepository.hasClaimedJoinBonus(auth.companyId)) {
      companyRepository.creditMoney(auth.companyId, REFERRAL_JOIN_BONUS);
      referralsRepository.markJoinBonusClaimed(auth.companyId);
    }
  } catch (err) {
    console.error('[referral] signup bind failed:', err);
  }
}

export function registerAuthRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  const register = (method: HttpMethod, pattern: string): void => {
    registry.register({
      method,
      pattern,
      owner: 'auth',
      handler: async (req, res, ctx, _params, body) => {
        if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
          setPreparsedBody(req, body);
        }
        const pathname = new URL(req.url || '/', 'http://localhost').pathname;
        await handleAuthRoutes(
          req,
          res,
          pathname,
          method,
          extractSessionToken(req),
          ctx?.playerId ?? null,
          ctx?.companyId ?? null
        );
      }
    });
  };

  register('GET', '/signout/');
  register('GET', '/zh-cn/signout/');
  register('GET', '/logout/');
  register('GET', '/:locale/signout/');
  register('GET', '/tutorial/');
  register('POST', '/tutorial/');
  register('GET', '/:locale/tutorial/');
  register('POST', '/:locale/tutorial/');
  register('GET', '/:locale/tutorial/:step/');
  register('POST', '/:locale/tutorial/:step/');
  register('POST', '/api/v2/auth/email/auth/');
  register('POST', '/api/v2/auth/email/connect/');
  register('POST', '/api/v2/auth/email/reset/');
  register('POST', '/api/v2/auth/device/auth/');
  register('POST', '/api/v2/auth/device/connect/');
  register('GET', '/api/v2/players/push-devices/');
  register('POST', '/api/v2/players/push-devices/');
  register('GET', '/api/v3/players/push-devices/');
  register('POST', '/api/v3/players/push-devices/');
  register('GET', '/api/v2/companies/:companyId/push-devices/');
  register('POST', '/api/v2/companies/:companyId/push-devices/');
  register('GET', '/api/v3/companies/auth-data/');
  register('GET', '/api/v2/players/:playerId/companies/');
  register('GET', '/api/v2/players/:playerId/personal-data/');
  register('POST', '/api/v2/player-preferences/');
  register('POST', '/api/v2/players/:playerId/preferences/');
  register('POST', '/api/v2/players/language/');
  register('GET', '/api/v2/companies/:companyId/referral/');
  register('GET', '/api/v2/referral/');
  register('GET', '/api/v2/companies/:companyId/tags/');
  register('POST', '/api/v2/companies/:companyId/tags/');
  register('PATCH', '/api/v2/companies/:companyId/tags/');
  register('DELETE', '/api/v2/companies/tags/:tagId/');
  register('GET', '/api/v2/:scope/:realmId/tags/');
  register('POST', '/api/v1/realm/:realmId/switch/');
  register('POST', '/api/v1/realm-create-company/:realmId/');
  register('GET', '/api/v1/realm/:realmId/sync/');
  register('GET', '/api/v3/companies-by-company/:realmId/:name/');
  register('GET', '/api/v2/companies/:companyId/');
  register('PATCH', '/api/v2/companies/:companyId/');
  register('GET', '/api/v3/companies/:companyId/');
  register('PATCH', '/api/v3/companies/:companyId/');
  register('GET', '/api/v2/companies/:companyId/administration-overhead/');
  register('GET', '/api/v2/companies/:companyId/administration-overhead/plus-one/');
}

registerAuthRoutes(globalRouteRegistry);
