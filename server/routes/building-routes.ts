import type { IncomingMessage, ServerResponse } from 'node:http';
import { RouteRegistry, globalRouteRegistry } from '../http/route-registry.ts';
import { sendJson } from './utils.ts';
import {
  startProductionUseCase,
  type StartProductionInput
} from '../application/production/start-production.ts';
import { cancelProductionUseCase } from '../application/production/cancel-production.ts';
import { collectProductionUseCase } from '../application/production/collect-production.ts';
import { getProductionQueueUseCase } from '../application/production/get-production-queue.ts';
import { getProductionHistoryUseCase } from '../application/production/get-production-history.ts';
import { constructBuildingUseCase } from '../application/buildings/construct-building.ts';
import { upgradeBuildingUseCase } from '../application/buildings/upgrade-building.ts';
import { downgradeBuildingUseCase } from '../application/buildings/downgrade-building.ts';
import { demolishBuildingUseCase } from '../application/buildings/demolish-building.ts';
import { renameBuildingUseCase } from '../application/buildings/rename-building.ts';
import { getCompanyBuildingsUseCase } from '../application/buildings/get-buildings.ts';
import { getBuildingDetailsUseCase } from '../application/buildings/get-building-details.ts';
import { buildingRepository } from '../repositories/building-repository.ts';
import { normalizePosition } from '../domain/buildings/building-rules.ts';
import {
  toSimCompaniesBuildingDTO,
  toSimCompaniesBuildingsListDTO
} from '../compatibility/simcompanies/building-dto.ts';
import {
  toSimCompaniesStartProductionDTO,
  toSimCompaniesCancelProductionDTO,
  toSimCompaniesCollectProductionDTO,
  toSimCompaniesQueueDTO,
  toSimCompaniesHistoryDTO
} from '../compatibility/simcompanies/production-dto.ts';
import { ValidationError } from '../errors/domain-error.ts';

export function registerBuildingRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  // 1. v1 Busy / Start Production endpoints
  const startProductionHandler = async (
    _req: IncomingMessage,
    res: ServerResponse,
    ctx: any,
    params: Record<string, string>,
    body: any
  ) => {
    const buildingId = Number(params.id);
    if (!body?.kind || !body?.amount) {
      throw new ValidationError('kind and amount are required');
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

  // 4. Followers stubs
  registry.register({
    method: 'GET',
    pattern: '/api/v3/companies/buildings/:id/followers/',
    auth: 'none',
    handler: async (_req, res) => {
      sendJson(res, { linking: [] });
    }
  });

  registry.register({
    method: 'POST',
    pattern: '/api/v3/companies/buildings/:id/followers/',
    auth: 'none',
    handler: async (_req, res) => {
      sendJson(res, { error: 'Building followers are not supported yet' }, 501);
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
    const kind = body.kind || (typeof body.id === 'object' && body.id ? body.id.id : body.id) || 'P';
    if (!body.position) {
      throw new ValidationError('Building position is required');
    }
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
      const newPos = normalizePosition(body.position);
      const updated = buildingRepository.updatePosition(buildingId, ctx.companyId, newPos);
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

  // Sales orders and Restaurant stubs for building detail page
  registry.register({
    method: 'GET',
    pattern: '/api/v2/companies/buildings/:id/sales-orders/',
    auth: 'none',
    handler: async (_req, res) => {
      sendJson(res, []);
    }
  });

  registry.register({
    method: 'GET',
    pattern: '/api/v2/companies/buildings/:id/restaurant-properties/',
    auth: 'none',
    handler: async (_req, res) => {
      sendJson(res, {
        isLuxury: false,
        goodService: false,
        saladBar: [],
        mains: [],
        drinks: [],
        menuPrice: 10
      });
    }
  });

  registry.register({
    method: 'GET',
    pattern: '/api/v2/companies/buildings/:id/restaurant-runs/',
    auth: 'none',
    handler: async (_req, res) => {
      sendJson(res, []);
    }
  });
  // 7. Building Abundance
  registry.register({
    method: 'GET',
    pattern: '/api/v2/companies/buildings/:id/abundance/',
    auth: 'none',
    handler: async (_req, res) => {
      sendJson(res, { abundance: 100, originalAbundance: 100 });
    }
  });

  // 8. Building Robots
  registry.register({
    method: 'POST',
    pattern: '/api/v2/companies/buildings/:id/robots/',
    auth: 'company',
    handler: async (_req, res) => {
      sendJson(res, { robotsInstalled: true, wageDiscount: 0.03 });
    }
  });

  registry.register({
    method: 'DELETE',
    pattern: '/api/v2/companies/buildings/:id/robots/',
    auth: 'company',
    handler: async (_req, res) => {
      sendJson(res, { robotsInstalled: false, wageDiscount: 0 });
    }
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

  // 10. Take finished production order
  registry.register({
    method: 'POST',
    pattern: '/api/v2/order/take/:id/',
    auth: 'company',
    handler: async (_req, res, ctx, params) => {
      const requestedId = Number(params.id);
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
