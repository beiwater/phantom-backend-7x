import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = process.env.RECONSTRUCTION_ROOT
  ? path.resolve(process.env.RECONSTRUCTION_ROOT)
  : path.resolve(scriptDir, '../..');

export const blockingClassifications = new Set([
  'SYNTHETIC_BUSINESS',
  'UNKNOWN',
]);

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function relativeToRoot(filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

export function resolveFromRoot(filePath) {
  const resolved = path.resolve(rootDir, filePath);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes repository root: ${filePath}`);
  }
  return resolved;
}

export function walkCodeFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  const result = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(child);
      } else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
        result.push(child);
      }
    }
  }
  return result.sort();
}

export function parseCode(source, sourceFilename) {
  return parse(source, {
    sourceType: 'unambiguous',
    sourceFilename,
    errorRecovery: false,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    plugins: [
      'jsx',
      'typescript',
      'classProperties',
      'classPrivateProperties',
      'classPrivateMethods',
      'decorators-legacy',
      'dynamicImport',
      'importMeta',
      'optionalCatchBinding',
      'topLevelAwait',
    ],
  });
}

function executableNamesFromDeclaration(declaration) {
  if (!declaration) return [];
  if ((declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') && declaration.id) {
    return [declaration.id.name];
  }
  if (declaration.type !== 'VariableDeclaration') return [];

  return declaration.declarations.flatMap((item) => {
    if (item.id.type !== 'Identifier' || !item.init) return [];
    if (!['ArrowFunctionExpression', 'FunctionExpression', 'ClassExpression'].includes(item.init.type)) return [];
    return [item.id.name];
  });
}

export function collectTopLevelExecutableNames(ast) {
  const names = [];
  for (const statement of ast.program.body) {
    if (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') {
      names.push(...executableNamesFromDeclaration(statement.declaration));
    } else {
      names.push(...executableNamesFromDeclaration(statement));
    }
  }
  return [...new Set(names)].sort();
}

function visit(node, callback, parent = null, key = null) {
  if (!node || typeof node !== 'object') return;
  callback(node, parent, key);
  for (const [childKey, value] of Object.entries(node)) {
    if (childKey === 'loc' || childKey === 'start' || childKey === 'end' || childKey === 'extra' || childKey === 'comments') continue;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, callback, node, childKey);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      visit(value, callback, node, childKey);
    }
  }
}

export function findBindingNode(ast, symbol) {
  let result = null;
  visit(ast.program, (node) => {
    if (result) return;
    if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id?.name === symbol) {
      result = node;
      return;
    }
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === symbol) {
      result = node.init;
    }
  });
  return result;
}

function memberPath(node, aliases) {
  if (!node) return null;
  if (node.type === 'Identifier') return aliases[node.name] || node.name;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'Super') return 'super';
  if (node.type === 'CallExpression') {
    const callee = memberPath(node.callee, aliases);
    return callee ? `${callee}()` : null;
  }
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const object = memberPath(node.object, aliases);
    let property = null;
    if (!node.computed && node.property.type === 'Identifier') property = aliases[node.property.name] || node.property.name;
    if (node.computed && (node.property.type === 'StringLiteral' || node.property.type === 'NumericLiteral')) property = String(node.property.value);
    if (object && property !== null) return `${object}.${property}`;
  }
  return null;
}

function expressionLabel(node, aliases) {
  if (!node) return null;
  const pathLabel = memberPath(node, aliases);
  if (pathLabel) return pathLabel;
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral' || node.type === 'BooleanLiteral') return JSON.stringify(node.value);
  if (node.type === 'NullLiteral') return 'null';
  if (node.type === 'ObjectExpression') {
    return `{${node.properties.map((property) => {
      if (property.type !== 'ObjectProperty' && property.type !== 'ObjectMethod') return property.type;
      if (property.key.type === 'Identifier') return property.key.name;
      if (property.key.type === 'StringLiteral' || property.key.type === 'NumericLiteral') return String(property.key.value);
      return property.key.type;
    }).join(',')}}`;
  }
  return node.type;
}

export function buildSemanticFingerprint(node, aliases = {}) {
  const rootType = node.type.includes('Function') || node.type === 'ArrowFunctionExpression'
    ? 'FUNCTION'
    : node.type.includes('Class') ? 'CLASS' : node.type;
  const fingerprint = {
    rootType,
    parameterCount: Array.isArray(node.params) ? node.params.length : null,
    calls: [],
    controlFlow: [],
    collectionOperations: [],
    operators: [],
    returns: [],
    throws: 0,
    dispatches: [],
  };

  visit(node, (current) => {
    if (current.type === 'CallExpression' || current.type === 'OptionalCallExpression') {
      const callee = memberPath(current.callee, aliases) || current.callee.type;
      fingerprint.calls.push({ callee, argumentCount: current.arguments.length });
      const method = callee.split('.').at(-1)?.replace(/\(\)$/, '');
      if (['filter', 'find', 'map', 'reduce', 'some', 'sort'].includes(method)) {
        fingerprint.collectionOperations.push(method);
      }
      if (callee === (aliases.dispatch || 'dispatch')) {
        fingerprint.dispatches.push(expressionLabel(current.arguments[0], aliases));
      }
    } else if (current.type === 'IfStatement') {
      fingerprint.controlFlow.push('if');
    } else if (current.type === 'ConditionalExpression') {
      fingerprint.controlFlow.push('conditional');
    } else if (current.type === 'LogicalExpression') {
      fingerprint.controlFlow.push(`logical:${current.operator}`);
    } else if (current.type === 'SwitchStatement') {
      fingerprint.controlFlow.push(`switch:${current.cases.length}`);
    } else if (current.type === 'TryStatement') {
      fingerprint.controlFlow.push('try');
    } else if (current.type === 'CatchClause') {
      fingerprint.controlFlow.push('catch');
    } else if (current.type === 'BinaryExpression' || current.type === 'UnaryExpression' || current.type === 'UpdateExpression' || current.type === 'AssignmentExpression') {
      fingerprint.operators.push(`${current.type}:${current.operator}`);
    } else if (current.type === 'ReturnStatement') {
      fingerprint.returns.push(expressionLabel(current.argument, aliases));
    } else if (current.type === 'ThrowStatement') {
      fingerprint.throws += 1;
    }
  });

  return fingerprint;
}

const ignoredCanonicalKeys = new Set([
  'loc',
  'start',
  'end',
  'extra',
  'leadingComments',
  'innerComments',
  'trailingComments',
  'typeAnnotation',
  'returnType',
  'typeParameters',
  'typeArguments',
  'optional',
  'declare',
]);

export function canonicalizeAst(node, aliases = {}) {
  const localNames = new Map();
  let nextLocal = 0;

  function localName(name) {
    if (!localNames.has(name)) localNames.set(name, `local${nextLocal++}`);
    return localNames.get(name);
  }

  function normalize(value, parent = null, key = null) {
    if (Array.isArray(value)) return value.map((entry) => normalize(entry, parent, key));
    if (!value || typeof value !== 'object') return value;

    if (value.type === 'Identifier') {
      const propertyPosition = parent && (
        ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && key === 'property' && !parent.computed) ||
        ((parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') && key === 'key' && !parent.computed)
      );
      if (propertyPosition) return { type: 'Identifier', name: aliases[value.name] || value.name };
      if (aliases[value.name]) return { type: 'Identifier', name: aliases[value.name] };
      return { type: 'Identifier', name: localName(value.name) };
    }

    const result = {};
    for (const [childKey, child] of Object.entries(value)) {
      if (ignoredCanonicalKeys.has(childKey)) continue;
      if (childKey === 'name' && value.type !== 'Identifier') continue;
      result[childKey] = normalize(child, value, childKey);
    }
    return result;
  }

  return normalize(node);
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function diffFingerprints(source, target) {
  const fields = ['rootType', 'parameterCount', 'calls', 'controlFlow', 'collectionOperations', 'operators', 'returns', 'throws', 'dispatches'];
  return fields.flatMap((field) => {
    const left = stableJson(source[field]);
    const right = stableJson(target[field]);
    return left === right ? [] : [{ field, source: source[field], target: target[field] }];
  });
}

export function parseCliSlice() {
  const slice = process.argv[2];
  if (!slice || !/^[a-z][a-z0-9-]*$/.test(slice)) {
    throw new Error('Usage: <script> <slice-name>');
  }
  return slice;
}
