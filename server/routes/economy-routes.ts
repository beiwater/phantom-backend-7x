import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './utils.ts';
import { RouteRegistry, globalRouteRegistry, type RouteParams } from '../http/route-registry.ts';
import {
  getEconomyPhase,
  getEconomyPhaseHistory,
  getEconomyPhaseStatistics
} from '../application/scheduler/daily-jobs.ts';
import { schedulerStateRepository } from '../repositories/scheduler-state-repository.ts';
import type { GameContext } from '../context/game-context.ts';

function queryWindow(req: IncomingMessage): { limit: number; offset: number } {
  const search = new URL(req.url || '/', 'http://localhost').searchParams;
  const limit = Number(search.get('limit') ?? 100);
  const offset = Number(search.get('offset') ?? 0);
  return {
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 100,
    offset: Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0
  };
}

function phaseCollection(req: IncomingMessage, res: ServerResponse, realmId: number): void {
  const { limit, offset } = queryWindow(req);
  const current = getEconomyPhase(realmId);
  const history = getEconomyPhaseHistory(realmId, limit, offset);
  const statistics = getEconomyPhaseStatistics(realmId);
  const total = schedulerStateRepository.countEconomyPhaseHistory(realmId);
  sendJson(res, {
    realmId,
    current,
    currentPhase: current,
    history,
    phases: history,
    statistics,
    pagination: { limit, offset, total, hasMore: offset + history.length < total }
  });
}

export function registerEconomyRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  const collection = async (req: IncomingMessage, res: ServerResponse, _ctx: GameContext | null, params: RouteParams) => {
    phaseCollection(req, res, Number(params.realmId));
  };
  const current = async (_req: IncomingMessage, res: ServerResponse, _ctx: GameContext | null, params: RouteParams) => {
    sendJson(res, getEconomyPhase(Number(params.realmId)));
  };
  const history = async (req: IncomingMessage, res: ServerResponse, _ctx: GameContext | null, params: RouteParams) => {
    const realmId = Number(params.realmId);
    const { limit, offset } = queryWindow(req);
    const rows = getEconomyPhaseHistory(realmId, limit, offset);
    const total = schedulerStateRepository.countEconomyPhaseHistory(realmId);
    sendJson(res, {
      realmId,
      history: rows,
      pagination: { limit, offset, total, hasMore: offset + rows.length < total }
    });
  };
  const statistics = async (_req: IncomingMessage, res: ServerResponse, _ctx: GameContext | null, params: RouteParams) => {
    sendJson(res, getEconomyPhaseStatistics(Number(params.realmId)));
  };

  registry
    .register({ method: 'GET', pattern: '/api/v2/realms/:realmId/phases/', owner: 'economy', handler: collection })
    .register({ method: 'GET', pattern: '/api/v3/realms/:realmId/phases/', owner: 'economy', handler: collection })
    .register({ method: 'GET', pattern: '/api/v2/economy/:realmId/', owner: 'economy', handler: collection })
    .register({ method: 'GET', pattern: '/api/v3/economy/:realmId/', owner: 'economy', handler: collection })
    .register({ method: 'GET', pattern: '/api/v2/economy/:realmId/phase/', owner: 'economy', handler: current })
    .register({ method: 'GET', pattern: '/api/v3/economy/:realmId/phase/', owner: 'economy', handler: current })
    .register({ method: 'GET', pattern: '/api/v2/economy/:realmId/history/', owner: 'economy', handler: history })
    .register({ method: 'GET', pattern: '/api/v3/economy/:realmId/history/', owner: 'economy', handler: history })
    .register({ method: 'GET', pattern: '/api/v2/economy/:realmId/statistics/', owner: 'economy', handler: statistics })
    .register({ method: 'GET', pattern: '/api/v3/economy/:realmId/statistics/', owner: 'economy', handler: statistics })
    .register({ method: 'GET', pattern: '/api/v2/economy/:realmId/stats/', owner: 'economy', handler: statistics })
    .register({ method: 'GET', pattern: '/api/v3/economy/:realmId/stats/', owner: 'economy', handler: statistics });
}

registerEconomyRoutes(globalRouteRegistry);
