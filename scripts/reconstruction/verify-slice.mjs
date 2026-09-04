import fs from 'node:fs';
import path from 'node:path';
import { auditProvenance } from './audit-provenance.mjs';
import { classifyReconstruction } from './classify-reconstruction.mjs';
import { parseCliSlice, resolveFromRoot } from './lib.mjs';
import { compareSliceSemantics } from './semantic-diff.mjs';
import { verifyBehaviorEvidence } from './verify-behavior.mjs';

function runGate(name, operation) {
  try {
    return operation();
  } catch (error) {
    return {
      gate: name,
      status: 'FAIL',
      failures: [{ code: 'GATE_CRASH', message: error.stack || error.message }],
    };
  }
}

const slice = parseCliSlice();
const staticOnly = process.argv.includes('--static');

const provenance = runGate('provenance', () => auditProvenance(slice));
const classification = runGate('classification', () => classifyReconstruction(slice));
const semantic = runGate('semantic', () => compareSliceSemantics(slice));
const behavior = staticOnly
  ? { gate: 'behavior', slice, status: 'SKIP', reason: '--static requested' }
  : runGate('behavior', () => verifyBehaviorEvidence(slice));

const requiredGates = staticOnly
  ? [provenance, classification, semantic]
  : [provenance, classification, semantic, behavior];
const status = requiredGates.every((gate) => gate.status === 'PASS') ? 'VERIFIED' : 'REJECTED';
const maturity = status === 'VERIFIED'
  ? (staticOnly ? 'L5_STATIC_GATES_PASS' : 'L7_1_TO_1_VERIFIED')
  : 'UNVERIFIED';

const report = {
  schemaVersion: 1,
  slice,
  mode: staticOnly ? 'STATIC' : 'FULL',
  status,
  maturity,
  gates: {
    provenance,
    classification,
    semantic,
    behavior,
  },
};

const reportDir = resolveFromRoot('reconstruction-report/verification');
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(
  path.join(reportDir, `${slice}.${staticOnly ? 'static' : 'full'}.json`),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
);

const summary = {
  slice,
  mode: report.mode,
  status,
  maturity,
  provenance: provenance.status,
  semantic: semantic.status,
  behavior: behavior.status,
  counts: classification.counts || null,
  syntheticBusiness: classification.counts?.SYNTHETIC_BUSINESS ?? null,
  unknown: classification.counts?.UNKNOWN ?? null,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (status !== 'VERIFIED') process.exitCode = 1;
