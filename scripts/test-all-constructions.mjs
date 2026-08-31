import { getBuildingMeta, constructBuilding, formatBuilding } from '../server/game/buildings.ts';
import { CONSTANTS_BUILDINGS } from '../server/game/constants.ts';
import { db, registerOrAuthenticatePlayer } from '../server/db/database.ts';

async function testAllConstructions() {
  console.log('Testing all building types in game constants and ALL_BUILDINGS...');
  const auth = registerOrAuthenticatePlayer('builder_all@test.local', 'Password123!', 'Mega Build Corp');
  const companyId = auth.companyId;

  db.prepare('UPDATE companies SET money = 10000000 WHERE company_id = ?').run(companyId);
  db.prepare('UPDATE companies SET money = 10000000 WHERE id = ?').run(companyId);

  const errors = [];
  const buildingKinds = Object.keys(CONSTANTS_BUILDINGS);
  console.log(`Total building kinds in CONSTANTS_BUILDINGS: ${buildingKinds.length}`);

  for (const kind of buildingKinds) {
    try {
      const meta = getBuildingMeta(kind);
      const res = constructBuilding(companyId, kind, '2');
      if (!res.building) {
        errors.push(`Building kind "${kind}" (${meta.name}): constructBuilding returned null building`);
      } else {
        // Verify formatted building shape
        if (typeof res.building.id !== 'number' || !res.building.kind || !res.building.category) {
          errors.push(`Building kind "${kind}" (${meta.name}): invalid formatBuilding shape: ${JSON.stringify(res.building)}`);
        }
      }
    } catch (err) {
      errors.push(`Building kind "${kind}": threw error -> ${err.message}`);
    }
  }

  console.log(`Tested ${buildingKinds.length} building kinds. Errors found: ${errors.length}`);
  for (const e of errors) {
    console.error(' -', e);
  }

  // Test position variations: '2', 'B2', 'b2', '10', 'B10'
  const positions = ['2', 'B2', 'b2', '3', 'B3', '10', 'B10'];
  for (const pos of positions) {
    try {
      const res = constructBuilding(companyId, 'P', pos);
      console.log(`Position "${pos}" constructed successfully with building id ${res.building?.id}`);
    } catch (err) {
      console.error(`Position "${pos}" failed:`, err.message);
    }
  }
}

testAllConstructions().catch(console.error);
