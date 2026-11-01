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
    path: relative(root, absolute).replaceAll('\\', '/'),
    content: readFileSync(absolute, 'utf8'),
  }));
}

const sensitiveModuleReference = /(?:sqlite-memory-provider|memory-npc-consumer|memory-provider-import-internal)(?:\.js)?/i;
const sensitiveNames = /\b(?:SQLiteMemoryProvider|MemoryNpcConsumer|createInternalMemoryImportFacadeForTest)\b/;
const providerAdminCall = /\.\s*(?:putRecord|grantQuery|grantRecord|revokeRecord|revokeQuery|captureRawMessage|selectActiveRawVersion|markRawSourceDeleted|purgeRawSource|registerRawDerivedCopy)\s*\(/g;
const productionDirectories = ['src', 'host-adapter', 'scripts'];
const isTestOrFixture = (path) => /(?:^|\/)(?:tests?|fixtures|experiments)(?:\/|$)/i.test(path);

function productionFiles() {
  return productionDirectories.flatMap((directory) => sourceFiles(directory))
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

test('the approved composition factory is not wired into the production runtime or public HTTP API', () => {
  const entrypoint = readFileSync(join(root, 'src/index.js'), 'utf8');
  const api = readFileSync(join(root, 'src/api/server.js'), 'utf8');
  assert.equal(sensitiveModuleReference.test(entrypoint), false,
    'The normal runtime entrypoint must not activate Memory Provider/Consumer composition.');
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
