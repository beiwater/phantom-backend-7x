import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RouteRegistry } from '../server/http/route-registry.ts';
import type { GameContext } from '../server/context/game-context.ts';
import { registerPlayer } from '../server/db/seed/index.ts';
import { db } from '../server/db/connection.ts';
import { companyRepository } from '../server/repositories/company-repository.ts';

/**
 * Issue #181: the registry must build GameContext with the company's
 * persisted realm_id, not a hardcoded 0 — Challenge Realm policy
 * (exchange/contracts/bonds disabled, purchase limits) was silently
 * replaced by Normal Realm rules on every registry-owned endpoint.
 */

const { companyId } = registerPlayer(`realm_181_${Date.now()}@test.local`, 'password123', `Realm181 ${Date.now()}`);
db.prepare('UPDATE companies SET realm_id = 1 WHERE company_id = ?').run(companyId);

const persisted = companyRepository.findById(companyId);
assert.strictEqual(persisted?.realmId, 1, 'fixture company must be in challenge realm');

const registry = new RouteRegistry();
let captured: GameContext | null = null;
registry.register({
  method: 'GET',
  pattern: '/api/test/realm-probe/',
  auth: 'company',
  handler: (_req, _res, ctx) => {
    captured = ctx;
    return Promise.resolve();
  }
});

function fakeReq(): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(req, {
    url: '/api/test/realm-probe/',
    method: 'GET',
    headers: { 'content-length': '0' } as Record<string, string>,
    resume: () => req
  });
  queueMicrotask(() => req.emit('end'));
  return req;
}

function fakeRes(): ServerResponse {
  const probe = {
    statusCode: 0,
    writeHead(code: number) {
      probe.statusCode = code;
      return probe;
    },
    end() {
      return probe;
    },
    setHeader() {
      return probe;
    },
    getHeader() {
      return undefined;
    }
  };
  return probe as unknown as ServerResponse; // structural probe; handlers only use this surface
}

await registry.dispatch(
  fakeReq(),
  fakeRes(),
  '/api/test/realm-probe/',
  'GET',
  { playerId: 1, companyId }
);

assert.ok(captured, 'handler must receive a GameContext');
assert.strictEqual(captured.realmId, 1, 'ctx.realmId must reflect the persisted company realm');
assert.strictEqual(captured.rules.exchangeEnabled, false, 'challenge realm must disable the exchange via ctx.rules');
assert.strictEqual(captured.rules.contractsEnabled, false, 'challenge realm must disable contracts');
assert.strictEqual(captured.rules.bondsEnabled, false, 'challenge realm must disable bonds');

console.log('PASS registry GameContext carries the persisted realm policy (#181)');
