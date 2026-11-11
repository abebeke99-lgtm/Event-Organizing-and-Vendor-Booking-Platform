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
  ['backend/src/routes/postgresAuth.js:39:10', { description: 'PostgreSQL auth API query adapter', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:50:9', { description: 'PostgreSQL auth audit insert', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:60:9', { description: 'PostgreSQL auth session insert', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:71:25', { description: 'PostgreSQL registration notification setting lookup', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:78:24', { description: 'PostgreSQL admin recipient lookup', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:86:32', { description: 'PostgreSQL registration notification insert', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:102:13', { description: 'PostgreSQL notification history insert', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:170:28', { description: 'PostgreSQL customer role lookup', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:180:32', { description: 'PostgreSQL user insert with RETURNING', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:187:15', { description: 'PostgreSQL user-role insert', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:270:15', { description: 'PostgreSQL login timestamp update', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:273:17', { description: 'PostgreSQL vendor profile ON CONFLICT insert', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:116:28', { description: 'PostgreSQL platform availability settings query', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:156:41', { description: 'PostgreSQL public-registration setting lookup', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:234:28', { description: 'PostgreSQL authentication credential and role lookup', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:302:15', { description: 'PostgreSQL user-session logout deletion', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:306:15', { description: 'PostgreSQL admin-session logout deletion', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:321:28', { description: 'PostgreSQL current-session user and role lookup', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresAuth.js:396:28', { description: 'PostgreSQL authenticated role redirect lookup', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:452:28', { description: 'AI conversation list with owner, archive, and search filters', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:476:30', { description: 'AI conversation insert with generated ID return', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:498:36', { description: 'Owner check before returning AI conversation messages', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:503:32', { description: 'AI conversation message history query', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:537:38', { description: 'Lock owner conversation before message edit', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:543:43', { description: 'Find latest user message before edit', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:550:15', { description: 'Persist edited user message', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:555:15', { description: 'Delete later messages after editing prompt', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:590:30', { description: 'Update owner conversation title, pin, and archive state', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:615:30', { description: 'Delete owner conversation', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:641:22', { description: 'Verify conversation ownership before streaming', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:657:32', { description: 'Load conversation history for streaming and regeneration', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:686:15', { description: 'Persist user prompt before AI stream', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:692:13', { description: 'Update conversation model and initial title', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:708:32', { description: 'Persist safe response to blocked prompt', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:793:34', { description: 'Replace assistant response during regeneration', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/aiChat.js:801:34', { description: 'Persist generated assistant response', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/lib/aiChatContext.js:54:5', { description: 'Load upcoming PostgreSQL events and ticket availability for AI context', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/lib/postgresMarketplace.js:15:24', { description: 'Load verified public services for AI grounding context', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/lib/postgresMarketplace.js:41:5', { description: 'Load public service packages for verified services', test: 'backend/test/vendorPublicApi.test.js' }],
  ['backend/src/lib/postgresMarketplace.js:54:5', { description: 'Load public service media for verified services', test: 'backend/test/vendorPublicApi.test.js' }],
  ['backend/src/lib/postgresMarketplace.js:60:5', { description: 'Load current vendor availability for public services', test: 'backend/test/vendorPublicApi.test.js' }],
  ['backend/src/lib/postgresMarketplace.js:106:24', { description: 'Load verified public vendors for AI grounding context', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/lib/postgresMarketplace.js:127:13', { description: 'Load public vendor media', test: 'backend/test/vendorPublicApi.test.js' }],
  ['backend/src/lib/postgresMarketplace.js:153:24', { description: 'Load active service categories for AI grounding context', test: 'backend/test/aiChatPostgresIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:57:9', { description: 'Write notification operation audit record', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:73:9', { description: 'Write notification delivery and read history', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:126:25', { description: 'Count owner-scoped notifications using PostgreSQL filters', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:130:26', { description: 'Count unread admin notifications', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:135:24', { description: 'List and paginate filtered admin notifications', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:162:29', { description: 'Mark an owner-scoped notification read with RETURNING', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:173:27', { description: 'Resolve already-read notification ownership', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:187:28', { description: 'Mark all owner notifications read and insert history with a CTE', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:211:25', { description: 'Check notification ownership before history access', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:218:27', { description: 'List notification history with actor details', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:245:28', { description: 'Load active administrator recipients for an announcement', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:255:30', { description: 'Insert idempotent announcement with ON CONFLICT and RETURNING', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:281:32', { description: 'Resolve existing announcement by idempotency key', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:314:32', { description: 'Record failed email announcement delivery', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:335:30', { description: 'Record successful email announcement delivery', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:372:28', { description: 'Lock owner notification before retrying email delivery', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:383:29', { description: 'Claim failed email notification for retry', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:411:30', { description: 'Record failed or successful notification retry delivery', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresAdminNotifications.js:433:28', { description: 'Audit notification delivery retry outcome', test: 'backend/test/postgresAdminIntegration.test.js' }],
  ['backend/src/routes/postgresCustomerAccount.js:47:29', { description: 'PostgreSQL customer profile update', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresCustomerAccount.js:52:13', { description: 'PostgreSQL customer profile audit insert', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresCustomerAccount.js:90:31', { description: 'PostgreSQL current-password row lock and lookup', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresCustomerAccount.js:98:15', { description: 'PostgreSQL password update', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresCustomerAccount.js:102:15', { description: 'PostgreSQL other-session invalidation', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresCustomerAccount.js:106:15', { description: 'PostgreSQL critical password-change audit insert', test: 'backend/test/postgresAuthIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:34:24', { description: 'Booking/quotation notification insert', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:44:11', { description: 'Notification history insert', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:162:34', { description: 'Lock and verify organizer-owned event for booking creation', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:172:36', { description: 'Lock and verify active service/vendor for booking creation', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:187:38', { description: 'Detect duplicate organizer/event/service booking', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:195:36', { description: 'Create booking with PostgreSQL RETURNING', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:203:13', { description: 'Record initial booking history', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:250:36', { description: 'Lock booking during status transition', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:302:13', { description: 'Persist booking status transition', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:310:13', { description: 'Record booking status history', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:359:36', { description: 'Load service/vendor for quotation request', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:371:39', { description: 'Check quotation request idempotency key', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:384:36', { description: 'Verify organizer ownership of quotation event', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:390:34', { description: 'Create quotation with PostgreSQL RETURNING', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:430:34', { description: 'Lock vendor-owned quotation before response', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:441:13', { description: 'Persist vendor quotation response', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:469:31', { description: 'List organizer-owned quotations', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:494:34', { description: 'Lock organizer-owned quotation before decision', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:509:13', { description: 'Persist quotation decision and revision', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:539:26', { description: 'Load customer/organizer booking dashboard aggregates', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:581:26', { description: 'List organizer-owned events', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:612:26', { description: 'List customer favorite vendors', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:634:26', { description: 'Verify vendor before adding favorite', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:639:27', { description: 'Insert customer favorite with conflict-safe return', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:651:27', { description: 'Delete owner-scoped customer favorite', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:660:26', { description: 'List owner-scoped saved services', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:687:27', { description: 'Verify published service before saving', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:693:27', { description: 'Insert saved service with conflict-safe return', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresBookings.js:705:27', { description: 'Delete owner-scoped saved service', test: 'backend/test/postgresBookingsIntegration.test.js' }],
  ['backend/src/routes/postgresVendor.js:102:24', { description: 'Load vendor profile and owning user for authorization', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:139:9', { description: 'Insert vendor operation audit record', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:148:24', { description: 'Insert vendor operation notification', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:158:11', { description: 'Insert vendor notification history', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:205:26', { description: 'Load vendor dashboard aggregates', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:282:30', { description: 'Validate active category for vendor profile update', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:293:15', { description: 'Update vendor profile fields transactionally', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:308:7', { description: 'List vendor verification documents', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:313:7', { description: 'List vendor verification history', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:341:13', { description: 'Lock vendor profile during document upload', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:342:27', { description: 'Count vendor verification documents under lock', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:349:27', { description: 'Insert vendor verification document with RETURNING', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:373:26', { description: 'Download owner-scoped verification document content', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:391:26', { description: 'List vendor services', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:410:30', { description: 'Validate active service category', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:416:27', { description: 'Load platform currency for service creation', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:421:29', { description: 'Insert vendor service with RETURNING', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:477:29', { description: 'Archive an owner-scoped service and return its ID', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:509:26', { description: 'List vendor service packages', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:523:25', { description: 'Verify service ownership before package creation', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:525:27', { description: 'Load platform currency for package creation', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:527:27', { description: 'Insert service package JSONB fields with RETURNING', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:554:26', { description: 'Update owner-scoped service package', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:569:26', { description: 'Delete owner-scoped service package', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:585:26', { description: 'List vendor media metadata', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:729:24', { description: 'Load owner-scoped vendor task for status update', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:740:13', { description: 'Update vendor task status', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:757:7', { description: 'List vendor payments', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:763:7', { description: 'List vendor refunds', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:790:26', { description: 'List booking-scoped vendor messages', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:812:27', { description: 'Verify vendor owns active booking before sending message', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:821:27', { description: 'Insert vendor message with RETURNING', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:843:27', { description: 'Mark recipient-owned vendor message as read', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:855:26', { description: 'List booking reviews for vendor', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:889:26', { description: 'List vendor notifications', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:905:29', { description: 'Mark vendor-owned notification as read', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:911:15', { description: 'Insert notification read history', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:986:7', { description: 'List vendor services for report', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:987:7', { description: 'List vendor bookings for report', test: 'backend/test/postgresVendor.test.js' }],
  ['backend/src/routes/postgresVendor.js:992:7', { description: 'Aggregate vendor paid earnings by month', test: 'backend/test/postgresVendor.test.js' }],
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
  function visit(node, scope = '<module>', parentKey = '', apiRoute = '') {
    if (!node || typeof node !== 'object') return;
    let currentScope = scope;
    let currentRoute = apiRoute;
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression'
      || node.type === 'ArrowFunctionExpression' || node.type === 'ObjectMethod'
      || node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod') {
      currentScope = nodeFunctionName(node, parentKey) || scope;
    }

    if (node.type === 'CallExpression') {
      const property = node.callee?.type === 'MemberExpression'
        ? node.callee.computed ? node.callee.property?.value : node.callee.property?.name
        : node.callee?.type === 'Identifier' ? node.callee.name : '';
      const isSqlExecuteHelper = property === 'execute'
        && node.callee?.type === 'Identifier'
        && ['StringLiteral', 'TemplateLiteral'].includes(node.arguments[1]?.type);
      const isSqlQueryHelper = property === 'query'
        && node.callee?.type === 'Identifier'
        && ['StringLiteral', 'TemplateLiteral'].includes(node.arguments[1]?.type);
      const routePath = node.arguments[0]?.type === 'StringLiteral'
        ? node.arguments[0].value
        : node.arguments[0]?.type === 'ArrayExpression'
          ? node.arguments[0].elements.map((entry) => entry?.value).filter(Boolean).join('|')
          : '';
      if (['get', 'post', 'put', 'patch', 'delete'].includes(property) && routePath.startsWith('/')) {
        currentRoute = `${property.toUpperCase()} ${routePath}`;
      }
      if ((property === 'execute' || property === 'query') && node.callee?.type === 'MemberExpression'
        || isSqlExecuteHelper || isSqlQueryHelper) {
        const method = isSqlExecuteHelper
          ? 'execute helper'
          : isSqlQueryHelper ? 'query helper' : property;
        const argument = isSqlExecuteHelper || isSqlQueryHelper ? node.arguments[1] : node.arguments[0];
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
          ? 'INSPECTED'
          : neonVerification
            ? 'NEON_CERTIFIED'
            : 'NOT_INSPECTED';
        const dialect = isPostgresInfrastructure || /(?:^|\/)postgres[^/]*\.js$/i.test(relativeFilePath)
          ? 'PostgreSQL-specific source'
          : method === 'execute' || isSqlExecuteHelper
            ? 'MySQL execute interface'
            : 'Dual-dialect or unknown; requires review';
        const modulePath = relativeFilePath.slice(0, relativeFilePath.lastIndexOf('/'));
        rows.push({
          callSiteId: `${relativeFilePath}:L${line}:C${column}:${method}`,
          path: relativeFilePath,
          module: modulePath,
          routeOrFunction: currentRoute || currentScope,
          functionName: currentScope,
          line,
          column,
          method,
          dialect: isSqlExecuteHelper && !isPostgresInfrastructure ? 'Dual-dialect query helper' : dialect,
          currentImplementation: relativeFilePath,
          postgresImplementation: isSqlExecuteHelper || isSqlQueryHelper
            || /(?:^|\/)postgres[^/]*\.js$/i.test(relativeFilePath)
            ? relativeFilePath
            : 'Not identified',
          markers: markers.join('; ') || 'No MySQL-only syntax detected in static SQL text',
          stage,
          conversionStatus: isPostgresInfrastructure
            ? 'PostgreSQL infrastructure; not an application query'
            : neonVerification
              ? `PostgreSQL verified on isolated Neon; ${neonVerification.description}`
            : isSqlExecuteHelper
              ? 'Not certified; inspect SQL and dual-dialect result semantics'
            : isSqlQueryHelper
              ? 'Not certified; inspect query helper parameters and result semantics'
            : method === 'execute'
              ? 'Not converted; execute/result handling requires MySQL semantics'
              : markers.length
                ? 'Not converted; MySQL-specific SQL detected'
                : 'Not certified; inspect SQL, parameters, and result handling',
          unitTestStatus: isPostgresInfrastructure ? 'NOT_APPLICABLE' : 'NOT_TRACKED',
          integrationTestStatus: isPostgresInfrastructure
            ? 'NOT_APPLICABLE'
            : neonVerification
              ? 'INTEGRATION_TESTED'
              : 'NOT_TESTED',
          neonVerification: neonVerification
            ? `Verified on isolated Neon; ${neonVerification.description}`
            : 'Not verified on Neon',
          remainingIssues: isPostgresInfrastructure
            ? 'Infrastructure verification is tracked by database configuration and adapter tests'
            : neonVerification
                ? 'Only behavior exercised by the linked integration is certified; other route paths remain outside this call-site record'
                : 'PostgreSQL compatibility, parameter/result semantics, and runtime behavior remain unverified',
          linkedTest: neonVerification?.test || 'None',
          staticTestCandidates: neighboringTests.join('; ') || 'None',
        });
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key === 'comments'
        || key === 'tokens' || key === 'errors') continue;
      if (Array.isArray(value)) {
        for (const child of value) {
          visit(child, currentScope, child?.key?.name || child?.key?.value || '', currentRoute);
        }
      } else if (value && typeof value === 'object') {
        const memberName = node.type === 'VariableDeclarator' && key === 'init'
          ? node.id?.name
          : node.type === 'ObjectProperty' && key === 'value'
            ? node.key?.name || node.key?.value
            : value.key?.name || value.key?.value;
        visit(value, currentScope, memberName || '', currentRoute);
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
  .filter((row) => row.stage === 'NEON_CERTIFIED')
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
  'Module',
  'API route or function',
  'Current implementation',
  'PostgreSQL implementation',
  'Function',
  'Line',
  'Column',
  'Method',
  'Current dialect classification',
  'MySQL-specific syntax',
  'Migration stage',
  'PostgreSQL conversion status',
  'Unit test status',
  'Integration test status',
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
    row.module,
    row.routeOrFunction,
    row.currentImplementation,
    row.postgresImplementation,
    row.functionName,
    row.line,
    row.column,
    row.method,
    row.dialect,
    row.markers,
    row.stage,
    row.conversionStatus,
    row.unitTestStatus,
    row.integrationTestStatus,
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
const certifiedCalls = applicationRows.filter((row) => row.stage === 'NEON_CERTIFIED').length;
const inspectedApplicationCalls = applicationRows.filter((row) => row.stage === 'INSPECTED').length;
console.log(`PostgreSQL infrastructure call sites: ${infrastructureCalls}`);
console.log(`Application call sites not inspected semantically: ${applicationRows.length - certifiedCalls - inspectedApplicationCalls}`);
console.log(`Application call sites verified on isolated Neon: ${certifiedCalls}`);
console.log(`Application call sites not certified: ${applicationRows.length - certifiedCalls}`);
