import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blockingClassifications,
  collectTopLevelExecutableNames,
  parseCliSlice,
  parseCode,
  readJson,
  relativeToRoot,
  resolveFromRoot,
  sha256,
  walkCodeFiles,
} from './lib.mjs';

const validClassifications = new Set([
  'RECOVERED',
  'INFERRED',
  'SYNTHETIC_GLUE',
  'SYNTHETIC_BUSINESS',
  'UNKNOWN',
]);
const validSemanticModes = new Set(['EXACT_ALPHA', 'STRUCTURAL']);

function addError(errors, code, message, context = {}) {
  errors.push({ code, message, ...context });
}

function auditBaseline(errors) {
  const manifestPath = resolveFromRoot('reconstruction-report/baseline-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    addError(errors, 'BASELINE_MANIFEST_MISSING', 'Missing reconstruction-report/baseline-manifest.json');
    return null;
  }

  const manifest = readJson(manifestPath);
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) {
    addError(errors, 'BASELINE_MANIFEST_INVALID', 'Baseline manifest must use schemaVersion 1 and contain files[]');
    return manifest;
  }

  for (const entry of manifest.files) {
    let filePath;
    try {
      filePath = resolveFromRoot(entry.path);
    } catch (error) {
      addError(errors, 'BASELINE_PATH_INVALID', error.message, { path: entry.path });
      continue;
    }
    if (!fs.existsSync(filePath)) {
      addError(errors, 'BASELINE_FILE_MISSING', 'Immutable baseline file is missing', { path: entry.path });
      continue;
    }
    const actualHash = sha256(fs.readFileSync(filePath));
    if (actualHash !== entry.sha256) {
      addError(errors, 'BASELINE_MUTATED', 'Immutable production source differs from the frozen hash', {
        path: entry.path,
        expectedSha256: entry.sha256,
        actualSha256: actualHash,
      });
    }
  }
  return manifest;
}

function validateManifestShape(manifest, slice, errors) {
  if (manifest.schemaVersion !== 1) {
    addError(errors, 'PROVENANCE_SCHEMA_VERSION', 'provenance.json must use schemaVersion 1');
  }
  if (manifest.slice !== slice) {
    addError(errors, 'PROVENANCE_SLICE_MISMATCH', 'provenance.json slice does not match requested slice', {
      expected: slice,
      actual: manifest.slice,
    });
  }
  if (!manifest.source || typeof manifest.source.path !== 'string' || typeof manifest.source.sha256 !== 'string') {
    addError(errors, 'PROVENANCE_SOURCE_INVALID', 'provenance.json source must contain path and sha256');
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    addError(errors, 'PROVENANCE_ARTIFACTS_EMPTY', 'provenance.json must contain at least one artifact');
  }
}

export function auditProvenance(slice) {
  const errors = [];
  const warnings = [];
  const baseline = auditBaseline(errors);
  const sliceDir = resolveFromRoot(`reconstruction/${slice}`);
  const provenancePath = path.join(sliceDir, 'provenance.json');

  if (!fs.existsSync(provenancePath)) {
    addError(errors, 'PROVENANCE_MISSING', `Missing reconstruction/${slice}/provenance.json`);
    return { gate: 'provenance', slice, status: 'FAIL', errors, warnings, symbols: [] };
  }

  let manifest;
  try {
    manifest = readJson(provenancePath);
  } catch (error) {
    addError(errors, 'PROVENANCE_JSON_INVALID', error.message);
    return { gate: 'provenance', slice, status: 'FAIL', errors, warnings, symbols: [] };
  }
  validateManifestShape(manifest, slice, errors);

  let sourceText = '';
  if (manifest.source?.path) {
    try {
      const sourcePath = resolveFromRoot(manifest.source.path);
      if (!fs.existsSync(sourcePath)) {
        addError(errors, 'SOURCE_FILE_MISSING', 'Provenance source file does not exist', { path: manifest.source.path });
      } else {
        sourceText = fs.readFileSync(sourcePath, 'utf8');
        const actualHash = sha256(sourceText);
        if (actualHash !== manifest.source.sha256) {
          addError(errors, 'SOURCE_HASH_MISMATCH', 'Provenance source hash does not match source file', {
            expectedSha256: manifest.source.sha256,
            actualSha256: actualHash,
          });
        }
        const baselineEntry = baseline?.files?.find((entry) => entry.path === manifest.source.path);
        if (!baselineEntry || baselineEntry.sha256 !== manifest.source.sha256) {
          addError(errors, 'SOURCE_NOT_FROZEN_BASELINE', 'Provenance source is not the frozen production baseline', {
            path: manifest.source.path,
          });
        }
      }
    } catch (error) {
      addError(errors, 'SOURCE_PATH_INVALID', error.message, { path: manifest.source.path });
    }
  }

  const codeFiles = walkCodeFiles(sliceDir).map(relativeToRoot);
  const declaredArtifacts = new Map();
  for (const artifact of manifest.artifacts || []) {
    if (!artifact || typeof artifact.file !== 'string' || !Array.isArray(artifact.symbols)) {
      addError(errors, 'ARTIFACT_INVALID', 'Each artifact requires file and symbols[]');
      continue;
    }
    if (declaredArtifacts.has(artifact.file)) {
      addError(errors, 'ARTIFACT_DUPLICATE', 'Artifact is listed more than once', { file: artifact.file });
      continue;
    }
    declaredArtifacts.set(artifact.file, artifact);
  }

  for (const file of codeFiles) {
    if (!declaredArtifacts.has(file)) {
      addError(errors, 'CODE_FILE_UNDECLARED', 'Code file has no provenance artifact entry', { file });
    }
  }
  for (const file of declaredArtifacts.keys()) {
    if (!codeFiles.includes(file)) {
      addError(errors, 'ARTIFACT_FILE_MISSING', 'Provenance artifact does not resolve to a slice code file', { file });
    }
  }

  const symbols = [];
  for (const [file, artifact] of declaredArtifacts.entries()) {
    let targetPath;
    try {
      targetPath = resolveFromRoot(file);
    } catch (error) {
      addError(errors, 'ARTIFACT_PATH_INVALID', error.message, { file });
      continue;
    }
    if (!fs.existsSync(targetPath)) continue;

    let executableNames = [];
    try {
      const targetSource = fs.readFileSync(targetPath, 'utf8');
      executableNames = collectTopLevelExecutableNames(parseCode(targetSource, file));
    } catch (error) {
      addError(errors, 'ARTIFACT_PARSE_FAILED', error.message, { file });
      continue;
    }

    const seenRecoveredSymbols = new Set();
    for (const symbol of artifact.symbols) {
      const context = { file, recoveredSymbol: symbol?.recoveredSymbol };
      if (!symbol || typeof symbol.recoveredSymbol !== 'string' || typeof symbol.originalSymbol !== 'string') {
        addError(errors, 'SYMBOL_IDENTITY_INVALID', 'Symbol entry requires recoveredSymbol and originalSymbol', context);
        continue;
      }
      if (seenRecoveredSymbols.has(symbol.recoveredSymbol)) {
        addError(errors, 'SYMBOL_DUPLICATE', 'Recovered symbol appears more than once in an artifact', context);
      }
      seenRecoveredSymbols.add(symbol.recoveredSymbol);

      if (!executableNames.includes(symbol.recoveredSymbol)) {
        addError(errors, 'RECOVERED_SYMBOL_NOT_FOUND', 'Recovered top-level executable symbol is absent from artifact', context);
      }
      if (!validClassifications.has(symbol.classification)) {
        addError(errors, 'CLASSIFICATION_INVALID', 'Unknown reconstruction classification', {
          ...context,
          classification: symbol.classification,
        });
      }
      if (blockingClassifications.has(symbol.classification)) {
        addError(errors, 'BLOCKING_CLASSIFICATION', 'Synthetic business logic and unknown logic are forbidden', {
          ...context,
          classification: symbol.classification,
        });
      }
      if (symbol.classification === 'SYNTHETIC_GLUE' && (!symbol.rationale || !symbol.rationale.trim())) {
        addError(errors, 'SYNTHETIC_GLUE_RATIONALE_MISSING', 'Synthetic glue requires a precise non-business rationale', context);
      }
      if ((symbol.classification === 'RECOVERED' || symbol.classification === 'INFERRED') && (!(symbol.confidence >= 0.9) || symbol.confidence > 1)) {
        addError(errors, 'CONFIDENCE_TOO_LOW', 'Recovered/inferred code requires confidence between 0.90 and 1.00', {
          ...context,
          confidence: symbol.confidence,
        });
      }
      if (!Array.isArray(symbol.evidence) || symbol.evidence.length === 0 || symbol.evidence.some((item) => typeof item !== 'string' || !item.trim())) {
        addError(errors, 'EVIDENCE_MISSING', 'Every reconstructed symbol requires non-empty evidence[]', context);
      }
      if (!symbol.semantic || !validSemanticModes.has(symbol.semantic.mode)) {
        addError(errors, 'SEMANTIC_MODE_INVALID', 'Every reconstructed symbol requires semantic.mode EXACT_ALPHA or STRUCTURAL', context);
      }

      if (!Array.isArray(symbol.bundleRange) || symbol.bundleRange.length !== 2) {
        addError(errors, 'BUNDLE_RANGE_INVALID', 'bundleRange must be [start, end]', context);
      } else {
        const [start, end] = symbol.bundleRange;
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > sourceText.length) {
          addError(errors, 'BUNDLE_RANGE_OUT_OF_BOUNDS', 'bundleRange is outside the immutable source bundle', {
            ...context,
            bundleRange: symbol.bundleRange,
            sourceLength: sourceText.length,
          });
        } else {
          const segment = sourceText.slice(start, end);
          if (!segment.includes(symbol.originalSymbol)) {
            addError(errors, 'ORIGINAL_SYMBOL_NOT_IN_RANGE', 'originalSymbol is not present inside bundleRange', {
              ...context,
              originalSymbol: symbol.originalSymbol,
              bundleRange: symbol.bundleRange,
            });
          }
        }
      }
      symbols.push({ ...context, classification: symbol.classification });
    }

    for (const executableName of executableNames) {
      if (!seenRecoveredSymbols.has(executableName)) {
        addError(errors, 'EXECUTABLE_WITHOUT_PROVENANCE', 'Top-level function/class/arrow has no symbol provenance', {
          file,
          recoveredSymbol: executableName,
        });
      }
    }
  }

  return {
    gate: 'provenance',
    slice,
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    source: manifest.source,
    codeFiles,
    symbols,
    errors,
    warnings,
  };
}

function runCli() {
  const slice = parseCliSlice();
  const report = auditProvenance(slice);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
