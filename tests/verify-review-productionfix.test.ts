import assert from 'node:assert/strict';
import { db } from '../server/db/database.ts';
import { registerPlayer } from '../server/db/seed/index.ts';
import { createGameContext } from '../server/context/game-context.ts';
import { buildingRepository } from '../server/repositories/building-repository.ts';
import { warehouseRepository } from '../server/repositories/warehouse-repository.ts';
import { productionRepository } from '../server/repositories/production-repository.ts';
import { startProductionUseCase } from '../server/application/production/start-production.ts';
import { cancelProductionUseCase } from '../server/application/production/cancel-production.ts';
import { rushProductionUseCase } from '../server/application/production/rush-production.ts';
import { collectProductionUseCase } from '../server/application/production/collect-production.ts';
import { placeBuildingUseCase } from '../server/application/buildings/place-building.ts';
import { estimateUpgradeCost, estimateDemolitionRefund } from '../server/domain/buildings/building-rules.ts';
import { calculateProductionTime } from '../server/game-data/buildings.ts';
import { applyResearch, getResourceResearchAbility } from '../server/game/research.ts';

const { companyId, playerId } = registerPlayer(`productionfix_${Date.now()}@test.local`, 'password123', 'Production review regression');
const ctx = createGameContext(companyId, playerId, 0);
db.prepare('UPDATE companies SET level=30, money=100000000, simboosts=10000 WHERE company_id=?').run(companyId);
function building(kind: string, position: string) {
  return buildingRepository.create({companyId, kind, position, size:1, name:kind, cost:1000, category:'production', createdAt:new Date().toISOString(), abundance:100, originalAbundance:100});
}
function amount(kind: number) { return Number(warehouseRepository.findByCompanyAndResource(companyId, kind)?.amount ?? 0); }
const mine = building('M','8');
warehouseRepository.addResource(companyId,1,0,1000000);
assert.throws(() => calculateProductionTime(14,100,1,0,{abundance:0}), /positive production rate/);
await assert.rejects(startProductionUseCase(ctx,{buildingId:mine.id,kind:14,amount:1000000,quality:0}), /limit|duration|hours/i);
const mining = await startProductionUseCase(ctx,{buildingId:mine.id,kind:14,amount:100,quality:0});
assert.ok(mining.queueItem.durationSeconds > 60);
await cancelProductionUseCase(ctx,{buildingId:mine.id});
console.log('PASS mining Q0 uses real abundance and cannot bypass duration limits');
const bulk = estimateUpgradeCost('M',9,1);
const single = estimateUpgradeCost('M',1,1);
const refund = estimateDemolitionRefund('M',1000,9);
for (const material of bulk.materials) {
  assert.equal(material.amount, single.materials.find(x=>x.kind===material.kind)!.amount * 45);
  assert.ok(material.amount > refund.materialRefund.find(x=>x.kind===material.kind)!.amount);
}
assert.deepEqual(estimateUpgradeCost('M',1,1).materials, single.materials);
console.log('PASS bulk upgrades charge every sequential level and exceed downgrade refunds');
const nursery = building('v','9');
const now = new Date();
productionRepository.create({buildingId:nursery.id,companyId,kind:150,quality:0,cost:7,amount:10,durationSeconds:3600,startedAt:now.toISOString(),finishesAt:new Date(now.getTime()+3600000).toISOString()});
const treesBefore = amount(150);
await rushProductionUseCase(ctx,{buildingId:nursery.id});
assert.equal(amount(150)-treesBefore,1);
const pad = building('l','10');
warehouseRepository.addResource(companyId,91,0,3);
const researchBefore = amount(100);
for (let i=0;i<2;i++) {
  const launch = await startProductionUseCase(ctx,{buildingId:pad.id,kind:91,amount:1});
  assert.equal(launch.queueItem.launchConsumesResearch,false);
  await cancelProductionUseCase(ctx,{buildingId:pad.id});
  assert.equal(amount(100),researchBefore);
}
warehouseRepository.addResource(companyId,100,0,400);
await startProductionUseCase(ctx,{buildingId:pad.id,kind:100,amount:400});
await cancelProductionUseCase(ctx,{buildingId:pad.id});
assert.equal(amount(100),researchBefore+400);
const random = Math.random;
try {
  Math.random=()=>0.99;
  await startProductionUseCase(ctx,{buildingId:pad.id,kind:91,amount:1});
  await rushProductionUseCase(ctx,{buildingId:pad.id});
} finally { Math.random=random; }
assert.equal(amount(100),researchBefore+400);
assert.equal(getResourceResearchAbility(companyId,91).patents,4);
console.log('PASS rushed nursery/launch use dedicated completion; launch refunds honor consumed flag and patents persist');
warehouseRepository.addResource(companyId,29,0,1000);
db.prepare("UPDATE executives SET position='none' WHERE company_id=?").run(companyId);
db.prepare("INSERT INTO executives(company_id,name,position,skill_science,status) VALUES (?,'Regression CTO','cto',100,'employed')").run(companyId);
await applyResearch(companyId,1,500);
assert.equal(getResourceResearchAbility(companyId,3).patents,20);
db.prepare("UPDATE executives SET position='none' WHERE company_id=?").run(companyId);
await applyResearch(companyId,1,1);
assert.equal(getResourceResearchAbility(companyId,3).patents,20);
await applyResearch(companyId,1,49);
assert.equal(getResourceResearchAbility(companyId,3).patents,21);
db.prepare("UPDATE executives SET position='cto' WHERE company_id=? AND name='Regression CTO'").run(companyId);
await applyResearch(companyId,1,25);
assert.equal(getResourceResearchAbility(companyId,3).patents,22);
console.log('PASS CTO changes preserve historical patents and fractional new progress');
const lifted = building('P','l');
const occupied = buildingRepository.findByCompany(companyId).find(x=>x.position==='0')!;
assert.ok(occupied);
for (const position of ['00','0e0','000']) await assert.rejects(placeBuildingUseCase(ctx,{buildingId:lifted.id,position}), /occupied/);
await placeBuildingUseCase(ctx,{buildingId:lifted.id,position:'011'});
assert.equal(buildingRepository.findById(lifted.id)!.position,'11');
const surplus = building('P','l');
db.prepare('UPDATE companies SET level=0, extra_building_slots=1 WHERE company_id=?').run(companyId);
await assert.rejects(placeBuildingUseCase(ctx,{buildingId:surplus.id,position:'B0'}), /slot limit/);
db.prepare('UPDATE companies SET level=30, extra_building_slots=0 WHERE company_id=?').run(companyId);
console.log('PASS placement canonicalizes slots, rejects aliases, and enforces slot entitlement');
const farm = buildingRepository.findByCompany(companyId).find(x=>x.kind==='P' && x.id!==lifted.id && x.id!==surplus.id)!;
db.prepare('DELETE FROM warehouse WHERE company_id=? AND kind IN (2,66,3)').run(companyId);
warehouseRepository.addResource(companyId,2,12,10000,{market:3});
warehouseRepository.addResource(companyId,66,12,10000,{market:5});
db.prepare('DELETE FROM research WHERE company_id=? AND discipline=1').run(companyId);
const apples = await startProductionUseCase(ctx,{buildingId:farm.id,kind:3,amount:100});
assert.equal(apples.queueItem.quality,0);
productionRepository.finishImmediately(apples.queueItem.id,companyId,new Date(0).toISOString());
const collected = collectProductionUseCase(ctx,{buildingOrQueueId:apples.queueItem.id});
assert.equal(collected.warehouseItem!.costMarket,apples.queueItem.cost);
console.log('PASS inferred quality obeys research cap and collected output retains queued cost');
console.log('PASS all production review regressions');
process.exit(0);
