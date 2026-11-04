import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const codeExtensions = new Set(['.js', '.mjs', '.cjs']);
const providerPath = 'src/application/sqlite-memory-provider.js';
const consumerPath = 'src/application/memory-npc-consumer.js';
const internalImportTestSeam = 'src/application/memory-provider-import-internal.js';
const compositionBoundaryPath = 'src/application/memory-npc-provider-adapter.js';

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (codeExtensions.has(entry.name.slice(entry.name.lastIndexOf('.')))) files.push(absolute);
  }
  return files;
}

function sourceFiles(directory) {
  return walk(join(root, directory)).map((absolute) => ({
    path: relative(root, absolute).split(String.fromCharCode(92)).join('/'),
    content: readFileSync(absolute, 'utf8'),
  }));
}

const sensitiveModuleReference = /(?:sqlite-memory-provider|memory-npc-consumer|memory-provider-import-internal)(?:\.js)?/i;
const sensitiveNames = /\b(?:SQLiteMemoryProvider|MemoryNpcConsumer|createInternalMemoryImportFacadeForTest)\b/;
const providerAdminCall = /\.\s*(?:putRecord|grantQuery|grantRecord|revokeRecord|revokeQuery|captureRawMessage|selectActiveRawVersion|markRawSourceDeleted|purgeRawSource|registerRawDerivedCopy)\s*\(/g;
const productionDirectories = ['src', 'host-adapter', 'scripts'];
const isTestOrFixture = (path) => /(?:^|\/)(?:tests?|fixtures|experiments)(?:\/|$)/i.test(path)
  || /\.test\.[cm]?js$/i.test(path);

function productionFiles() {
  const rootEntrypoint = ['index.mjs'].map((path) => ({
    path,
    content: readFileSync(join(root, path), 'utf8'),
  }));
  return [...productionDirectories.flatMap((directory) => sourceFiles(directory)), ...rootEntrypoint]
    .filter(({ path }) => !isTestOrFixture(path));
}

test('Provider/Consumer references are confined to their implementations and one approved composition boundary', () => {
  const production = productionFiles();
  const composition = production.filter(({ path }) => path === compositionBoundaryPath);
  assert.equal(composition.length, 1, 'exactly one approved Provider/Consumer composition boundary must exist');
  assert.match(composition[0].content, /export function createMemoryNpcProviderAdapter\b/);
  const violations = [];
  for (const file of production.filter(({ path }) => ![
    providerPath, consumerPath, internalImportTestSeam, compositionBoundaryPath,
  ].includes(path))) {
    for (const match of file.content.matchAll(new RegExp(sensitiveModuleReference.source, 'gi'))) {
      violations.push(file.path + ': forbidden direct import ' + match[0]);
    }
    if (sensitiveNames.test(file.content)) {
      violations.push(file.path + ': forbidden Provider/Consumer class or test-facade reference');
    }
  }
  assert.deepEqual(violations, [],
    'Only the approved Core composition factory may reference Provider/Consumer implementation internals.');
});

test('authenticated Host capability construction has no unapproved production callers', () => {
  const trustedCapabilityFiles = new Set([
    'src/application/host-session-context.js',
    compositionBoundaryPath,
  ]);
  const violations = [];
  for (const file of productionFiles().filter(({ path }) => !trustedCapabilityFiles.has(path))) {
    if (/\brunWithAuthenticatedHostSession\s*\(/.test(file.content)
      || /\bcreateAuthenticatedHostSessionContext\s*\(/.test(file.content)) {
      violations.push(file.path + ': direct Host capability construction');
    }
  }
  assert.deepEqual(violations, [],
    'Only the Host session boundary and the approved Core composition factory may construct authenticated Host capabilities.');
});

test('signed Host assertion runners are instantiated only by the Core API composition', () => {
  const violations = [];
  const trustedAssertionRunnerFiles = new Set([
    'src/api/server.js',
    'src/application/host-session-context.js',
  ]);
  for (const file of productionFiles().filter(({ path }) => !trustedAssertionRunnerFiles.has(path))) {
    if (/\bcreateHostSessionAssertionRunner\s*\(/.test(file.content)) {
      violations.push(file.path + ': unapproved signed assertion runner construction');
    }
  }
  assert.deepEqual(violations, [],
    'Only the Core API composition may instantiate signed Host assertion runners and choose their replay/revocation stores.');
});

test('the approved composition factory is the only Provider/Consumer composition wired into the production runtime', () => {
  const entrypoint = readFileSync(join(root, 'src/index.js'), 'utf8');
  const api = readFileSync(join(root, 'src/api/server.js'), 'utf8');
  assert.equal(sensitiveModuleReference.test(entrypoint), false,
    'The normal runtime entrypoint must not import Provider/Consumer implementation modules directly.');
  assert.match(entrypoint, /createMemoryNpcProviderAdapter\s*\(/,
    'The runtime may activate Memory only through the approved Core composition factory.');
  const factoryCallers = productionFiles().filter(({ path, content }) => path !== compositionBoundaryPath
    && /\bcreateMemoryNpcProviderAdapter\s*\(/.test(content)).map(({ path }) => path);
  assert.deepEqual(factoryCallers.sort(), ['host-adapter/embedded-gateway-runtime.mjs', 'src/index.js'].sort(),
    'Only the API and embedded Gateway composition roots may invoke the approved Provider/Consumer factory.');
  assert.equal(sensitiveModuleReference.test(api), false,
    'The HTTP API must not import Provider/Consumer implementation modules.');
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(sensitiveModuleReference.test(JSON.stringify(packageJson.exports ?? {})), false,
    'Package exports must not expose Provider/Consumer implementation modules.');
  const forbiddenRoute = /(?:memory-provider|memory-npc-consumer|memory\/(?:retrieve|grant|revoke|records)|provider\/(?:retrieve|grant|revoke))/i;
  assert.equal(forbiddenRoute.test(api), false,
    'The public HTTP API must not expose Provider/Consumer retrieval or administration routes.');
});

test('SillyTavern Host/extension code cannot import or call Provider/Consumer directly', () => {
  const hostFiles = productionFiles().filter(({ path }) => path.startsWith('host-adapter/'));
  const violations = [];
  for (const file of hostFiles) {
    if (sensitiveModuleReference.test(file.content) || sensitiveNames.test(file.content)) {
      violations.push(file.path + ': direct Provider/Consumer reference');
    }
    if (/\/(?:v1\/)?(?:memory-provider|memory-npc-consumer|memory\/(?:retrieve|grant|revoke))/i.test(file.content)) {
      violations.push(file.path + ': direct Provider/Consumer endpoint reference');
    }
  }
  assert.deepEqual(violations, [],
    'ST-facing code may use only the approved Host transport; it must not import or address Provider/Consumer internals.');
});

test('production API cannot wire the legacy Host HTTP route to a Consumer', () => {
  const entrypoint = readFileSync(join(root, 'src/index.js'), 'utf8');
  assert.doesNotMatch(entrypoint, /memoryNpcConsumers\s*\[\s*adapterId\s*\]\s*=/);
  assert.doesNotMatch(entrypoint, /\n\s*memoryNpcConsumers,\s*\n/);
  assert.match(entrypoint, /legacy HTTP Host→Consumer retrieval bridge is intentionally not/);
});

test('production NPC retrieval is confined to the in-process embedded Gateway composition', () => {
  const hostEntrypoint = readFileSync(join(root, 'index.mjs'), 'utf8');
  const embedded = readFileSync(join(root, 'host-adapter/embedded-gateway-runtime.mjs'), 'utf8');
  const dispatchServer = readFileSync(join(root, 'src/security/memory-dispatch-gateway-server.js'), 'utf8');
  assert.match(hostEntrypoint, /createEmbeddedGatewayRuntime/);
  assert.match(hostEntrypoint, /createNpcGenerationContextHostBridge/);
  assert.match(embedded, /observerOnly:\s*true/);
  assert.match(embedded, /readCoreEvidence:\s*input\s*=>\s*providerAdapter\.consumer\.readDispatchEvidenceSync/);
  assert.match(embedded, /readProviderEvidence:\s*input\s*=>\s*providerAdapter\.readDispatchEvidenceSync/);
  assert.match(dispatchServer, /IN_PROCESS_TRANSPORT_REQUIRED/);
  assert.doesNotMatch(dispatchServer, /gateway\.dispatchProtectedRequest\s*\(/);
});

test('Provider write/grant/revoke methods are callable only inside the approved Core composition boundary', () => {
  const production = productionFiles().filter(({ path }) => ![
    providerPath, internalImportTestSeam, compositionBoundaryPath,
  ].includes(path));
  const violations = [];
  for (const file of production) {
    for (const match of file.content.matchAll(providerAdminCall)) {
      violations.push(file.path + ': ' + match[0]);
    }
  }
  assert.deepEqual(violations, [],
    'Provider persistence and grant administration must remain inside the trusted Core composition boundary.');
});
