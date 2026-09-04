import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { sha256 } from './lib.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const verifyScript = path.join(scriptDir, 'verify-slice.mjs');

function createFixture(targetSource, classification = 'RECOVERED') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reconstruction-gate-'));
  const sourcePath = 'frontend-original/static/bundle/assets/index.js';
  const artifactPath = 'reconstruction/sample/filter.ts';
  const source = 'const a=(e)=>e.filter(t=>t.quantity>0);';

  fs.mkdirSync(path.join(root, path.dirname(sourcePath)), { recursive: true });
  fs.mkdirSync(path.join(root, path.dirname(artifactPath)), { recursive: true });
  fs.mkdirSync(path.join(root, 'reconstruction-report'), { recursive: true });
  fs.writeFileSync(path.join(root, sourcePath), source);
  fs.writeFileSync(path.join(root, artifactPath), targetSource);

  const sourceHash = sha256(source);
  fs.writeFileSync(path.join(root, 'reconstruction-report/baseline-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    sourceCommit: 'fixture',
    files: [{ path: sourcePath, sha256: sourceHash }],
  }));
  fs.writeFileSync(path.join(root, 'reconstruction/sample/provenance.json'), JSON.stringify({
    schemaVersion: 1,
    slice: 'sample',
    source: { path: sourcePath, sha256: sourceHash },
    artifacts: [{
      file: artifactPath,
      symbols: [{
        recoveredSymbol: 'filterPositive',
        originalSymbol: 'a',
        bundleRange: [0, source.length],
        classification,
        confidence: 1,
        evidence: ['Fixture source binding a contains the complete filter expression'],
        semantic: { mode: 'EXACT_ALPHA', aliases: {} },
      }],
    }],
  }));
  return { root, sourcePath };
}

function verify(root, ...args) {
  return spawnSync(process.execPath, [verifyScript, 'sample', ...args], {
    cwd: root,
    env: { ...process.env, RECONSTRUCTION_ROOT: root },
    encoding: 'utf8',
  });
}

function readReport(root, mode) {
  return JSON.parse(fs.readFileSync(
    path.join(root, `reconstruction-report/verification/sample.${mode}.json`),
    'utf8',
  ));
}

test('static verification accepts traceable alpha-equivalent extraction', () => {
  const { root } = createFixture(
    'export const filterPositive = (items) => items.filter((item) => item.quantity > 0);',
  );
  const result = verify(root, '--static');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = readReport(root, 'static');
  assert.equal(report.status, 'VERIFIED');
  assert.equal(report.gates.provenance.status, 'PASS');
  assert.equal(report.gates.semantic.status, 'PASS');
  assert.equal(report.gates.classification.counts.SYNTHETIC_BUSINESS, 0);
});

test('semantic gate rejects an invented sort operation', () => {
  const { root } = createFixture(
    'export const filterPositive = (items) => items.filter((item) => item.quantity > 0).sort((left, right) => left.quantity - right.quantity);',
  );
  const result = verify(root, '--static');
  assert.notEqual(result.status, 0);
  const report = readReport(root, 'static');
  assert.equal(report.gates.semantic.status, 'FAIL');
  assert.equal(report.gates.semantic.failures[0].code, 'EXACT_ALPHA_MISMATCH');
});

test('provenance gate rejects synthetic business classification', () => {
  const { root } = createFixture(
    'export const filterPositive = (items) => items.filter((item) => item.quantity > 0);',
    'SYNTHETIC_BUSINESS',
  );
  const result = verify(root, '--static');
  assert.notEqual(result.status, 0);
  const report = readReport(root, 'static');
  assert.equal(report.gates.provenance.status, 'FAIL');
  assert.equal(report.gates.classification.counts.SYNTHETIC_BUSINESS, 1);
});

test('provenance gate rejects mutation of immutable production source', () => {
  const { root, sourcePath } = createFixture(
    'export const filterPositive = (items) => items.filter((item) => item.quantity > 0);',
  );
  fs.appendFileSync(path.join(root, sourcePath), '\n// mutation');
  const result = verify(root, '--static');
  assert.notEqual(result.status, 0);
  const report = readReport(root, 'static');
  assert.equal(report.gates.provenance.status, 'FAIL');
  assert.ok(report.gates.provenance.errors.some((error) => error.code === 'BASELINE_MUTATED'));
});

test('full verification refuses L7 without independent behavior evidence', () => {
  const { root } = createFixture(
    'export const filterPositive = (items) => items.filter((item) => item.quantity > 0);',
  );
  const result = verify(root);
  assert.notEqual(result.status, 0);
  const report = readReport(root, 'full');
  assert.equal(report.status, 'REJECTED');
  assert.equal(report.gates.behavior.failures[0].code, 'BEHAVIOR_EVIDENCE_MISSING');
});
