#!/usr/bin/env node
/**
 * Developer & Testing State Management CLI Tool.
 *
 * Usage:
 *   # 1. Time Warp
 *   node --experimental-strip-types scripts/dev-tool.ts warp --hours 10
 *   node --experimental-strip-types scripts/dev-tool.ts warp --days 3
 *   node --experimental-strip-types scripts/dev-tool.ts warp --reset
 *   node --experimental-strip-types scripts/dev-tool.ts warp --iso 2026-09-10T12:00:00Z
 *
 *   # 2. Preset Fixtures
 *   node --experimental-strip-types scripts/dev-tool.ts fixture --preset level-60-max
 *   node --experimental-strip-types scripts/dev-tool.ts fixture --preset restaurant-tycoon
 *   node --experimental-strip-types scripts/dev-tool.ts fixture --preset aerospace-corp
 *   node --experimental-strip-types scripts/dev-tool.ts fixture --preset fresh-account
 *
 *   # 3. Custom Scenarios
 *   node --experimental-strip-types scripts/dev-tool.ts fixture \
 *     --money 50000000 --level 40 --simboosts 10000 \
 *     --building "r:10" --building "P:5" \
 *     --warehouse "117:3:5000" --warehouse "1:2:20000"
 *
 *   # 4. Market Pricing Switcher
 *   node --experimental-strip-types scripts/dev-tool.ts market --mode realistic
 *   node --experimental-strip-types scripts/dev-tool.ts market --mode test
 *   node --experimental-strip-types scripts/dev-tool.ts market --status
 *
 *   # 5. Status Check
 *   node --experimental-strip-types scripts/dev-tool.ts status
 */
import { virtualClock } from '../server/core/virtual-clock.ts';
import { FixtureService, type ScenarioBuildingInput, type ScenarioWarehouseInput, type ScenarioExecutiveInput } from '../server/services/fixture-service.ts';

function parseArgs(args: string[]): Record<string, any> {
  const result: Record<string, any> = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        if (result[key]) {
          if (Array.isArray(result[key])) {
            result[key].push(next);
          } else {
            result[key] = [result[key], next];
          }
        } else {
          result[key] = next;
        }
        i++;
      } else {
        result[key] = true;
      }
    } else {
      result._.push(arg);
    }
  }
  return result;
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const command = argv._[0] || 'status';

  if (command === 'status') {
    console.log('=== SimCompanies Virtual Server Status ===');
    console.log(`Real Wall Clock : ${new Date().toISOString()}`);
    console.log(`Virtual Clock   : ${virtualClock.nowIso()}`);
    console.log(`Time Offset     : ${virtualClock.getOffsetHours()} hours (${virtualClock.getOffsetMs()} ms)`);
    const marketMode = FixtureService.getMarketPricingMode();
    console.log(`Market Pricing  : [${marketMode.mode.toUpperCase()}] (${marketMode.totalNpcOrders} active orders)`);
    console.log(`Presets Avail   : ${Object.keys(FixtureService.PRESETS).join(', ')}`);
    return;
  }

  if (command === 'warp') {
    console.log('=== Executing Time Warp ===');
    let res;
    if (argv.reset) {
      res = virtualClock.reset();
      console.log(`Clock reset to real time: ${res.newIso}`);
    } else if (argv.iso) {
      res = virtualClock.setTime(argv.iso);
      console.log(`Clock set to: ${res.newIso} (offset: ${res.offsetHours}h)`);
    } else {
      const hours = Number(argv.hours || 0);
      const days = Number(argv.days || 0);
      const minutes = Number(argv.minutes || 0);
      const seconds = Number(argv.seconds || 0);
      res = virtualClock.advance({ hours, days, minutes, seconds });
      console.log(`Advanced clock by: +${days}d +${hours}h +${minutes}m +${seconds}s`);
      console.log(`Previous: ${res.previousIso}`);
      console.log(`New Time: ${res.newIso} (total offset: ${res.offsetHours}h)`);
    }

    console.log('Resolving overdue game cycles...');
    const cycles = await virtualClock.resolveAllOverdue();
    console.log(`- Constructions/Upgrades completed : ${cycles.completedConstructions}`);
    console.log(`- Production batches completed     : ${cycles.completedProductions}`);
    console.log(`- Retail orders completed          : ${cycles.completedRetailOrders}`);
    console.log(`- Restaurant cycles resolved       : ${cycles.resolvedRestaurants}`);
    console.log(`- Building auctions settled        : ${cycles.settledAuctions}`);
    console.log('✅ Time warp and cycle resolution complete!');
    return;
  }

  if (command === 'fixture') {
    console.log('=== Applying State Fixture ===');
    let result;

    if (argv.preset) {
      console.log(`Loading preset: "${argv.preset}"...`);
      const overrides: Record<string, any> = {};
      if (argv.money) overrides.money = Number(argv.money);
      if (argv.simboosts) overrides.simboosts = Number(argv.simboosts);
      if (argv.level) overrides.level = Number(argv.level);
      if (argv.email) overrides.email = String(argv.email);
      result = await FixtureService.applyPreset(String(argv.preset), overrides);
    } else {
      const buildings: ScenarioBuildingInput[] = [];
      const buildingArgs = Array.isArray(argv.building) ? argv.building : (argv.building ? [argv.building] : []);
      for (const b of buildingArgs) {
        // format: "kind:size" or "kind:size:abundance" e.g. "r:5" or "G:10:98.5"
        const parts = String(b).split(':');
        buildings.push({
          kind: parts[0],
          size: Number(parts[1]) || 1,
          abundance: parts[2] ? Number(parts[2]) : 100,
          isLuxury: parts[0] === 'r' && (Number(parts[1]) >= 5)
        });
      }

      const warehouse: ScenarioWarehouseInput[] = [];
      const whArgs = Array.isArray(argv.warehouse) ? argv.warehouse : (argv.warehouse ? [argv.warehouse] : []);
      for (const w of whArgs) {
        // format: "kind:quality:amount" e.g. "117:3:5000"
        const parts = String(w).split(':');
        warehouse.push({
          kind: Number(parts[0]),
          quality: Number(parts[1]) || 0,
          amount: Number(parts[2]) || 1000
        });
      }

      const executives: ScenarioExecutiveInput[] = [];
      const execArgs = Array.isArray(argv.executive) ? argv.executive : (argv.executive ? [argv.executive] : []);
      for (const e of execArgs) {
        // format: "name:position:skill" e.g. "Gordon:coo:20"
        const parts = String(e).split(':');
        executives.push({
          name: parts[0],
          position: parts[1] || 'coo',
          skills: { management: Number(parts[2]) || 15 }
        });
      }

      result = await FixtureService.applyScenario({
        email: argv.email,
        companyName: argv.company,
        money: argv.money ? Number(argv.money) : undefined,
        simboosts: argv.simboosts ? Number(argv.simboosts) : undefined,
        level: argv.level ? Number(argv.level) : undefined,
        rating: argv.rating,
        buildings: buildings.length > 0 ? buildings : undefined,
        warehouse: warehouse.length > 0 ? warehouse : undefined,
        executives: executives.length > 0 ? executives : undefined
      });
    }

    console.log('✅ Fixture Applied Successfully:');
    console.log(`- Player ID     : ${result.playerId} (${result.email})`);
    console.log(`- Company ID    : ${result.companyId} (${result.companyName})`);
    console.log(`- Level / Money : Lv.${result.level} | $${result.money.toLocaleString()} | ${result.simboosts} SB`);
    console.log(`- Buildings     : ${result.buildingsCount} created`);
    console.log(`- Warehouse     : ${result.warehouseRows} resource types`);
    console.log(`- Executives    : ${result.executivesCount} hired`);
    console.log(`- Session Token : ${result.sessionToken}`);
    console.log(`\nDirect login header: Authorization: Bearer ${result.sessionToken}`);
    console.log(`Or set cookie: sim_session=${result.sessionToken}`);
    return;
  }

  if (command === 'market') {
    console.log('=== Marketplace Pricing Mode Manager ===');
    if (argv.status || (!argv.mode)) {
      const current = FixtureService.getMarketPricingMode();
      console.log(`Current Market Mode : [${current.mode.toUpperCase()}]`);
      console.log(`Total NPC Orders    : ${current.totalNpcOrders}`);
      console.log('\nTo switch pricing mode:');
      console.log('  scripts/dev-tool.ts market --mode realistic  (Canonical economy prices)');
      console.log('  scripts/dev-tool.ts market --mode test       (Flat $1.00 testing prices)');
      return;
    }

    const targetMode = String(argv.mode).toLowerCase();
    if (targetMode !== 'realistic' && targetMode !== 'test') {
      console.error(`Invalid mode: "${argv.mode}". Must be "realistic" or "test".`);
      process.exit(1);
    }

    console.log(`Switching marketplace pricing to [${targetMode.toUpperCase()}]...`);
    const res = await FixtureService.setMarketPricingMode(targetMode as 'realistic' | 'test');
    console.log(`✅ Market Pricing Switched to [${res.mode.toUpperCase()}]!`);
    console.log(`- Orders Updated : ${res.ordersUpdated}`);
    console.log('- Sample Resource Prices:');
    for (const sample of res.samplePrices) {
      console.log(`  * ${sample.resource.padEnd(32)}: Q0=$${sample.q0} | Q2=$${sample.q2}`);
    }
    return;
  }

  if (command === 'migrate') {
    const { MigrationRunner } = await import('../server/db/migrations/runner.ts');
    const runner = new MigrationRunner();
    console.log('=== Database Migration Manager ===');
    if (argv.status || (!argv.up && !argv.run)) {
      const currentVersion = runner.getLatestSchemaVersion();
      const applied = runner.getAppliedMigrations();
      console.log(`Current Schema Version: v${currentVersion}`);
      console.log(`Integrity Check       : ${runner.verifyIntegrity() ? 'OK' : 'FAILED'}`);
      console.log(`Applied Migrations    : ${applied.length}`);
      for (const m of applied) {
        console.log(`  * [v${String(m.version).padStart(3, '0')}] ${m.name.padEnd(32)} (${m.applied_at}) [${m.checksum || 'no-checksum'}]`);
      }
      return;
    }

    console.log('Running pending migrations...');
    const result = runner.runMigrations();
    console.log(`✅ Migrations Complete:`);
    console.log(`- Applied Count : ${result.appliedCount}`);
    console.log(`- Schema Version: v${result.currentVersion}`);
    for (const m of result.newlyApplied) {
      console.log(`  + [v${String(m.version).padStart(3, '0')}] ${m.name}`);
    }
    return;
  }
  if (command === 'backup') {
    const { backupEngine } = await import('../server/db/backup.ts');
    console.log('=== SQLite Hot Backup & Disaster Recovery Manager ===');

    if (argv.create) {
      console.log('Creating live online hot backup (VACUUM INTO)...');
      const meta = backupEngine.createBackup();
      console.log(`[OK] Backup Created Successfully:`);
      console.log(`- File      : ${meta.filename}`);
      console.log(`- Path      : ${meta.filepath}`);
      console.log(`- Size      : ${(meta.sizeBytes / 1024).toFixed(1)} KB`);
      console.log(`- SHA-256   : ${meta.sha256}`);
      console.log(`- Integrity : ${meta.integrity}`);
      return;
    }

    if (argv.list) {
      const backups = backupEngine.listBackups();
      console.log(`Found ${backups.length} backups:`);
      for (const b of backups) {
        console.log(`  * ${b.filename.padEnd(36)} | ${(b.sizeBytes / 1024).toFixed(1)} KB | SHA-256: ${b.sha256.substring(0, 16)}... | ${b.createdAt}`);
      }
      return;
    }

    if (argv.verify) {
      const target = String(argv.verify);
      console.log(`Verifying backup: ${target}...`);
      const res = backupEngine.verifyBackup(target);
      console.log(`- Checksum Match : ${res.checksumMatch ? 'PASS' : 'FAIL'}`);
      console.log(`- SQLite Check   : ${res.quickCheck}`);
      console.log(`- Overall Result : ${res.valid ? 'VALID' : 'INVALID'}`);
      return;
    }

    console.log('Usage:');
    console.log('  scripts/dev-tool.ts backup --create        (Create online hot backup)');
    console.log('  scripts/dev-tool.ts backup --list          (List all backups)');
    console.log('  scripts/dev-tool.ts backup --verify <file> (Verify backup checksum & integrity)');
    return;
  }

  console.log(`Unknown command: "${command}". Available commands: status, warp, fixture, market, migrate, backup`);
}

main().catch(err => {
  console.error('Error executing dev-tool:', err);
  process.exit(1);
});
