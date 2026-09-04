import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSemanticFingerprint,
  canonicalizeAst,
  diffFingerprints,
  findBindingNode,
  parseCliSlice,
  parseCode,
  readJson,
  resolveFromRoot,
  sha256,
  stableJson,
} from './lib.mjs';

function addFailure(failures, code, message, context = {}) {
  failures.push({ code, message, ...context });
}

export function compareSliceSemantics(slice) {
  const provenancePath = resolveFromRoot(`reconstruction/${slice}/provenance.json`);
  const failures = [];
  if (!fs.existsSync(provenancePath)) {
    addFailure(failures, 'PROVENANCE_MISSING', `Missing reconstruction/${slice}/provenance.json`);
    return { gate: 'semantic', slice, status: 'FAIL', comparisons: [], failures };
  }

  let provenance;
  try {
    provenance = readJson(provenancePath);
  } catch (error) {
    addFailure(failures, 'PROVENANCE_INVALID', error.message);
    return { gate: 'semantic', slice, status: 'FAIL', comparisons: [], failures };
  }

  let sourceText;
  let sourceAst;
  try {
    const sourcePath = resolveFromRoot(provenance.source.path);
    sourceText = fs.readFileSync(sourcePath, 'utf8');
    if (sha256(sourceText) !== provenance.source.sha256) {
      addFailure(failures, 'SOURCE_HASH_MISMATCH', 'Source bundle hash differs from provenance');
      return { gate: 'semantic', slice, status: 'FAIL', comparisons: [], failures };
    }

    // The immutable vendor file contains one historically malformed token.
    // The running server applies this exact repair before serving it; analyze
    // that served byte stream while keeping the raw source hash authoritative.
    let sourceForAnalysis = sourceText;
    if (provenance.source.path === 'frontend-original/static/bundle/assets/index-cgzgptQ8.js') {
      const needle = ']})};var NSi=';
      const replacement = ']})})};var NSi=';
      const occurrences = sourceText.split(needle).length - 1;
      if (occurrences > 0) {
        if (occurrences !== 1) {
          throw new Error(`Unexpected frontend syntax repair count: ${occurrences}`);
        }
        sourceForAnalysis = sourceText.replace(needle, replacement);
      }
    }
    sourceAst = parseCode(sourceForAnalysis, provenance.source.path);
  } catch (error) {
    addFailure(failures, 'SOURCE_PARSE_FAILED', error.message);
    return { gate: 'semantic', slice, status: 'FAIL', comparisons: [], failures };
  }

  const targetCache = new Map();
  const comparisons = [];
  for (const artifact of provenance.artifacts || []) {
    let targetAst;
    try {
      const targetPath = resolveFromRoot(artifact.file);
      if (!targetCache.has(targetPath)) {
        targetCache.set(targetPath, parseCode(fs.readFileSync(targetPath, 'utf8'), artifact.file));
      }
      targetAst = targetCache.get(targetPath);
    } catch (error) {
      addFailure(failures, 'TARGET_PARSE_FAILED', error.message, { file: artifact.file });
      continue;
    }

    for (const symbol of artifact.symbols || []) {
      const context = {
        file: artifact.file,
        recoveredSymbol: symbol.recoveredSymbol,
        originalSymbol: symbol.originalSymbol,
      };
      if (symbol.classification === 'SYNTHETIC_GLUE') {
        comparisons.push({ ...context, mode: 'NOT_APPLICABLE', status: 'SKIP', reason: symbol.rationale });
        continue;
      }
      if (symbol.classification === 'SYNTHETIC_BUSINESS' || symbol.classification === 'UNKNOWN') {
        addFailure(failures, 'BLOCKING_CLASSIFICATION', 'Semantic comparison cannot approve synthetic business or unknown logic', {
          ...context,
          classification: symbol.classification,
        });
        comparisons.push({ ...context, mode: symbol.semantic?.mode, status: 'FAIL' });
        continue;
      }

      const sourceNode = findBindingNode(sourceAst, symbol.originalSymbol);
      const targetNode = findBindingNode(targetAst, symbol.recoveredSymbol);
      if (!sourceNode) {
        addFailure(failures, 'SOURCE_SYMBOL_NOT_FOUND', 'Original binding was not found in production AST', context);
        comparisons.push({ ...context, mode: symbol.semantic?.mode, status: 'FAIL' });
        continue;
      }
      if (!targetNode) {
        addFailure(failures, 'TARGET_SYMBOL_NOT_FOUND', 'Recovered binding was not found in artifact AST', context);
        comparisons.push({ ...context, mode: symbol.semantic?.mode, status: 'FAIL' });
        continue;
      }

      const aliases = symbol.semantic?.aliases || {};
      const mode = symbol.semantic?.mode;
      if (mode === 'EXACT_ALPHA') {
        const sourceCanonical = stableJson(canonicalizeAst(sourceNode, aliases));
        const targetCanonical = stableJson(canonicalizeAst(targetNode));
        const sourceHash = sha256(sourceCanonical);
        const targetHash = sha256(targetCanonical);
        const status = sourceHash === targetHash ? 'PASS' : 'FAIL';
        comparisons.push({ ...context, mode, status, sourceHash, targetHash });
        if (status === 'FAIL') {
          addFailure(failures, 'EXACT_ALPHA_MISMATCH', 'Canonical AST differs after identifier normalization', {
            ...context,
            sourceHash,
            targetHash,
          });
        }
      } else if (mode === 'STRUCTURAL') {
        const sourceFingerprint = buildSemanticFingerprint(sourceNode, aliases);
        const targetFingerprint = buildSemanticFingerprint(targetNode);
        const differences = diffFingerprints(sourceFingerprint, targetFingerprint);
        const status = differences.length === 0 ? 'PASS' : 'FAIL';
        comparisons.push({
          ...context,
          mode,
          status,
          sourceFingerprintHash: sha256(stableJson(sourceFingerprint)),
          targetFingerprintHash: sha256(stableJson(targetFingerprint)),
          differences,
        });
        if (status === 'FAIL') {
          addFailure(failures, 'STRUCTURAL_MISMATCH', 'Calls, branches, operators, returns, or dispatch order differ', {
            ...context,
            differences,
          });
        }
      } else {
        addFailure(failures, 'SEMANTIC_MODE_INVALID', 'semantic.mode must be EXACT_ALPHA or STRUCTURAL', context);
        comparisons.push({ ...context, mode, status: 'FAIL' });
      }
    }
  }

  const compared = comparisons.filter((item) => item.status !== 'SKIP');
  const passed = compared.filter((item) => item.status === 'PASS').length;
  return {
    gate: 'semantic',
    slice,
    status: failures.length === 0 && compared.length > 0 ? 'PASS' : 'FAIL',
    denominator: compared.length,
    passed,
    comparisons,
    failures,
  };
}

function runCli() {
  const slice = parseCliSlice();
  const report = compareSliceSemantics(slice);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
