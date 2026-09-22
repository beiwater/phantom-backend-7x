import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const baselinePath = resolve('scripts/typecheck-baseline.json');
const result = spawnSync(resolve('node_modules/.bin/tsc'), ['--noEmit', '--pretty', 'false'], {
  encoding: 'utf8',
});
if (result.error) throw result.error;
if (result.status === null) throw new Error(`TypeScript did not complete: ${result.signal ?? 'unknown signal'}`);

const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
const current = {};
for (const line of output.split('\n')) {
  const match = line.match(/^(.+)\(\d+,\d+\): error (TS\d+):/);
  if (!match) continue;
  const key = `${match[1]}:${match[2]}`;
  current[key] = (current[key] ?? 0) + 1;
}

if (result.status !== 0 && Object.keys(current).length === 0) {
  throw new Error(`TypeScript failed without readable diagnostics:\n${output}`);
}

if (process.argv.includes('--update-baseline')) {
  writeFileSync(baselinePath, `${JSON.stringify(Object.fromEntries(Object.entries(current).sort()), null, 2)}\n`);
  console.log(`Recorded ${Object.values(current).reduce((sum, count) => sum + count, 0)} existing type errors.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const regressions = Object.entries(current).filter(([key, count]) => count > (baseline[key] ?? 0));
if (regressions.length > 0) {
  console.error('New TypeScript errors above the recorded baseline:');
  for (const [key, count] of regressions) {
    console.error(`  ${key}: ${count} (baseline ${baseline[key] ?? 0})`);
  }
  process.exit(1);
}

console.log(`TypeScript baseline passed: ${Object.values(current).reduce((sum, count) => sum + count, 0)} existing errors, no new errors.`);
