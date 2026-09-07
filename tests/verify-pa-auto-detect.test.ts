import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { companyRepository } from '../server/repositories/company-repository.ts';
import { socialRepository } from '../server/repositories/social-repository.ts';
import {
  hasPersonalAssistant,
  sendPersonalAssistantInvite,
  autoDetectAndInviteMissingPa
} from '../server/services/pa-invite-service.ts';
import { executeCommand } from '../server/game/commands/command-engine.ts';
import { handleSimboostRoutes } from '../server/routes/simboost-routes.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

function createMockRes() {
  let statusCode = 200;
  let bodyData = '';
  const headers: Record<string, string> = {};
  return {
    writeHead(status: number, hdrs?: Record<string, string>) {
      statusCode = status;
      if (hdrs) Object.assign(headers, hdrs);
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    end(chunk?: string) {
      if (chunk) bodyData += chunk;
    },
    getStatusCode() {
      return statusCode;
    },
    getBody<T = any>(): T {
      return JSON.parse(bodyData || '{}');
    }
  };
}

async function runTests() {
  console.log('--- Verifying PA Auto-Detection & Invitation System ---');

  // 1. Create a raw company without any DMs
  const uniquePlayerId = Math.floor(9000000 + Math.random() * 900000);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO players (player_id, email, password_hash, is_admin, created_at)
    VALUES (?, ?, 'hash', 0, ?)
  `).run(uniquePlayerId, `test_pa_${uniquePlayerId}@sim.local`, now);

  const compId = Math.floor(5000000 + Math.random() * 900000);
  db.prepare(`
    INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, extra_building_slots, realm_id, logo, personal_assistant, note, created_at)
    VALUES (?, ?, ?, 500000, 200, 1, 'BBB', 0, 0, 0, '', 'old', '', ?)
  `).run(compId, uniquePlayerId, `无助理企业_${uniquePlayerId}`, now);

  // Verify company initially has no PA contact
  assert.equal(hasPersonalAssistant(compId), false, 'Newly seeded test company should not have PA contact');
  console.log('✓ Detection correctly identified company without PA');

  // 2. Run autoDetectAndInviteMissingPa for target company
  const singleResult = autoDetectAndInviteMissingPa(compId);
  assert.equal(singleResult.checkedCount, 1);
  assert.equal(singleResult.invitedCount, 1);
  assert.deepEqual(singleResult.invitedCompanyIds, [compId]);
  assert.equal(hasPersonalAssistant(compId), true, 'Company should now have PA contact');

  const dms = socialRepository.listDirectMessages(compId, 0, undefined, 5);
  assert.ok(dms.length > 0, 'DM from PA should exist');
  assert.ok(dms[0].message.includes('个人助理（PA）入职与服务邀请'), 'Invite message content should match');
  assert.ok(dms[0].message.includes('/pa-action/welcome/accept/'), 'Invite should contain acceptance action link');
  console.log('✓ PA invitation successfully dispatched with interactive pa-reply link');

  // 3. Test idempotency
  const repeatResult = autoDetectAndInviteMissingPa(compId);
  assert.equal(repeatResult.invitedCount, 0, 'Repeated detection should not duplicate invitations');
  console.log('✓ Auto-detection idempotency verified');

  // 4. Test accepting the PA invite via pa-action
  const mockReq = {} as IncomingMessage;
  const mockRes = createMockRes();
  const handled = await handleSimboostRoutes(
    mockReq,
    mockRes as unknown as ServerResponse,
    '/api/v2/pa-action/welcome/accept/',
    'POST',
    uniquePlayerId,
    compId
  );
  assert.equal(handled, true, 'handleSimboostRoutes should handle /api/v2/pa-action/welcome/accept/');
  const body = mockRes.getBody();
  assert.equal(body.done, true);
  assert.equal(body.success, true);

  const updatedDms = socialRepository.listDirectMessages(compId, 0, undefined, 5);
  assert.ok(updatedDms.some(m => m.message.includes('个人助理已就任')), 'Confirmation message should be sent by PA');
  console.log('✓ /pa-action/welcome/accept/ successfully handled with confirmation reply');

  // 5. Test /pa command execution
  const statusRes = await executeCommand('/pa status', {
    executorCompanyId: compId,
    isOp: false,
    source: 'pa',
    realmId: 0
  });
  assert.equal(statusRes.success, true);
  assert.ok(statusRes.message.includes('个人助理状态'));
  assert.ok(statusRes.message.includes('已建立联络'));
  console.log('✓ /pa status command verified');

  const checkRes = await executeCommand('/pa check', {
    executorCompanyId: compId,
    isOp: false,
    source: 'pa',
    realmId: 0
  });
  assert.equal(checkRes.success, true);
  assert.ok(checkRes.assistantReply?.includes('已建立个人助理日常联络'));
  console.log('✓ /pa check command verified');

  console.log('\n🎉 ALL PA AUTO-DETECTION & INVITATION TESTS PASSED! 🎉');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
