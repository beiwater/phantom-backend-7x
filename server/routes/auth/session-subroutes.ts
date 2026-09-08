import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../utils.ts';
import {
  createSession,
  destroySession,
  buildSessionCookie
} from '../../auth/session.ts';
import { authenticatePlayer, registerOrAuthenticatePlayer } from '../../db/seed/index.ts';
import { hashPassword } from '../../db/migrations/index.ts';
import { authRepository } from '../../repositories/auth-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { referralsRepository, REFERRAL_JOIN_BONUS } from '../../repositories/referrals-repository.ts';
import { checkRateLimit } from '../../security/rate-limiter.ts';
import { getClientIp } from '../../security/client-ip.ts';

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

export async function handleSessionSubroutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  sessionToken: string | null,
  currentPlayerId: number | null
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
    const ip = getClientIp(req);
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
    const ip = getClientIp(req);
    const rateCheck = checkRateLimit(`auth:register:${ip}`, 30, 60000);
    if (!rateCheck.allowed) {
      sendJson(res, { error: 'Too many registration attempts. Please try again later.', code: 'RATE_LIMITED' }, 429, {
        'Retry-After': String(Math.ceil(rateCheck.resetMs / 1000))
      });
      return true;
    }

    const body = await readJsonBody<{ email: string; password: string; company?: string; name?: string; referralCode?: string }>(req);
    try {
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

  // Push Devices
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
    const ip = getClientIp(req);
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
      sendJson(res, { status: 'ok', message: 'Password reset link sent' });
      return true;
    }
    authRepository.updatePlayerPasswordHash(player.player_id, hashPassword(newPassword));
    sendJson(res, { status: 'ok', message: 'Password has been reset' });
    return true;
  }

  return false;
}
