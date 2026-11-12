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
const neonVerifiedCallsites = new Map([
  ['backend/src/routes/postgresAuth.js:39:10', 'PostgreSQL auth API query adapter; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresAuth.js:50:9', 'PostgreSQL auth audit insert; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresAuth.js:60:9', 'PostgreSQL auth session insert; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresAuth.js:71:25', 'PostgreSQL registration notification setting lookup; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresAuth.js:78:24', 'PostgreSQL admin recipient lookup; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresAuth.js:86:32', 'PostgreSQL registration notification insert; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresAuth.js:102:13', 'PostgreSQL notification history insert; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresAuth.js:170:28', 'PostgreSQL customer role lookup; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresAuth.js:180:32', 'PostgreSQL user insert with RETURNING; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresAuth.js:187:15', 'PostgreSQL user-role insert; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresAuth.js:270:15', 'PostgreSQL login timestamp update; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresAuth.js:273:17', 'PostgreSQL vendor profile ON CONFLICT insert; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresCustomerAccount.js:47:29', 'PostgreSQL customer profile update; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresCustomerAccount.js:52:13', 'PostgreSQL customer profile audit insert; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresCustomerAccount.js:90:31', 'PostgreSQL current-password row lock and lookup; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresCustomerAccount.js:98:15', 'PostgreSQL password update; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresCustomerAccount.js:102:15', 'PostgreSQL other-session invalidation; verified by backend/test/postgresAuthIntegration.test.js'],
  ['backend/src/routes/postgresCustomerAccount.js:106:15', 'PostgreSQL critical password-change audit insert; verified by backend/test/postgresAuthIntegration.test.js'],
]);

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
        const relativeFilePath = relative(resolve(backendDirectory, '..'), filePath).replaceAll('\\', '/');
        const line = node.loc?.start.line ?? 0;
        const column = (node.loc?.start.column ?? 0) + 1;
        const callSiteKey = `${relativeFilePath}:${line}:${column}`;
        const neonVerification = neonVerifiedCallsites.get(callSiteKey);
        const neighboringTests = [...testFiles].filter((testFile) => {
          const base = relative(resolve(backendDirectory, 'test'), testFile).toLowerCase();
          const sourceBase = filePath.split(/[\\/]/).at(-1).replace(/\.js$/i, '').toLowerCase();
          return base.startsWith(`${sourceBase}.`) || base.includes(sourceBase);
        }).map((testFile) => relative(resolve(backendDirectory, '..'), testFile).replaceAll('\\', '/'));
        const stage = isPostgresInfrastructure
          ? 'Inspected'
          : neonVerification
            ? 'Certified'
            : 'Not inspected';
        const dialect = isPostgresInfrastructure || /(?:^|\/)postgres[^/]*\.js$/i.test(relativeFilePath)
          ? 'PostgreSQL-specific source'
          : property === 'execute'
            ? 'MySQL execute interface'
            : 'Dual-dialect or unknown; requires review';
        rows.push({
          callSiteId: `${relativeFilePath}:L${line}:C${column}:${property}`,
          path: relative(resolve(backendDirectory, '..'), filePath).replaceAll('\\', '/'),
          functionName: currentScope,
          line,
          column,
          method: property,
          dialect,
          markers: markers.join('; ') || 'No MySQL-only syntax detected in static SQL text',
          stage,
          conversionStatus: isPostgresInfrastructure
            ? 'PostgreSQL infrastructure; not an application query'
            : neonVerification
              ? `PostgreSQL verified on isolated Neon; ${neonVerification}`
            : property === 'execute'
              ? 'Not converted; execute/result handling requires MySQL semantics'
              : markers.length
                ? 'Not converted; MySQL-specific SQL detected'
                : 'Not certified; inspect SQL, parameters, and result handling',
          postgresTestStatus: isPostgresInfrastructure
            ? 'Infrastructure; application-query certification not applicable'
            : neonVerification
                ? 'Neon integration tested'
                : 'No call-site-specific PostgreSQL test evidence recorded',
          neonVerification: neonVerification
            ? `Verified on isolated Neon; ${neonVerification}`
            : 'Not verified on Neon',
          remainingIssues: isPostgresInfrastructure
            ? 'Infrastructure verification is tracked by database configuration and adapter tests'
            : neonVerification
                ? 'Only behavior exercised by the linked integration is certified; other route paths remain outside this call-site record'
                : 'PostgreSQL compatibility, parameter/result semantics, and runtime behavior remain unverified',
          linkedTest: neonVerification ? 'backend/test/postgresAuthIntegration.test.js' : 'None',
          staticTestCandidates: neighboringTests.join('; ') || 'None',
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

const certifiedCallsiteKeys = new Set(rows
  .filter((row) => row.stage === 'Certified')
  .map((row) => `${row.path}:${row.line}:${row.column}`));
for (const callsiteKey of neonVerifiedCallsites.keys()) {
  if (!certifiedCallsiteKeys.has(callsiteKey)) {
    throw new Error(`Neon certification metadata does not match an inventoried source call site: ${callsiteKey}`);
  }
}
const callsiteIds = rows.map((row) => row.callSiteId);
if (new Set(callsiteIds).size !== callsiteIds.length) {
  throw new Error('Query inventory contains duplicate call-site identifiers.');
}

const columns = [
  'Call site ID',
  'File path',
  'Function',
  'Line',
  'Column',
  'Method',
  'Current dialect classification',
  'MySQL-specific syntax',
  'Migration stage',
  'PostgreSQL conversion status',
  'PostgreSQL test status',
  'Neon verification status',
  'Remaining issues',
  'Linked test',
  'Static test candidates (not evidence)',
];
const output = [
  columns.map(csv).join(','),
  ...rows.map((row) => [
    row.callSiteId,
    row.path,
    row.functionName,
    row.line,
    row.column,
    row.method,
    row.dialect,
    row.markers,
    row.stage,
    row.conversionStatus,
    row.postgresTestStatus,
    row.neonVerification,
    row.remainingIssues,
    row.linkedTest,
    row.staticTestCandidates,
  ].map(csv).join(',')),
].join('\n');
await writeFile(outputPath, `${output}\n`, 'utf8');
console.log(`Query inventory written: ${relative(resolve(backendDirectory, '..'), outputPath).replaceAll('\\', '/')}`);
console.log(`Source JavaScript files scanned: ${sourceFiles.length}`);
console.log(`Database query/execute call sites inventoried: ${rows.length}`);
const infrastructureCalls = rows.filter((row) => row.conversionStatus.startsWith('PostgreSQL infrastructure')).length;
const applicationRows = rows.filter((row) => !row.conversionStatus.startsWith('PostgreSQL infrastructure'));
const certifiedCalls = applicationRows.filter((row) => row.stage === 'Certified').length;
const inspectedApplicationCalls = applicationRows.filter((row) => row.stage === 'Inspected').length;
console.log(`PostgreSQL infrastructure call sites: ${infrastructureCalls}`);
console.log(`Application call sites not inspected semantically: ${applicationRows.length - certifiedCalls - inspectedApplicationCalls}`);
console.log(`Application call sites verified on isolated Neon: ${certifiedCalls}`);
console.log(`Application call sites not certified: ${applicationRows.length - certifiedCalls}`);
