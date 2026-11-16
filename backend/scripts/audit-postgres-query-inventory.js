import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = resolve(backendDirectory, 'src');
const outputPath = resolve(backendDirectory, '..', 'docs', 'POSTGRESQL_QUERY_CONVERSION_INVENTORY.csv');
const mysqlPatterns = [
  ['ON DUPLICATE KEY UPDATE', /ON\s+DUPLICATE\s+KEY\s+UPDATE/i],
  ['INSERT IGNORE', /INSERT\s+IGNORE/i],
  ['VALUES(column)', /\bVALUES\s*\(\s*[a-z_]\w*\s*\)/i],
  ['GROUP_CONCAT', /\bGROUP_CONCAT\s*\(/i],
  ['DATE_FORMAT', /\bDATE_FORMAT\s*\(/i],
  ['MySQL date functions', /\b(?:CURDATE|DATE_ADD|DATE_SUB|WEEKDAY|LAST_DAY)\s*\(/i],
  ['IFNULL', /\bIFNULL\s*\(/i],
  ['LAST_INSERT_ID', /\bLAST_INSERT_ID\s*\(/i],
  ['MySQL interval syntax', /\bINTERVAL\s+\d+\s+(?:SECOND|MINUTE|HOUR|DAY|MONTH|YEAR)\b/i],
];
const neonVerifiedCallsites = new Map([
  ['backend/src/app.js:146:13', {
    description: 'API health SELECT 1',
    test: 'backend/test/postgresContactIntegration.test.js',
  }],
  ['backend/src/routes/contact.js:76:14', {
    description: 'Contact settings lookup',
    test: 'backend/test/postgresContactIntegration.test.js',
  }],
  ['backend/src/routes/contact.js:188:11', {
    description: 'Persist public contact message',
    test: 'backend/test/postgresContactIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:81:10', {
    description: 'PostgreSQL auth API query adapter',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:92:9', {
    description: 'PostgreSQL auth audit insert',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:102:9', {
    description: 'PostgreSQL auth session insert',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:114:25', {
    description: 'PostgreSQL registration notification setting lookup',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:121:24', {
    description: 'PostgreSQL admin recipient lookup',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:129:32', {
    description: 'PostgreSQL registration notification insert',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:145:13', {
    description: 'PostgreSQL notification history insert',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:234:28', {
    description: 'PostgreSQL customer role lookup',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:245:32', {
    description: 'PostgreSQL user insert with RETURNING',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:252:15', {
    description: 'PostgreSQL user-role insert',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:383:33', {
    description: 'Password-reset account lookup',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:391:36', {
    description: 'Password-reset OTP cooldown lookup',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:397:19', {
    description: 'Password-reset OTP invalidation',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:406:19', {
    description: 'Password-reset session invalidation',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:415:19', {
    description: 'Legacy password-reset challenge invalidation',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:426:36', {
    description: 'Password-reset OTP insert with typed PostgreSQL parameter',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:485:33', {
    description: 'Password-reset OTP verification lookup',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:514:19', {
    description: 'Password-reset OTP consumption',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:516:19', {
    description: 'Password-reset session insert',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:545:33', {
    description: 'Password-reset session validation',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:566:19', {
    description: 'Password-reset password update',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:567:19', {
    description: 'Password-reset session invalidation after password change',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:571:19', {
    description: 'Password-reset OTP invalidation after password change',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:575:19', {
    description: 'Legacy password-reset challenge cleanup',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:576:19', {
    description: 'Legacy password-reset token cleanup',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:577:19', {
    description: 'Session invalidation after password reset',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:578:19', {
    description: 'Administrator-session invalidation after password reset',
    test: 'backend/test/postgresPasswordResetIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:654:15', {
    description: 'PostgreSQL login timestamp update',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresAuth.js:660:17', {
    description: 'PostgreSQL vendor profile ON CONFLICT insert',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresCustomerAccount.js:52:29', {
    description: 'PostgreSQL customer profile update',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresCustomerAccount.js:57:13', {
    description: 'PostgreSQL customer profile audit insert',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresCustomerAccount.js:95:31', {
    description: 'PostgreSQL current-password row lock and lookup',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresCustomerAccount.js:103:15', {
    description: 'PostgreSQL password update',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresCustomerAccount.js:107:15', {
    description: 'PostgreSQL other-session invalidation',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/routes/postgresCustomerAccount.js:111:15', {
    description: 'PostgreSQL critical password-change audit insert',
    test: 'backend/test/postgresAuthIntegration.test.js',
  }],
  ['backend/src/lib/postgresMarketplace.js:18:24', {
    description: 'Load active services for the requested vendor page',
    test: 'backend/test/vendorPublicApi.test.js',
  }],
  ['backend/src/lib/postgresMarketplace.js:50:5', {
    description: 'Hydrate public packages for paged vendor services',
    test: 'backend/test/vendorPublicApi.test.js',
  }],
  ['backend/src/lib/postgresMarketplace.js:63:5', {
    description: 'Hydrate media for paged vendor services',
    test: 'backend/test/vendorPublicApi.test.js',
  }],
  ['backend/src/lib/postgresMarketplace.js:69:5', {
    description: 'Hydrate availability for paged vendor services',
    test: 'backend/test/vendorPublicApi.test.js',
  }],
  ['backend/src/lib/postgresMarketplace.js:118:5', {
    description: 'Hydrate media for paged public vendors',
    test: 'backend/test/vendorPublicApi.test.js',
  }],
  ['backend/src/lib/postgresMarketplace.js:220:30', {
    description: 'Resolve a public vendor category filter',
    test: 'backend/test/vendorPublicApi.test.js',
  }],
  ['backend/src/lib/postgresMarketplace.js:268:24', {
    description: 'Filter, count, sort, and paginate vendors in PostgreSQL',
    test: 'backend/test/vendorPublicApi.test.js',
  }],
]);
const currentNeonVerifiedCallsites = new Map([
  ['backend/src/routes/postgresBookings.js:573:26', {
    description: 'Aggregate customer dashboard overview for the authenticated account',
    test: 'backend/test/postgresBookingsIntegration.test.js',
  }],
  ['backend/src/routes/postgresOrganizerPlanning.js:127:26', {
    description: 'Aggregate organizer dashboard overview for the authenticated account',
    test: 'backend/test/postgresBookingsIntegration.test.js',
  }],
  ['backend/src/routes/postgresAdmin.js:497:27', {
    description: 'Count administrator user results with combined search, status, role, and date filters',
    test: 'backend/test/postgresAdminIntegration.test.js',
  }],
  ['backend/src/routes/postgresAdmin.js:499:26', {
    description: 'Fetch the filtered and paginated administrator user roster',
    test: 'backend/test/postgresAdminIntegration.test.js',
  }],
  ['backend/src/routes/contact.js:78:14', {
    description: 'Read public contact settings from PostgreSQL',
    test: 'backend/test/postgresContactIntegration.test.js',
  }],
  ['backend/src/routes/contact.js:190:11', {
    description: 'Persist public contact submissions in PostgreSQL',
    test: 'backend/test/postgresContactIntegration.test.js',
  }],
  ['backend/src/routes/contact.js:448:11', {
    description: 'Write contact archive and deletion audit records transactionally',
    test: 'backend/test/postgresContactAdminIntegration.test.js',
  }],
  ['backend/src/routes/contact.js:487:31', {
    description: 'Count filtered administrator contact messages',
    test: 'backend/test/postgresContactAdminIntegration.test.js',
  }],
  ['backend/src/routes/contact.js:491:30', {
    description: 'List and paginate administrator contact messages',
    test: 'backend/test/postgresContactAdminIntegration.test.js',
  }],
  ['backend/src/routes/contact.js:524:33', {
    description: 'Read a contact message before applying an administrator reply',
    test: 'backend/test/postgresContactAdminIntegration.test.js',
  }],
  ['backend/src/routes/contact.js:534:27', {
    description: 'Update contact status and administrator reply',
    test: 'backend/test/postgresContactAdminIntegration.test.js',
  }],
  ['backend/src/routes/contact.js:572:26', {
    description: 'Update contact-message read state',
    test: 'backend/test/postgresContactAdminIntegration.test.js',
  }],
  ['backend/src/routes/contact.js:593:28', {
    description: 'Archive contact messages with an audit record in one transaction',
    test: 'backend/test/postgresContactAdminIntegration.test.js',
  }],
  ['backend/src/routes/contact.js:622:28', {
    description: 'Delete contact messages with an audit record in one transaction',
    test: 'backend/test/postgresContactAdminIntegration.test.js',
  }],
  ['backend/src/lib/profilePhoto.js:38:24', {
    description: 'Read the authenticated account photo through the shared avatar route',
    test: 'backend/test/postgresProfilePhotoIntegration.test.js',
  }],
  ['backend/src/lib/profilePhoto.js:65:9', {
    description: 'Delete the authenticated account photo through the shared avatar route',
    test: 'backend/test/postgresProfilePhotoIntegration.test.js',
  }],
  ['backend/src/routes/userAvatar.js:50:9', {
    description: 'Persist an uploaded avatar through the shared avatar route',
    test: 'backend/test/postgresProfilePhotoIntegration.test.js',
  }],
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

function getSqlOperation(sql) {
  return sql.match(/^\s*(SELECT|WITH|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i)?.[1]?.toUpperCase()
    || 'Dynamic or unclassified';
}

function getParameterBinding(argument, sql) {
  if (!argument) return 'No second argument detected; dynamic binding remains unverified';
  const markerKinds = [
    /\$\d+/.test(sql) ? '$n PostgreSQL placeholders' : null,
    sql.includes('?') ? '? compatibility placeholders' : null,
  ].filter(Boolean);
  const argumentKind = argument.type === 'ArrayExpression'
    ? 'literal parameter array'
    : argument.type === 'Identifier'
      ? `parameter variable ${argument.name}`
      : `argument expression ${argument.type}`;
  return `${argumentKind}${markerKinds.length ? `; ${markerKinds.join(', ')}` : '; placeholder form not statically detected'}`;
}

function inspectCallsites(ast, filePath, testFiles, source) {
  const rows = [];
  function visit(node, scope = '<module>', parentKey = '', enclosingFunction = null) {
    if (!node || typeof node !== 'object') return;
    let currentScope = scope;
    let currentFunction = enclosingFunction;
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression'
      || node.type === 'ArrowFunctionExpression' || node.type === 'ObjectMethod'
      || node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod') {
      currentScope = nodeFunctionName(node, parentKey) || scope;
      currentFunction = node;
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
        const hasCompatibilityPlaceholder = sql.includes('?') && Boolean(node.arguments[1]);
        const isPostgresInfrastructure = /(?:^|[\\/])(?:postgresAdapter|postgresDb|postgresPool|postgresMigrate|postgresSchema)\.js$/i
          .test(filePath);
        const relativeFilePath = relative(resolve(backendDirectory, '..'), filePath).replaceAll('\\', '/');
        const line = node.loc?.start.line ?? 0;
        const column = (node.loc?.start.column ?? 0) + 1;
        const callSiteKey = `${relativeFilePath}:${line}:${column}`;
        const neonVerification = currentNeonVerifiedCallsites.get(callSiteKey);
        const historicalNeonEvidence = neonVerifiedCallsites.get(callSiteKey);
        const neighboringTests = [...testFiles].filter((testFile) => {
          const base = relative(resolve(backendDirectory, 'test'), testFile).toLowerCase();
          const sourceBase = filePath.split(/[\\/]/).at(-1).replace(/\.js$/i, '').toLowerCase();
          return base.startsWith(`${sourceBase}.`) || base.includes(sourceBase);
        }).map((testFile) => relative(resolve(backendDirectory, '..'), testFile).replaceAll('\\', '/'));
        const status = isPostgresInfrastructure
          ? 'EXEMPT'
          : markers.length || hasCompatibilityPlaceholder
            ? 'NEEDS_FIX'
            : neonVerification
              ? 'CERTIFIED'
              : 'UNVERIFIED';
        const sqlOperation = getSqlOperation(sql);
        const functionSource = currentFunction
          ? source.slice(currentFunction.start, currentFunction.end)
          : '';
        const explicitTransaction = /^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)$/.test(sqlOperation);
        const transactionBehavior = explicitTransaction
          ? 'Explicit PostgreSQL transaction-control statement'
          : /\.inTransaction\s*\(|\binTransaction\s*\(/.test(functionSource)
            ? 'Transaction helper referenced in containing function; call-site participation requires review'
            : 'Not established statically; inspect caller and transaction boundaries';
        const paginationBehavior = /\b(?:LIMIT|OFFSET|FETCH\s+(?:FIRST|NEXT)|SEEK)\b/i.test(sql)
          ? 'Pagination clause present in static SQL'
          : 'No pagination clause visible in static SQL; dynamic pagination requires review';
        const joinBehavior = /\bJOIN\b/i.test(sql)
          ? `${[...sql.matchAll(/\bJOIN\b/ig)].length} join clause(s) visible in static SQL`
          : 'No join clause visible in static SQL';
        const errorHandling = /catch\s*(?:\(|\{)|\.catch\s*\(/.test(functionSource)
          ? 'Local catch handling exists; verify the query error is surfaced correctly'
          : 'No local catch found; propagation or caller handling requires review';
        const postgresCompatibility = isPostgresInfrastructure
          ? 'EXEMPT: PostgreSQL infrastructure call, not an application query'
          : status === 'NEEDS_FIX'
            ? 'NEEDS_FIX: incompatible MySQL SQL or question-mark compatibility binding detected'
            : status === 'CERTIFIED'
              ? `CERTIFIED by current isolated-Neon integration: ${neonVerification.description}`
              : 'UNVERIFIED: syntax alone is not certification; inspect runtime semantics and test evidence';
        const verificationResult = isPostgresInfrastructure
          ? 'EXEMPT: adapter, connection, migration, or schema infrastructure'
          : neonVerification
            ? `CERTIFIED: current isolated-Neon test ${neonVerification.test}`
            : historicalNeonEvidence
              ? `UNVERIFIED: historical Neon evidence only (${historicalNeonEvidence.test}); not rerun in this pass`
              : 'UNVERIFIED: no current query-specific isolated-Neon evidence';
        const secondArgument = node.arguments[1];
        const functionName = relativeFilePath === 'backend/src/routes/userAvatar.js'
          && currentScope === '<anonymous>'
          ? 'POST /api/users/me/avatar'
          : currentScope;
        rows.push({
          callSiteId: `${relativeFilePath}:L${line}:C${column}:${property}`,
          path: relative(resolve(backendDirectory, '..'), filePath).replaceAll('\\', '/'),
          functionName,
          line,
          column,
          method: property,
          sqlOperation,
          parameterBinding: getParameterBinding(secondArgument, sql),
          transactionBehavior,
          paginationBehavior,
          joinBehavior,
          postgresCompatibility,
          errorHandling,
          status,
          relevantTestFiles: [
            ...(neonVerification ? [neonVerification.test] : []),
            ...(historicalNeonEvidence && !neonVerification
              ? [`Historical evidence only: ${historicalNeonEvidence.test}`]
              : []),
            ...neighboringTests
              .filter((test) => test !== neonVerification?.test && test !== historicalNeonEvidence?.test)
              .map((test) => `Candidate only: ${test}`),
          ].join('; ') || 'None identified',
          verificationResult,
          mysqlMarkers: markers.join('; ') || (hasCompatibilityPlaceholder
            ? 'Question-mark compatibility parameter'
            : 'No known MySQL-only syntax detected in static SQL text'),
        });
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key === 'comments'
        || key === 'tokens' || key === 'errors') continue;
      if (Array.isArray(value)) {
        for (const child of value) {
          visit(child, currentScope, child?.key?.name || child?.key?.value || '', currentFunction);
        }
      } else if (value && typeof value === 'object') {
        const memberName = node.type === 'VariableDeclarator' && key === 'init'
          ? node.id?.name
          : node.type === 'ObjectProperty' && key === 'value'
            ? node.key?.name || node.key?.value
            : value.key?.name || value.key?.value;
        visit(value, currentScope, memberName || '', currentFunction);
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
  rows.push(...inspectCallsites(ast, filePath, testFiles, source));
}

const currentCallsiteKeys = new Set(rows
  .filter((row) => row.status === 'CERTIFIED')
  .map((row) => `${row.path}:${row.line}:${row.column}`));
for (const callsiteKey of currentNeonVerifiedCallsites.keys()) {
  if (!currentCallsiteKeys.has(callsiteKey)) {
    throw new Error(`Current Neon verification metadata does not match an inventoried source call site: ${callsiteKey}`);
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
  'SQL operation',
  'Parameter-binding method',
  'Transaction behavior',
  'Pagination behavior',
  'Join behavior',
  'PostgreSQL compatibility',
  'Error handling',
  'Certification status',
  'Relevant test file(s) and evidence quality',
  'Verification result',
  'MySQL-specific syntax or compatibility marker',
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
    row.sqlOperation,
    row.parameterBinding,
    row.transactionBehavior,
    row.paginationBehavior,
    row.joinBehavior,
    row.postgresCompatibility,
    row.errorHandling,
    row.status,
    row.relevantTestFiles,
    row.verificationResult,
    row.mysqlMarkers,
  ].map(csv).join(',')),
].join('\n');
await writeFile(outputPath, `${output}\n`, 'utf8');
console.log(`Query inventory written: ${relative(resolve(backendDirectory, '..'), outputPath).replaceAll('\\', '/')}`);
console.log(`Source JavaScript files scanned: ${sourceFiles.length}`);
console.log(`Database query/execute call sites inventoried: ${rows.length}`);
for (const status of ['CERTIFIED', 'NEEDS_FIX', 'UNVERIFIED', 'EXEMPT']) {
  console.log(`${status} application call sites: ${rows.filter((row) => row.status === status).length}`);
}
