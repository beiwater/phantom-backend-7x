import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../utils.ts';
import { sendDomainError } from '../../compatibility/simcompanies/response-helpers.ts';
import { switchSessionCompany } from '../../auth/session.ts';
import { authRepository } from '../../repositories/auth-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import {
  getAuthData,
  getPlayerCompanies,
  getCompanyById,
  createCompanyForPlayer,
  resetCompany,
  updateCompanySettings,
  getCompanyHqImage
} from '../../game/company.ts';
import { getCompanyBuildings } from '../../game/buildings.ts';
import { getTierForLevel } from '../../domain/leveling/level-rules.ts';
import {
  createRealmZeroCompanyUseCase,
  migrateOwnedCompanyToRealmZeroUseCase
} from '../../application/account/company-account-use-cases.ts';
import {
  parseCompanyId,
  rejectCrossOriginRequest,
  buildCompanyNameSuggestions
} from './auth-helpers.ts';

export async function handleCompanyLifecycleSubroutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  sessionToken: string | null,
  currentPlayerId: number | null,
  currentCompanyId: number | null
): Promise<boolean> {
  // Company create
  if (/^\/api\/v2\/companies\/create\/?$/.test(pathname) && method === 'POST') {
    if (rejectCrossOriginRequest(req, res)) return true;
    if (!currentPlayerId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<{ name?: unknown; company?: unknown }>(req);
    try {
      const company = createRealmZeroCompanyUseCase(
        currentPlayerId,
        body.name ?? body.company
      );
      sendJson(res, {
        status: 'ok',
        companyId: company.companyId,
        playerId: company.playerId,
        realmId: company.realmId,
        company: company.name
      });
    } catch (err: unknown) {
      sendDomainError(res, err);
    }
    return true;
  }

  // Realm Zero migration
  const realmZeroMigrationMatch = pathname.match(
    /^\/api\/v2\/companies\/migrate\/([^/]+)\/realm0\/?$/
  );
  if (realmZeroMigrationMatch && method === 'POST') {
    const targetCompanyId = parseCompanyId(realmZeroMigrationMatch[1]);
    if (targetCompanyId === null) {
      sendJson(res, { error: 'Invalid company ID' }, 400);
      return true;
    }
    if (rejectCrossOriginRequest(req, res)) return true;
    if (!currentPlayerId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<{ confirm?: unknown }>(req);
    try {
      const result = await migrateOwnedCompanyToRealmZeroUseCase(
        currentPlayerId,
        targetCompanyId,
        body.confirm === true
      );
      sendJson(res, {
        status: 'ok',
        companyId: result.company.companyId,
        playerId: result.company.playerId,
        fromRealmId: result.fromRealmId,
        realmId: result.toRealmId,
        company: result.company.name,
        updatedRows: result.updatedRows
      });
    } catch (err: unknown) {
      sendDomainError(res, err);
    }
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
      sendJson(res, {
        status: 'redirect',
        redirectUrl: '/zh-cn/landscape/',
        companyId: targetComp.id,
        realmId: targetRealm
      });
    } else {
      const defaultName = targetRealm === 1 ? `Sub-Co-R${targetRealm}` : `Co-Realm${targetRealm}`;
      const newComp = createCompanyForPlayer(currentPlayerId, defaultName, targetRealm);
      if (newComp && sessionToken) switchSessionCompany(sessionToken, newComp.company_id);
      sendJson(res, {
        status: 'redirect',
        redirectUrl: '/zh-cn/create/',
        companyId: newComp?.company_id,
        realmId: targetRealm
      });
    }
    return true;
  }

  // Company Switch: /api/v2/companies/switch/:companyId/
  const companySwitchMatch = pathname.match(/^\/api\/v2\/companies\/switch\/([^/]+)\/?$/);
  if (companySwitchMatch && method === 'POST') {
    const targetCompId = parseCompanyId(companySwitchMatch[1]);
    if (targetCompId === null) {
      sendJson(res, { error: 'Invalid company ID' }, 400);
      return true;
    }
    if (rejectCrossOriginRequest(req, res)) return true;
    if (!currentPlayerId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const comps = getPlayerCompanies(currentPlayerId);
    const targetComp = comps.find(c => c.id === targetCompId);
    if (!targetComp) {
      sendJson(res, { error: 'Company not found or does not belong to player' }, 404);
      return true;
    }
    if (sessionToken) switchSessionCompany(sessionToken, targetComp.id);
    sendJson(res, {
      status: 'redirect',
      redirectUrl: '/zh-cn/landscape/',
      companyId: targetComp.id,
      realmId: targetComp.realmId
    });
    return true;
  }

  // Realm Sync
  const realmSyncMatch = pathname.match(/^\/api\/v1\/realm\/(\d+)\/sync\/?$/);
  if (realmSyncMatch && method === 'GET') {
    sendJson(res, getAuthData(currentPlayerId, currentCompanyId));
    return true;
  }

  // Exact Wcr company lookup
  const companyLookupMatch = pathname.match(/^\/api\/v2\/company-lookup\/([^/]+)\/([^/]+)\/([^/]+)\/?$/);
  if (companyLookupMatch && method === 'GET') {
    const companyId = Number(companyLookupMatch[1]);
    const realmId = Number(companyLookupMatch[2]);
    if (!Number.isSafeInteger(companyId) || companyId <= 0 || !Number.isSafeInteger(realmId) || realmId < 0) {
      sendJson(res, { error: 'Invalid company lookup parameters' }, 400);
      return true;
    }

    let slug: string;
    try {
      slug = decodeURIComponent(companyLookupMatch[3]);
    } catch {
      sendJson(res, { error: 'Invalid company name' }, 400);
      return true;
    }

    const company = authRepository.listCompaniesByRealm(realmId).find(candidate =>
      candidate.company_id === companyId &&
      candidate.name.replace(/[\/\\\s]/g, '-') === slug
    );
    if (!company) {
      sendJson(res, { error: 'Company not found' }, 404);
      return true;
    }

    sendJson(res, {
      company: company.name,
      realm_id: company.realm_id
    });
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
        hqImage: getCompanyHqImage(comp.company_id),
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
