import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../utils.ts';
import { authRepository } from '../../repositories/auth-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { referralsRepository } from '../../repositories/referrals-repository.ts';
import { addCompanyTag, deleteCompanyTag, getCompanyTags } from '../../game/tags.ts';
import { unlockTagSlot } from '../../game/simboosts.ts';
import {
  getAuthData,
  getPlayerCompanies,
  getCompanyById,
  updatePlayerPreferences,
  getPersonalData
} from '../../game/company.ts';

export async function handlePlayerSubroutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentPlayerId: number | null,
  currentCompanyId: number | null
): Promise<boolean> {
  // Auth Data
  if (pathname === '/api/v3/companies/auth-data/') {
    sendJson(res, getAuthData(currentPlayerId, currentCompanyId));
    return true;
  }

  // Administration overhead
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

  // Language selector
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

  // Tags
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

  return false;
}
