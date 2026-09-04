import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCliSlice,
  readJson,
  resolveFromRoot,
  sha256,
} from './lib.mjs';

const dimensions = ['dom', 'network', 'state', 'console', 'screenshot'];

function addFailure(failures, code, message, context = {}) {
  failures.push({ code, message, ...context });
}

function verifyArtifact(artifact, label, failures) {
  if (!artifact || typeof artifact.path !== 'string' || typeof artifact.sha256 !== 'string') {
    addFailure(failures, 'EVIDENCE_ARTIFACT_INVALID', 'Evidence artifact requires path and sha256', { label });
    return;
  }
  let filePath;
  try {
    filePath = resolveFromRoot(artifact.path);
  } catch (error) {
    addFailure(failures, 'EVIDENCE_PATH_INVALID', error.message, { label, path: artifact.path });
    return;
  }
  if (!fs.existsSync(filePath)) {
    addFailure(failures, 'EVIDENCE_FILE_MISSING', 'Evidence artifact is missing', { label, path: artifact.path });
    return;
  }
  const content = fs.readFileSync(filePath);
  if (content.length === 0) {
    addFailure(failures, 'EVIDENCE_FILE_EMPTY', 'Evidence artifact is empty', { label, path: artifact.path });
  }
  const actualHash = sha256(content);
  if (actualHash !== artifact.sha256) {
    addFailure(failures, 'EVIDENCE_HASH_MISMATCH', 'Evidence artifact hash does not match manifest', {
      label,
      path: artifact.path,
      expectedSha256: artifact.sha256,
      actualSha256: actualHash,
    });
  }
}

export function verifyBehaviorEvidence(slice) {
  const evidencePath = resolveFromRoot(`reconstruction/${slice}/behavior-evidence.json`);
  const failures = [];
  if (!fs.existsSync(evidencePath)) {
    addFailure(failures, 'BEHAVIOR_EVIDENCE_MISSING', `Missing reconstruction/${slice}/behavior-evidence.json`);
    return { gate: 'behavior', slice, status: 'FAIL', failures };
  }

  let evidence;
  try {
    evidence = readJson(evidencePath);
  } catch (error) {
    addFailure(failures, 'BEHAVIOR_EVIDENCE_INVALID_JSON', error.message);
    return { gate: 'behavior', slice, status: 'FAIL', failures };
  }

  if (evidence.schemaVersion !== 1 || evidence.slice !== slice) {
    addFailure(failures, 'BEHAVIOR_EVIDENCE_IDENTITY_INVALID', 'Behavior evidence must use schemaVersion 1 and match the slice', {
      schemaVersion: evidence.schemaVersion,
      actualSlice: evidence.slice,
    });
  }
  if (evidence.verifier?.mode !== 'VERIFY_ONLY' || !evidence.verifier?.id) {
    addFailure(failures, 'INDEPENDENT_VERIFIER_REQUIRED', 'L7 requires a named VERIFY_ONLY verifier');
  }

  for (const runName of ['production', 'recovered']) {
    const run = evidence.runs?.[runName];
    if (!run || typeof run.url !== 'string' || !run.url) {
      addFailure(failures, 'RUN_INVALID', 'Production and recovered runs require a URL', { run: runName });
      continue;
    }
    for (const dimension of dimensions) {
      verifyArtifact(run[dimension], `${runName}.${dimension}`, failures);
    }
  }

  for (const dimension of dimensions) {
    const comparison = evidence.comparisons?.[dimension];
    if (comparison?.status !== 'PASS') {
      addFailure(failures, 'COMPARISON_NOT_PASSING', 'Every behavior comparison must explicitly pass', {
        dimension,
        status: comparison?.status || null,
      });
      continue;
    }
    verifyArtifact(comparison.report, `comparisons.${dimension}.report`, failures);
  }

  return {
    gate: 'behavior',
    slice,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    verifier: evidence.verifier || null,
    dimensions: Object.fromEntries(dimensions.map((dimension) => [dimension, evidence.comparisons?.[dimension]?.status || 'MISSING'])),
    failures,
  };
}

function runCli() {
  const slice = parseCliSlice();
  const report = verifyBehaviorEvidence(slice);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
