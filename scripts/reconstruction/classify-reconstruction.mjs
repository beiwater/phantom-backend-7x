import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectTopLevelExecutableNames,
  parseCliSlice,
  parseCode,
  readJson,
  relativeToRoot,
  resolveFromRoot,
  walkCodeFiles,
} from './lib.mjs';

const classes = [
  'RECOVERED',
  'INFERRED',
  'SYNTHETIC_GLUE',
  'SYNTHETIC_BUSINESS',
  'UNKNOWN',
];

export function classifyReconstruction(slice) {
  const sliceDir = resolveFromRoot(`reconstruction/${slice}`);
  const provenancePath = path.join(sliceDir, 'provenance.json');
  const provenance = fs.existsSync(provenancePath)
    ? readJson(provenancePath)
    : { artifacts: [] };

  const declared = new Map();
  for (const artifact of provenance.artifacts || []) {
    for (const symbol of artifact.symbols || []) {
      declared.set(`${artifact.file}:${symbol.recoveredSymbol}`, symbol);
    }
  }

  const symbols = [];
  for (const filePath of walkCodeFiles(sliceDir)) {
    const file = relativeToRoot(filePath);
    const ast = parseCode(fs.readFileSync(filePath, 'utf8'), file);
    for (const recoveredSymbol of collectTopLevelExecutableNames(ast)) {
      const declaration = declared.get(`${file}:${recoveredSymbol}`);
      symbols.push({
        file,
        recoveredSymbol,
        originalSymbol: declaration?.originalSymbol || null,
        classification: declaration?.classification || 'UNKNOWN',
        confidence: declaration?.confidence ?? null,
      });
    }
  }

  const counts = Object.fromEntries(classes.map((classification) => [classification, 0]));
  for (const symbol of symbols) counts[symbol.classification] = (counts[symbol.classification] || 0) + 1;

  const total = symbols.length;
  const traceable = counts.RECOVERED + counts.INFERRED;
  const reconstructionPurity = total === 0 ? 0 : traceable / total;
  const businessDenominator = total - counts.SYNTHETIC_GLUE;
  const businessPurity = businessDenominator === 0
    ? 0
    : (businessDenominator - counts.SYNTHETIC_BUSINESS - counts.UNKNOWN) / businessDenominator;

  return {
    slice,
    status: counts.SYNTHETIC_BUSINESS === 0 && counts.UNKNOWN === 0 && total > 0 ? 'PASS' : 'FAIL',
    counts,
    denominators: {
      totalExecutableSymbols: total,
      businessSymbols: businessDenominator,
    },
    reconstructionPurity,
    businessPurity,
    symbols,
  };
}

function runCli() {
  const slice = parseCliSlice();
  const report = classifyReconstruction(slice);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
