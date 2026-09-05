import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';

const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

type CompanySummary = {
  id: number;
  company: string;
  realmId: number;
};

type AuthData = {
  authUser: { id: number };
  authCompany: {
    id: number;
    companyId: number;
    realmId: number;
    money: number;
    simBoosts: number;
    level: number;
  };
  companies: CompanySummary[];
};

type CompanyAssetSnapshot = {
  company: Record<string, unknown>;
  buildings: Array<Record<string, unknown>>;
  warehouse: Array<Record<string, unknown>>;
};

function sessionCookie(response: Response): string {
  const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  const cookie = cookies.find(value => value.startsWith('sessionid='))?.split(';')[0];
  assert.ok(cookie, 'Must receive sessionid cookie');
  return cookie;
}

async function authData(cookie: string): Promise<AuthData> {
  const response = await fetch(`${baseUrl}/api/v3/companies/auth-data/`, {
    headers: { Cookie: cookie }
  });
  assert.equal(response.status, 200, 'auth-data must be available');
  return await response.json() as AuthData;
}

function companySnapshot(companyId: number): CompanyAssetSnapshot {
  const company = db.prepare(`
    SELECT player_id, money, simboosts, level, rating, experience, logo,
           personal_assistant, note, extra_building_slots,
           extra_executive_slots, display_case_slots, max_tags
    FROM companies WHERE company_id = ?
  `).get(companyId) as Record<string, unknown> | undefined;
  assert.ok(company, `Company ${companyId} must exist before migration`);
  const buildings = db.prepare(
    'SELECT * FROM buildings WHERE company_id = ? ORDER BY id ASC'
  ).all(companyId) as Array<Record<string, unknown>>;
  const warehouse = db.prepare(
    'SELECT * FROM warehouse WHERE company_id = ? ORDER BY kind ASC, quality ASC, id ASC'
  ).all(companyId) as Array<Record<string, unknown>>;
  return { company, buildings, warehouse };
}

console.log('================================================================');
console.log(' Verifying Same-Login Company Selection by companyId');
console.log('================================================================');

const time = Date.now();
const unauthSwitch = await fetch(`${baseUrl}/api/v2/companies/switch/1/`, {
  method: 'POST'
});
assert.equal(unauthSwitch.status, 401, 'Unauthenticated switch must be rejected');
const unauthCreate = await fetch(`${baseUrl}/api/v2/companies/create/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: `Unauth Corp ${time}` })
});
assert.equal(unauthCreate.status, 401, 'Unauthenticated company creation must be rejected');
const unauthMigration = await fetch(`${baseUrl}/api/v2/companies/migrate/1/realm0/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ confirm: true })
});
assert.equal(unauthMigration.status, 401, 'Unauthenticated migration must be rejected');
console.log('[security] Unauthenticated create, switch, and migration rejected');

const cookie = sessionCookie(await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: `company_selector_${time}@domain.local`,
    password: 'Password123!',
    company: `Primary Corp ${time}`
  })
}));

const firstAuth = await authData(cookie);
const firstCompanyId = firstAuth.authCompany.id;
const playerId = firstAuth.authUser.id;
assert.ok(firstCompanyId > 0, 'Primary company ID must exist');
assert.equal(firstAuth.authCompany.realmId, 0, 'Registration must create realm 0');
console.log(`[1/8] Registered player #${playerId} with realm-0 company #${firstCompanyId}`);

const secondCreate = await fetch(`${baseUrl}/api/v2/companies/create/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ name: `Second Corp ${time}` })
});
assert.equal(secondCreate.status, 200, 'Same-login company creation must succeed');
const secondCreateData = await secondCreate.json() as {
  status: string;
  companyId: number;
  playerId: number;
  realmId: number;
};
assert.equal(secondCreateData.status, 'ok');
assert.equal(secondCreateData.playerId, playerId, 'Company selector must keep the authenticated player');
assert.equal(secondCreateData.realmId, 0, 'Company selector must always create realm 0');
const secondCompanyId = secondCreateData.companyId;
assert.ok(secondCompanyId > 0 && secondCompanyId !== firstCompanyId, 'Second company must have a distinct ID');
console.log(`[2/8] Selector created second realm-0 company #${secondCompanyId} for player #${playerId}`);

const companiesAfterCreate = await (await fetch(`${baseUrl}/api/v2/players/me/companies/`, {
  headers: { Cookie: cookie }
})).json() as CompanySummary[];
assert.equal(companiesAfterCreate.length, 2, 'Player must own exactly two selector companies');
assert.ok(companiesAfterCreate.every(company => company.realmId === 0), 'Both selector companies must be in realm 0');
assert.deepEqual(
  companiesAfterCreate.map(company => company.id).sort((a, b) => a - b),
  [firstCompanyId, secondCompanyId].sort((a, b) => a - b),
  'Company list must identify both companies by distinct IDs'
);
console.log(`[3/8] Both companies listed in realm 0: #${firstCompanyId}, #${secondCompanyId}`);
const thirdCreate = await fetch(`${baseUrl}/api/v2/companies/create/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ name: `Third Corp ${time}` })
});
assert.equal(thirdCreate.status, 409, 'Same-login company creation must reject a third company');
const thirdCreateData = await thirdCreate.json() as { error?: string; code?: string };
assert.match(thirdCreateData.error ?? '', /company limit|at most|two/i, 'Third company rejection must explain the limit');
assert.equal(thirdCreateData.code, 'CONFLICT', 'Third company rejection must use the conflict domain error');
const companiesAfterLimit = await (await fetch(`${baseUrl}/api/v2/players/me/companies/`, {
  headers: { Cookie: cookie }
})).json() as CompanySummary[];
assert.equal(companiesAfterLimit.length, 2, 'Rejected third creation must leave the owned list at two companies');
assert.deepEqual(
  companiesAfterLimit.map(company => company.id).sort((a, b) => a - b),
  [firstCompanyId, secondCompanyId].sort((a, b) => a - b),
  'Rejected third creation must not add a company'
);
console.log('[4/8] Third selector company rejected with 409 and no persisted third company');
const noSlashCreate = await fetch(`${baseUrl}/api/v2/companies/create`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ name: `No Slash Corp ${time}` }),
  signal: AbortSignal.timeout(3000)
});
assert.equal(noSlashCreate.status, 409, 'No-slash create route must not hang or bypass the company cap');

for (const path of [
  `/api/v2/companies/switch/not-a-number/`,
  `/api/v2/companies/switch/9007199254740992/`,
  `/api/v2/companies/migrate/not-a-number/realm0/`,
  `/api/v2/companies/migrate/9007199254740992/realm0/`
]) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ confirm: true }),
    signal: AbortSignal.timeout(3000)
  });
  assert.equal(response.status, 400, `Malformed company ID must be rejected promptly: ${path}`);
}
console.log('[security] Malformed IDs and no-slash create route rejected promptly');

// Preserve official realm-index semantics while creating a legacy row to move
// through the explicit authenticated migration action below.
const legacyCreate = await fetch(`${baseUrl}/api/v1/realm-create-company/1/`, {
  method: 'POST',
  headers: { Cookie: cookie }
});
assert.equal(legacyCreate.status, 200, 'Official realm-create API must remain available');
const legacyCreateData = await legacyCreate.json() as {
  status: string;
  redirectUrl: string;
  companyId: number;
  realmId: number;
};
assert.equal(legacyCreateData.status, 'redirect');
assert.equal(legacyCreateData.redirectUrl, '/zh-cn/create/');
assert.equal(legacyCreateData.realmId, 1, 'Official realm-create API must preserve realm 1 semantics');
const legacyCompanyId = legacyCreateData.companyId;
assert.ok(legacyCompanyId > 0 && ![firstCompanyId, secondCompanyId].includes(legacyCompanyId));
const legacyBefore = companySnapshot(legacyCompanyId);
const legacyAuthBefore = await authData(cookie);
assert.equal(legacyAuthBefore.authUser.id, playerId);
assert.equal(legacyAuthBefore.authCompany.id, legacyCompanyId);
assert.equal(legacyAuthBefore.authCompany.realmId, 1);
console.log(`[5/8] Created legacy realm-1 company #${legacyCompanyId} under the same player`);
for (const confirmationBody of [{}, { confirm: false }, { confirm: 'true' }]) {
  const response = await fetch(`${baseUrl}/api/v2/companies/migrate/${legacyCompanyId}/realm0/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(confirmationBody)
  });
  assert.equal(response.status, 400, 'Migration must require an explicit boolean confirmation');
}
const unconfirmedAuth = await authData(cookie);
assert.equal(unconfirmedAuth.authCompany.id, legacyCompanyId);
assert.equal(unconfirmedAuth.authCompany.realmId, 1, 'Rejected migration must not change realm');
console.log('[security] Missing, false, and nonboolean migration confirmation rejected');

const migration = await fetch(`${baseUrl}/api/v2/companies/migrate/${legacyCompanyId}/realm0/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ confirm: true })
});
assert.equal(migration.status, 200, 'Explicit owned-company migration must succeed');
const migrationData = await migration.json() as {
  status: string;
  companyId: number;
  playerId: number;
  fromRealmId: number;
  realmId: number;
  updatedRows: Record<string, number>;
};
assert.equal(migrationData.status, 'ok');
assert.equal(migrationData.companyId, legacyCompanyId, 'Migration must preserve companyId');
assert.equal(migrationData.playerId, playerId, 'Migration must preserve playerId');
assert.equal(migrationData.fromRealmId, 1);
assert.equal(migrationData.realmId, 0);
assert.equal(migrationData.updatedRows.companies, 1);
const legacyAfterSnapshot = companySnapshot(legacyCompanyId);
assert.deepEqual(legacyAfterSnapshot, legacyBefore, 'Migration must preserve company assets and progression');
const legacyAfter = await authData(cookie);
assert.equal(legacyAfter.authUser.id, playerId);
assert.equal(legacyAfter.authCompany.id, legacyCompanyId);
assert.equal(legacyAfter.authCompany.realmId, 0);
console.log(`[6/8] Migrated #${legacyCompanyId} to realm 0 without changing identity or assets`);

const allCompaniesAfterMigration = await (await fetch(`${baseUrl}/api/v2/players/me/companies/`, {
  headers: { Cookie: cookie }
})).json() as CompanySummary[];
assert.equal(allCompaniesAfterMigration.length, 3);
assert.ok(allCompaniesAfterMigration.every(company => company.realmId === 0));

const switchSecond = await fetch(`${baseUrl}/api/v2/companies/switch/${secondCompanyId}/`, {
  method: 'POST',
  headers: { Cookie: cookie }
});
assert.equal(switchSecond.status, 200, 'CompanyId switch must succeed for an owned company');
const switchSecondData = await switchSecond.json() as { status: string; companyId: number; realmId: number };
assert.equal(switchSecondData.status, 'redirect');
assert.equal(switchSecondData.companyId, secondCompanyId);
assert.equal(switchSecondData.realmId, 0);
const secondAuth = await authData(cookie);
assert.equal(secondAuth.authUser.id, playerId);
assert.equal(secondAuth.authCompany.id, secondCompanyId);
assert.equal(secondAuth.authCompany.realmId, 0);
console.log(`[7/8] CompanyId switch persisted active company #${secondCompanyId}`);
const crossOriginBefore = await authData(cookie);
const crossOriginSwitch = await fetch(`${baseUrl}/api/v2/companies/switch/${firstCompanyId}/`, {
  method: 'POST',
  headers: {
    Cookie: cookie,
    Origin: 'https://evil.example'
  }
});
assert.equal(crossOriginSwitch.status, 403, 'Cross-origin switch must be rejected');
const crossOriginAfter = await authData(cookie);
assert.deepEqual(
  {
    playerId: crossOriginAfter.authUser.id,
    companyId: crossOriginAfter.authCompany.id,
    realmId: crossOriginAfter.authCompany.realmId
  },
  {
    playerId: crossOriginBefore.authUser.id,
    companyId: crossOriginBefore.authCompany.id,
    realmId: crossOriginBefore.authCompany.realmId
  },
  'Rejected cross-origin switch must not alter the session'
);
console.log('[security] Cross-origin switch rejected without changing the session');

const otherCookie = sessionCookie(await fetch(`${baseUrl}/api/v2/auth/email/connect/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: `foreign_selector_${time}@domain.local`,
    password: 'Password123!',
    company: `Foreign Corp ${time}`
  })
}));
const foreignBefore = await authData(otherCookie);
const foreignMigration = await fetch(`${baseUrl}/api/v2/companies/migrate/${secondCompanyId}/realm0/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: otherCookie },
  body: JSON.stringify({ confirm: true })
});
assert.equal(foreignMigration.status, 403, 'Foreign player must not migrate another company');
const foreignAfter = await authData(otherCookie);
assert.deepEqual(
  {
    playerId: foreignAfter.authUser.id,
    companyId: foreignAfter.authCompany.id,
    realmId: foreignAfter.authCompany.realmId
  },
  {
    playerId: foreignBefore.authUser.id,
    companyId: foreignBefore.authCompany.id,
    realmId: foreignBefore.authCompany.realmId
  },
  'Rejected foreign migration must not alter the foreign session'
);
console.log('[security] Foreign-owner migration rejected without changing state');
const foreignSwitch = await fetch(`${baseUrl}/api/v2/companies/switch/${secondCompanyId}/`, {
  method: 'POST',
  headers: { Cookie: otherCookie }
});
assert.equal(foreignSwitch.status, 404, 'Foreign player must not switch into another player company');
const foreignAuth = await authData(otherCookie);
assert.deepEqual(
  {
    playerId: foreignAuth.authUser.id,
    companyId: foreignAuth.authCompany.id,
    realmId: foreignAuth.authCompany.realmId
  },
  {
    playerId: foreignBefore.authUser.id,
    companyId: foreignBefore.authCompany.id,
    realmId: foreignBefore.authCompany.realmId
  },
  'Rejected foreign switch must not alter the foreign session'
);

console.log('================================================================');
console.log(' [ALL TESTS PASSED] SAME-LOGIN COMPANY SELECTION VERIFIED');
console.log('================================================================');
