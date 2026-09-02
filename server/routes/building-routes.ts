import type { IncomingMessage, ServerResponse } from 'node:http';
import { RouteRegistry, globalRouteRegistry } from '../http/route-registry.ts';
import { readJsonBody, sendJson } from './utils.ts';
import {
  startProductionUseCase,
  type StartProductionInput
} from '../application/production/start-production.ts';
import { startRetailUseCase } from '../application/production/start-retail.ts';
import { cancelProductionUseCase } from '../application/production/cancel-production.ts';
import { collectProductionUseCase } from '../application/production/collect-production.ts';
import { collectRetailOrderUseCase } from '../application/retail/retail-use-cases.ts';
import { retailRepository } from '../repositories/retail-repository.ts';
import { getProductionHistoryUseCase } from '../application/production/get-production-history.ts';
import { constructBuildingUseCase } from '../application/buildings/construct-building.ts';
import { upgradeBuildingUseCase } from '../application/buildings/upgrade-building.ts';
import { downgradeBuildingUseCase } from '../application/buildings/downgrade-building.ts';
import { demolishBuildingUseCase } from '../application/buildings/demolish-building.ts';
import { startRecreationUpkeepUseCase } from '../application/buildings/start-recreation-upkeep.ts';
import { placeBuildingUseCase, liftBuildingUseCase } from '../application/buildings/place-building.ts';
import { renameBuildingUseCase } from '../application/buildings/rename-building.ts';
import { getCompanyBuildingsUseCase } from '../application/buildings/get-buildings.ts';
import { getBuildingDetailsUseCase } from '../application/buildings/get-building-details.ts';
import { installRobotsUseCase } from '../application/buildings/install-robots.ts';
import { uninstallRobotsUseCase } from '../application/buildings/uninstall-robots.ts';
import { buildingRepository } from '../repositories/building-repository.ts';
import {
  toSimCompaniesStartProductionDTO,
  toSimCompaniesCancelProductionDTO,
  toSimCompaniesCollectProductionDTO,
  toSimCompaniesQueueDTO,
  toSimCompaniesHistoryDTO
} from '../compatibility/simcompanies/production-dto.ts';
import { ValidationError, NotFoundError, ForbiddenError, UnauthorizedError } from '../errors/domain-error.ts';
import type { GameContext } from '../context/game-context.ts';
import {
  toSimCompaniesBuildingDTO,
  toSimCompaniesBuildingsListDTO
} from '../compatibility/simcompanies/building-dto.ts';
import { normalizePosition } from '../domain/buildings/building-rules.ts';
import { addFollower, listFollowers, removeFollower } from '../application/buildings/followers.ts';
import {
  getBuildingAbundance,
  prospectBuildingAbundance
} from '../game/buildings.ts';

export function registerBuildingRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  // 1. v1 Busy / Start Production endpoints
  //
  // P1-09: the original client starts a recreation building's 7-day upkeep
  // with an EMPTY body on this endpoint (bundle: startRecreation →
  // oe().post(api_v1_busy(buildingId), {})). Dispatch to the recreation
  // upkeep use case whenever kind/amount are absent.
  const startProductionHandler = async (
    _req: IncomingMessage,
    res: ServerResponse,
    ctx: any,
    params: Record<string, string>,
    body: any
  ) => {
    const buildingId = Number(params.id);
    const isRecreationStart = body === null || typeof body !== 'object' ||
      (!('kind' in body) && !('amount' in body));
    if (isRecreationStart) {
      const upkeep = await startRecreationUpkeepUseCase(ctx, buildingId);
      const buildingDTO = toSimCompaniesBuildingDTO(upkeep.building);
      sendJson(res, {
        building: buildingDTO,
        simboostsDelta: upkeep.simboostsDelta,
        simBoosts: upkeep.simboostsRemaining,
        spent: upkeep.spent
      });
      return;
    }
    // P0-06: the retail sell widget (startRetail) POSTs on a SALES building. Route it to
    // the retail use case instead of production validation (which rejects any
    // resource not produced by the building kind).
    const existingBld = await buildingRepository.findById(buildingId);
    const isRetailSell = body.price !== undefined ||
      body.estimatedSecondsToFinish !== undefined ||
      existingBld?.category === 'sales';
    if (isRetailSell) {
      const retail = await startRetailUseCase(ctx, {
        buildingId,
        kind: Number(body.kind),
        amount: Number(body.amount),
        price: Number(body.price),
        forceQuality: body.forceQuality !== undefined ? Number(body.forceQuality) : null
      });
      const buildingDTO = toSimCompaniesBuildingDTO(retail.building);
      sendJson(res, {
        message: 'Retail sale started successfully',
        money: retail.revenue,
        building: buildingDTO,
        resourceTransactions: retail.resourceTransactions.map(tx => ({
          kind: tx.kind,
          db_letter: tx.kind,
          dbLetter: tx.kind,
          quality: tx.quality,
          amount: tx.amount,
          delta: -tx.amount
        })),
        followerErrors: [],
        simboostsDelta: 0
      });
      return;
    }
    const result = await startProductionUseCase(ctx, {
      buildingId,
      kind: Number(body.kind),
      amount: Number(body.amount),
      quality: body.limitQuality !== undefined ? body.limitQuality : null
    });
    sendJson(res, toSimCompaniesStartProductionDTO(result));
  };
  registry.register({
    method: 'POST',
    pattern: '/api/v1/buildings/:id/busy/',
    auth: 'company',
    handler: startProductionHandler
  });

  registry.register({
    method: 'POST',
    pattern: '/api/v1/busy/:id/',
    auth: 'company',
    handler: startProductionHandler
  });

  // 2. v1 Cancel Production endpoints
  const cancelProductionHandler = async (
    _req: IncomingMessage,
    res: ServerResponse,
    ctx: any,
    params: Record<string, string>
  ) => {
    const buildingId = Number(params.id);
    const result = await cancelProductionUseCase(ctx, { buildingId });
    sendJson(res, toSimCompaniesCancelProductionDTO(result));
  };

  registry.register({
    method: 'DELETE',
    pattern: '/api/v1/buildings/:id/busy/',
    auth: 'company',
    handler: cancelProductionHandler
  });

  registry.register({
    method: 'DELETE',
    pattern: '/api/v1/busy/:id/',
    auth: 'company',
    handler: cancelProductionHandler
  });

  // 3. Building History
  registry.register({
    method: 'GET',
    pattern: '/api/v2/companies/buildings/:id/history/',
    auth: 'none',
    handler: async (_req, res, ctx, params) => {
      const buildingId = Number(params.id);
      const items = await getProductionHistoryUseCase(ctx!, buildingId);
      sendJson(res, toSimCompaniesHistoryDTO(items));
    }
  });

  // 4. Followers (logistics links between the company's own buildings)
  registry.register({
    method: 'GET',
    pattern: '/api/v3/companies/buildings/:id/followers/',
    auth: 'none',
    handler: async (_req, res, _ctx, params) => {
      sendJson(res, { linking: listFollowers(Number(params.id)) });
    }
  });

  registry.register({
    method: 'POST',
    pattern: '/api/v3/companies/buildings/:id/followers/',
    auth: 'company',
    handler: async (req, res, ctx, params, body) => {
      if (!ctx?.companyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return;
      }
      const followerId = Number((body as Record<string, unknown>)?.follower);
      try {
        sendJson(res, { linking: addFollower(Number(params.id), followerId, ctx.companyId) });
      } catch (err) {
        sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
    }
  });

  registry.register({
    method: 'DELETE',
    pattern: '/api/v3/companies/buildings/:id/followers/',
    auth: 'company',
    handler: async (req, res, _ctx, params) => {
      const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>);
      const followerId = Number((body as Record<string, unknown>).follower);
      if (!Number.isFinite(followerId)) {
        sendJson(res, { error: 'follower id required' }, 400);
        return;
      }
      sendJson(res, { linking: removeFollower(Number(params.id), followerId) });
    }
  });

  // 5. Buildings List & Construct
  const getBuildingsListHandler = async (_req: IncomingMessage, res: ServerResponse, ctx: any, params: Record<string, string>) => {
    const targetCompanyId = params.companyId ? Number(params.companyId) : ctx?.companyId;
    if (!targetCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return;
    }
    const targetCtx = ctx && ctx.companyId === targetCompanyId ? ctx : { ...ctx, companyId: targetCompanyId };
    const buildings = await getCompanyBuildingsUseCase(targetCtx);
    sendJson(res, toSimCompaniesBuildingsListDTO(buildings));
  };

  registry.register({
    method: 'GET',
    pattern: '/api/v2/companies/me/buildings/',
    auth: 'company',
    handler: getBuildingsListHandler
  });

  registry.register({
    method: 'GET',
    pattern: '/api/v2/companies/:companyId/buildings/',
    auth: 'none',
    handler: getBuildingsListHandler
  });

  const constructBuildingHandler = async (_req: IncomingMessage, res: ServerResponse, ctx: any, _params: Record<string, string>, body: any) => {
    if (body.position === undefined || body.position === null || body.position === '') {
      throw new ValidationError('Building position is required');
    }

    // P1-10 (Reposition step 2): place a LIFTED existing building only if the building exists,
    // belongs to the company, and is currently lifted. Issue #95: buildings won
    // in a building auction arrive in the 35-slot reposition queue as 'l' or
    // 'l<n>' — every 'l'-prefixed position is a lift marker that the placement
    // modal lists, so match the prefix, not the exact string.
    if (typeof body.id === 'number' && Number.isInteger(body.id)) {
      const existingLifted = buildingRepository.findById(body.id);
      if (existingLifted && existingLifted.companyId === ctx.companyId && existingLifted.position.startsWith('l')) {
        const placed = await placeBuildingUseCase(ctx!, {
          buildingId: body.id,
          position: String(body.position)
        });
        const placedDTO = toSimCompaniesBuildingDTO(placed);
        sendJson(res, placedDTO);
        return;
      }
    }
    const kind = body.kind || (typeof body.id === 'object' && body.id ? body.id.id : body.id) || 'P';
    const result = await constructBuildingUseCase(ctx!, {
      kind: String(kind),
      position: String(body.position),
      replaceExisting: false
    });
    const buildingDTO = toSimCompaniesBuildingDTO(result.building);
    sendJson(res, {
      ...buildingDTO,
      building: buildingDTO,
      cost: result.cost,
      resourcesConsumed: result.resourcesConsumed.map(r => ({
        db_letter: r.kind,
        quality: r.quality,
        amount: r.amount
      }))
    });
  };

  registry.register({
    method: 'POST',
    pattern: '/api/v2/companies/me/buildings/',
    auth: 'company',
    handler: constructBuildingHandler
  });

  registry.register({
    method: 'POST',
    pattern: '/api/v2/companies/:companyId/buildings/',
    auth: 'company',
    handler: constructBuildingHandler
  });

  // 6. Single Building Details, Upgrade, Rename, Demolish
  const getBuildingHandler = async (
    _req: IncomingMessage,
    res: ServerResponse,
    ctx: any,
    params: Record<string, string>
  ) => {
    const buildingId = Number(params.id);
    const building = await getBuildingDetailsUseCase(ctx, buildingId);
    sendJson(res, toSimCompaniesBuildingDTO(building));
  };

  registry.register({
    method: 'GET',
    pattern: '/api/v2/companies/buildings/:id/',
    auth: 'none',
    handler: getBuildingHandler
  });

  registry.register({
    method: 'GET',
    pattern: '/api/v2/companies/me/buildings/:id/',
    auth: 'none',
    handler: getBuildingHandler
  });

  registry.register({
    method: 'GET',
    pattern: '/api/v2/companies/:companyId/buildings/:id/',
    auth: 'none',
    handler: getBuildingHandler
  });

  const patchBuildingHandler = async (
    _req: IncomingMessage,
    res: ServerResponse,
    ctx: any,
    params: Record<string, string>,
    body: any
  ) => {
    const buildingId = Number(params.id);
    const building = await getBuildingDetailsUseCase(ctx, buildingId);

    if (body?.rebuild) {
      const result = await constructBuildingUseCase(ctx, {
        kind: building.kind,
        position: building.position,
        replaceExisting: true
      });
      const buildingDTO = toSimCompaniesBuildingDTO(result.building);
      sendJson(res, {
        ...buildingDTO,
        building: buildingDTO,
        cost: result.cost,
        resourcesConsumed: result.resourcesConsumed.map(r => ({
          db_letter: r.kind,
          dbLetter: r.kind,
          quality: r.quality,
          amount: r.amount
        }))
      });
      return;
    }

    if (body?.name !== undefined) {
      const updated = await renameBuildingUseCase(ctx, buildingId, String(body.name));
      sendJson(res, toSimCompaniesBuildingDTO(updated));
      return;
    }

    if (body?.position !== undefined) {
      // P1-10 (Reposition step 1): the client lifts the building with
      // { position: 'l' }. Lifting releases the original slot so the building
      // can be placed elsewhere; the lift itself must NOT collide with the
      // occupancy check.
      const rawPosition = String(body.position);
      const isLift = normalizePosition(rawPosition) === 'l';
      if (isLift) {
        const lifted = await liftBuildingUseCase(ctx, buildingId);
        sendJson(res, toSimCompaniesBuildingDTO(lifted));
        return;
      }
      const updated = await placeBuildingUseCase(ctx, {
        buildingId,
        position: rawPosition
      });
      sendJson(res, toSimCompaniesBuildingDTO(updated));
      return;
    }

    // Handle size change (upgrade or downgrade)
    const sizeParam = body?.size !== undefined ? body.size : body?.reqSize;
    if (sizeParam !== undefined) {
      const reqSize = Number(sizeParam);
      if (reqSize < 0) {
        const reduction = Math.abs(reqSize);
        const result = await downgradeBuildingUseCase(ctx, { buildingId, sizeReduction: reduction });
        sendJson(res, {
          building: toSimCompaniesBuildingDTO(result.building),
          money: result.newMoney,
          resources: result.refundMaterials.map(m => ({
            db_letter: m.kind,
            dbLetter: m.kind,
            quality: 0,
            amount: m.amount
          }))
        });
        return;
      }

      // If reqSize === 1, it is a relative upgrade by 1 level
      if (reqSize === 1) {
        const result = await upgradeBuildingUseCase(ctx, { buildingId, sizeDelta: 1 });
        sendJson(res, {
          building: toSimCompaniesBuildingDTO(result.building),
          cost: result.cost,
          resourcesConsumed: result.resourcesConsumed.map(r => ({
            db_letter: r.kind,
            dbLetter: r.kind,
            quality: r.quality,
            amount: r.amount
          }))
        });
        return;
      }

      // Absolute target size comparison
      if (reqSize > building.size) {
        const sizeDelta = reqSize - building.size;
        const result = await upgradeBuildingUseCase(ctx, { buildingId, sizeDelta });
        sendJson(res, {
          building: toSimCompaniesBuildingDTO(result.building),
          cost: result.cost,
          resourcesConsumed: result.resourcesConsumed.map(r => ({
            db_letter: r.kind,
            dbLetter: r.kind,
            quality: r.quality,
            amount: r.amount
          }))
        });
        return;
      } else if (reqSize < building.size) {
        const reduction = building.size - reqSize;
        const result = await downgradeBuildingUseCase(ctx, { buildingId, sizeReduction: reduction });
        sendJson(res, {
          building: toSimCompaniesBuildingDTO(result.building),
          money: result.newMoney,
          resources: result.refundMaterials.map(m => ({
            db_letter: m.kind,
            dbLetter: m.kind,
            quality: 0,
            amount: m.amount
          }))
        });
        return;
      }
    }

    // Pass-through for other metadata patches (robots, pinnedResource, recreationAutoUpkeep)
    sendJson(res, toSimCompaniesBuildingDTO(building));
  };

  registry.register({
    method: 'PATCH',
    pattern: '/api/v2/companies/buildings/:id/',
    auth: 'company',
    handler: patchBuildingHandler
  });

  registry.register({
    method: 'PATCH',
    pattern: '/api/v2/companies/me/buildings/:id/',
    auth: 'company',
    handler: patchBuildingHandler
  });

  registry.register({
    method: 'PATCH',
    pattern: '/api/v2/companies/:companyId/buildings/:id/',
    auth: 'company',
    handler: patchBuildingHandler
  });
  const deleteBuildingHandler = async (
    _req: IncomingMessage,
    res: ServerResponse,
    ctx: any,
    params: Record<string, string>
  ) => {
    const buildingId = Number(params.id);
    const result = await demolishBuildingUseCase(ctx, buildingId);
    const dto = toSimCompaniesBuildingDTO(result.demolishedBuilding);
    sendJson(res, {
      ...dto,
      resources: result.refundMaterials.map(m => ({
        db_letter: m.kind,
        dbLetter: m.kind,
        quality: 0,
        amount: m.amount
      }))
    });
  };

  registry.register({
    method: 'DELETE',
    pattern: '/api/v2/companies/buildings/:id/',
    auth: 'company',
    handler: deleteBuildingHandler
  });

  registry.register({
    method: 'DELETE',
    pattern: '/api/v2/companies/me/buildings/:id/',
    auth: 'company',
    handler: deleteBuildingHandler
  });

  registry.register({
    method: 'DELETE',
    pattern: '/api/v2/companies/:companyId/buildings/:id/',
    auth: 'company',
    handler: deleteBuildingHandler
  });

  // 7. Building Abundance (Issue #93)
  registry.register({
    method: 'GET',
    pattern: '/api/v2/companies/buildings/:id/abundance/',
    auth: 'none',
    handler: async (_req, res, _ctx, params) => {
      const abundance = getBuildingAbundance(Number(params.id));
      if (!abundance) {
        throw new NotFoundError(`Building ${params.id} not found`);
      }
      sendJson(res, abundance);
    }
  });

  // Issue #93: re-prospect a deposit — rolls a fresh abundance (and a
  // matching new original abundance) for a natural resource extractor.
  registry.register({
    method: 'POST',
    pattern: '/api/v2/companies/buildings/:id/prospect/',
    auth: 'company',
    handler: async (_req, res, ctx, params) => {
      const buildingId = Number(params.id);
      const building = buildingRepository.findById(buildingId);
      if (!building) {
        throw new NotFoundError(`Building ${buildingId} not found`);
      }
      if (building.companyId !== ctx.companyId) {
        throw new ForbiddenError('You do not own this building');
      }
      sendJson(res, prospectBuildingAbundance(buildingId));
    }
  });


  // 8. Building Robots (Issue #96: robotics & specialization)
  const readNumberField = (source: unknown, key: string): number | undefined => {
    if (source === null || typeof source !== 'object' || !(key in source)) return undefined;
    // `key in source` guard above establishes the property exists on the object.
    const record = source as Record<string, unknown>;
    const value = Number(record[key]);
    return Number.isFinite(value) ? value : undefined;
  };

  const installRobotsHandler = async (
    _req: IncomingMessage,
    res: ServerResponse,
    ctx: GameContext | null,
    params: Record<string, string>,
    body: unknown
  ) => {
    if (!ctx) throw new UnauthorizedError();
    const buildingId = Number(params.id);
    const kind = readNumberField(body, 'kind') ?? readNumberField(body, 'lockedProduct');
    const result = await installRobotsUseCase(ctx, { buildingId, kind: Number(kind) });
    const buildingDTO = toSimCompaniesBuildingDTO(result.building);
    sendJson(res, {
      // Legacy stub contract keys retained for backward compatibility.
      robotsInstalled: true,
      wageDiscount: result.robotics.wageDiscount,
      wageMultiplier: result.robotics.wageMultiplier,
      installedRobots: result.robotics.installedRobots,
      requiredRobots: result.robotics.requiredRobots,
      requiredQuality: result.robotics.requiredQuality,
      lockedProduct: result.robotics.lockedProduct,
      resourcesConsumed: result.resourcesConsumed.map(tx => ({
        kind: tx.kind,
        db_letter: tx.kind,
        dbLetter: tx.kind,
        quality: tx.quality,
        amount: tx.amount
      })),
      robotics: result.robotics,
      building: buildingDTO
    });
  };

  const uninstallRobotsHandler = async (
    _req: IncomingMessage,
    res: ServerResponse,
    ctx: GameContext | null,
    params: Record<string, string>
  ) => {
    if (!ctx) throw new UnauthorizedError();
    const buildingId = Number(params.id);
    const result = await uninstallRobotsUseCase(ctx, buildingId);
    const buildingDTO = toSimCompaniesBuildingDTO(result.building);
    sendJson(res, {
      robotsInstalled: false,
      wageDiscount: 0,
      wageMultiplier: 1,
      returnedRobots: result.returnedRobots,
      returnedQuality: result.returnedQuality,
      building: buildingDTO
    });
  };

  registry.register({
    method: 'POST',
    pattern: '/api/v2/companies/buildings/:id/install-robots/',
    auth: 'company',
    handler: installRobotsHandler
  });

  registry.register({
    method: 'POST',
    pattern: '/api/v2/companies/buildings/:id/uninstall-robots/',
    auth: 'company',
    handler: uninstallRobotsHandler
  });

  // Legacy robots endpoints, now backed by the real robotics use cases.
  registry.register({
    method: 'POST',
    pattern: '/api/v2/companies/buildings/:id/robots/',
    auth: 'company',
    handler: installRobotsHandler
  });

  registry.register({
    method: 'DELETE',
    pattern: '/api/v2/companies/buildings/:id/robots/',
    auth: 'company',
    handler: uninstallRobotsHandler
  });

  // 9. Building Queue endpoints
  registry.register({
    method: 'GET',
    pattern: '/api/v2/companies/buildings/:id/queue/',
    auth: 'company',
    handler: async (_req, res, ctx, params) => {
      const buildingId = Number(params.id);
      const queue = await getProductionQueueUseCase(ctx!, buildingId);
      sendJson(res, toSimCompaniesQueueDTO(queue));
    }
  });

  registry.register({
    method: 'POST',
    pattern: '/api/v2/companies/buildings/:id/queue/',
    auth: 'company',
    handler: async (_req, res, ctx, params, body: any) => {
      const buildingId = Number(params.id);
      const result = await startProductionUseCase(ctx!, {
        buildingId,
        kind: Number(body.kind),
        amount: Number(body.amount)
      });
      sendJson(res, toSimCompaniesQueueDTO([result.queueItem])[0]);
    }
  });

  registry.register({
    method: 'DELETE',
    pattern: '/api/v2/companies/buildings/:id/queue/:queueId/',
    auth: 'company',
    handler: async (_req, res, ctx, params) => {
      const buildingId = Number(params.id);
      const queueId = Number(params.queueId);
      const result = await cancelProductionUseCase(ctx!, { buildingId, queueId });
      sendJson(res, toSimCompaniesCancelProductionDTO(result));
    }
  });

  // 10. Take finished order — production output OR completed retail sale
  // (Issue #142: the client posts {cash} to /api/v2/order/take/:buildingId/
  // to pick up finished sales revenue; previously only production was
  // handled, so the collect click on a selling store errored.)
  registry.register({
    method: 'POST',
    pattern: '/api/v2/order/take/:id/',
    auth: 'company',
    handler: async (_req, res, ctx, params) => {
      const requestedId = Number(params.id);

      // Retail fallback: a finished sales order on this building collects revenue
      const retailOrders = retailRepository.findByCompanyAndBuilding(ctx!.companyId, requestedId);
      const finishedRetail = retailOrders.find(o => !o.finishedAt || new Date(o.finishedAt).getTime() <= Date.now());
      if (finishedRetail) {
        const retail = await collectRetailOrderUseCase(ctx!, finishedRetail.id);
        sendJson(res, {
          moneyUpdate: retail.moneyBalance,
          collectedItem: null,
          building: buildingRepository.findById(requestedId),
          levelInfo: null,
          levelUp: false
        });
        return;
      }

      const result = await collectProductionUseCase(ctx!, { buildingOrQueueId: requestedId });
      sendJson(res, toSimCompaniesCollectProductionDTO(result));
    }
  });
}

// Auto-register building routes to the global registry
registerBuildingRoutes(globalRouteRegistry);

/**
 * Backward compatibility handler during strangler migration.
 * Delegates directly to the global declarative route registry.
 */
export async function handleBuildingRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // PA Quests fallback
  if (pathname.startsWith('/api/') && (pathname.includes('/pa/quests/') || pathname.includes('/objectives/'))) {
    sendJson(res, {
      quests: [
        { id: 1, title: '初创公司启航', description: '在农场排产苹果与种子，并在生鲜超市出售。', completed: true, reward: 500 }
      ]
    });
    return true;
  }

  const session = currentCompanyId ? { playerId: 1, companyId: currentCompanyId } : null;
  return globalRouteRegistry.dispatch(req, res, pathname, method, session);
}
