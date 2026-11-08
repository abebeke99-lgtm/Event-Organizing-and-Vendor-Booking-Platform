import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = resolve(backendDirectory, 'src');
const outputPath = resolve(backendDirectory, '..', 'docs', 'POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv');
const mysqlPatterns = [
  ['question-mark placeholders', /\?/],
  ['ON DUPLICATE KEY UPDATE', /ON\s+DUPLICATE\s+KEY\s+UPDATE/i],
  ['INSERT IGNORE', /INSERT\s+IGNORE/i],
  ['VALUES(column)', /\bVALUES\s*\(\s*[a-z_]\w*\s*\)/i],
  ['GROUP_CONCAT', /\bGROUP_CONCAT\s*\(/i],
  ['DATE_FORMAT', /\bDATE_FORMAT\s*\(/i],
  ['MySQL date functions', /\b(?:CURDATE|DATE_ADD|DATE_SUB|WEEKDAY|LAST_DAY)\s*\(/i],
  ['IFNULL', /\bIFNULL\s*\(/i],
  ['LAST_INSERT_ID', /\bLAST_INSERT_ID\s*\(/i],
  ['CONCAT_WS', /\bCONCAT_WS\s*\(/i],
  ['MySQL interval syntax', /\bINTERVAL\s+\d+\s+(?:SECOND|MINUTE|HOUR|DAY|MONTH|YEAR)\b/i],
];

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listJavaScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
  }
  return files;
}

function nodeFunctionName(node, parentKey) {
  if (node.id?.name) return node.id.name;
  if (parentKey) return parentKey;
  return '<anonymous>';
}

function csv(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function inspectCallsites(ast, filePath, testFiles) {
  const rows = [];
  function visit(node, scope = '<module>', parentKey = '') {
    if (!node || typeof node !== 'object') return;
    let currentScope = scope;
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression'
      || node.type === 'ArrowFunctionExpression' || node.type === 'ObjectMethod'
      || node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod') {
      currentScope = nodeFunctionName(node, parentKey) || scope;
    }

    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
      const property = node.callee.computed ? node.callee.property?.value : node.callee.property?.name;
      if (property === 'execute' || property === 'query') {
        const argument = node.arguments[0];
        let sql = '';
        if (argument?.type === 'StringLiteral') sql = argument.value;
        if (argument?.type === 'TemplateLiteral') {
          sql = argument.quasis.map((part) => part.value.cooked || '').join(' <dynamic> ');
        }
        const markers = mysqlPatterns
          .filter(([, pattern]) => pattern.test(sql))
          .map(([label]) => label);
        const isPostgresInfrastructure = /(?:^|[\\/])(?:postgresAdapter|postgresDb|postgresPool|postgresMigrate|postgresSchema)\.js$/i
          .test(filePath);
        const neighboringTests = [...testFiles].filter((testFile) => {
          const base = relative(resolve(backendDirectory, 'test'), testFile).toLowerCase();
          const sourceBase = filePath.split(/[\\/]/).at(-1).replace(/\.js$/i, '').toLowerCase();
          return base.startsWith(`${sourceBase}.`) || base.includes(sourceBase);
        }).map((testFile) => relative(resolve(backendDirectory, '..'), testFile).replaceAll('\\', '/'));
        rows.push({
          path: relative(resolve(backendDirectory, '..'), filePath).replaceAll('\\', '/'),
          functionName: currentScope,
          line: node.loc?.start.line ?? 0,
          method: property,
          markers: markers.join('; ') || 'No MySQL-only syntax detected in static SQL text',
          conversionStatus: isPostgresInfrastructure
            ? 'PostgreSQL infrastructure; not an application query'
            : property === 'execute'
              ? 'Not converted; execute/result handling requires MySQL semantics'
              : markers.length
                ? 'Not converted; MySQL-specific SQL detected'
                : 'Not certified; inspect SQL, parameters, and result handling',
          testCoverage: neighboringTests.join('; ') || 'No filename-matched test found; query behavior unverified',
        });
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key === 'comments'
        || key === 'tokens' || key === 'errors') continue;
      if (Array.isArray(value)) {
        for (const child of value) {
          visit(child, currentScope, child?.key?.name || child?.key?.value || '');
        }
      } else if (value && typeof value === 'object') {
        const memberName = node.type === 'VariableDeclarator' && key === 'init'
          ? node.id?.name
          : node.type === 'ObjectProperty' && key === 'value'
            ? node.key?.name || node.key?.value
            : value.key?.name || value.key?.value;
        visit(value, currentScope, memberName || '');
      }
    }
  }
  visit(ast);
  return rows;
}

const sourceFiles = await listJavaScriptFiles(sourceDirectory);
const testFiles = await listJavaScriptFiles(resolve(backendDirectory, 'test')).catch(() => []);
const rows = [];
for (const filePath of sourceFiles.sort()) {
  const source = await readFile(filePath, 'utf8');
  const ast = parse(source, { sourceType: 'unambiguous', plugins: ['jsx'] });
  rows.push(...inspectCallsites(ast, filePath, testFiles));
}

const columns = ['File path', 'Function', 'Line', 'Method', 'MySQL-specific syntax', 'PostgreSQL conversion status', 'Test coverage'];
const output = [
  columns.map(csv).join(','),
  ...rows.map((row) => [
    row.path, row.functionName, row.line, row.method, row.markers, row.conversionStatus, row.testCoverage,
  ].map(csv).join(',')),
].join('\n');
await writeFile(outputPath, `${output}\n`, 'utf8');
console.log(`Query inventory written: ${relative(resolve(backendDirectory, '..'), outputPath).replaceAll('\\', '/')}`);
console.log(`Source JavaScript files scanned: ${sourceFiles.length}`);
console.log(`Database query/execute call sites inventoried: ${rows.length}`);
console.log(`PostgreSQL infrastructure call sites: ${rows.filter((row) => row.conversionStatus.startsWith('PostgreSQL infrastructure')).length}`);
console.log(`Application call sites not converted or certified: ${rows.filter((row) => !row.conversionStatus.startsWith('PostgreSQL infrastructure')).length}`);
