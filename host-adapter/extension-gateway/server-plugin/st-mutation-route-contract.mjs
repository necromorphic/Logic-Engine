import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PINNED_ST_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';

export const PINNED_ST_MUTATION_ROUTES = Object.freeze({
  'src/endpoints/chats.js': Object.freeze({
    '/save': 'hostLifecycleSaveGuard',
    '/group/save': 'hostLifecycleSaveGuard',
    '/rename': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
    '/export': 'hostBulkMutationGuard',
    '/group/import': 'hostBulkMutationGuard',
    '/import': 'hostBulkMutationGuard',
    '/group/delete': 'hostBulkMutationGuard',
  }),
  'src/endpoints/groups.js': Object.freeze({
    '/create': 'hostBulkMutationGuard',
    '/edit': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
  }),
  'src/endpoints/characters.js': Object.freeze({
    '/create': 'hostBulkMutationGuard',
    '/rename': 'hostBulkMutationGuard',
    '/edit': 'hostBulkMutationGuard',
    '/edit-avatar': 'hostBulkMutationGuard',
    '/edit-attribute': 'hostBulkMutationGuard',
    '/merge-attributes': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
    '/import': 'hostBulkMutationGuard',
    '/duplicate': 'hostBulkMutationGuard',
  }),
  'src/endpoints/avatars.js': Object.freeze({
    '/delete': 'hostBulkMutationGuard',
    '/upload': 'hostBulkMutationGuard',
  }),
  'src/endpoints/files.js': Object.freeze({
    '/upload': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
  }),
  'src/endpoints/worldinfo.js': Object.freeze({
    '/delete': 'hostBulkMutationGuard',
    '/import': 'hostBulkMutationGuard',
    '/edit': 'hostBulkMutationGuard',
  }),
  'src/endpoints/presets.js': Object.freeze({
    '/save': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
    '/restore': 'hostBulkMutationGuard',
  }),
  'src/endpoints/quick-replies.js': Object.freeze({
    '/save': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
  }),
  'src/endpoints/themes.js': Object.freeze({
    '/save': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
  }),
  'src/endpoints/backgrounds.js': Object.freeze({
    '/delete': 'hostBulkMutationGuard',
    '/rename': 'hostBulkMutationGuard',
    '/upload': 'hostBulkMutationGuard',
  }),
  'src/endpoints/assets.js': Object.freeze({
    '/delete': 'hostBulkMutationGuard',
  }),
  'src/endpoints/vectors.js': Object.freeze({
    '/insert': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
    '/purge-all': 'hostBulkMutationGuard',
    '/purge': 'hostBulkMutationGuard',
  }),
  'src/endpoints/settings.js': Object.freeze({
    '/save': 'hostBulkMutationGuard',
    '/make-snapshot': 'hostBulkMutationGuard',
    '/restore-snapshot': 'hostBulkMutationGuard',
  }),
  'src/endpoints/backups.js': Object.freeze({
    '/chat/delete': 'hostBulkMutationGuard',
  }),
  'src/endpoints/data-maid.js': Object.freeze({
    '/delete': 'hostBulkMutationGuard',
  }),
  'src/endpoints/extensions.js': Object.freeze({
    '/install': 'hostSourceMutationGuard',
    '/update': 'hostSourceMutationGuard',
    '/switch': 'hostSourceMutationGuard',
    '/move': 'hostSourceMutationGuard',
    '/delete': 'hostSourceMutationGuard',
  }),
  'src/endpoints/users-private.js': Object.freeze({
    '/reset-settings': 'hostUserRootResetGuard',
    '/reset-step2': 'hostUserRootResetGuard',
  }),
});

const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const routeCount = Object.values(PINNED_ST_MUTATION_ROUTES)
  .reduce((count, routes) => count + Object.keys(routes).length, 0);

export const PINNED_ST_MUTATION_ROUTE_COUNT = routeCount;
export const PINNED_ST_MUTATION_COVERAGE_SHA256 = sha256(canonical({
  version: 1,
  source_commit: PINNED_ST_COMMIT,
  routes: PINNED_ST_MUTATION_ROUTES,
  source_guards: [
    'HOST_EXTENSION_SOURCE_MUTATION_UNSUPPORTED',
    'HOST_USER_ACCOUNT_MUTATION_UNSUPPORTED',
    'HOST_USER_ROOT_RESET_UNSUPPORTED',
    'revokeHostSessionBeforeLogout(request)',
    'HOST_USER_DATA_MIGRATION_INCOMPLETE',
    'HOST_SYSTEM_PROMPT_MIGRATION_INCOMPLETE',
    'Skipping unreceipted startup group metadata migration while Host inventory is enabled.',
  ],
}));

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Verify the actual, patched SillyTavern source tree loaded by the Host plugin.
 * The digest binds the exact bytes of every endpoint file used by the route
 * contract, not a deployment environment variable or browser assertion.
 */
export async function verifyPinnedSillyTavernMutationCoverage({
  // Installed at <SillyTavern>/plugins/logic-engine-extension-gateway/server-plugin.
  // Three parent traversals resolve the actual pinned SillyTavern source root.
  sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),
} = {}) {
  if (typeof sourceRoot !== 'string' || !sourceRoot.trim()) {
    throw new TypeError('A SillyTavern source root is required for mutation-route attestation.');
  }
  const files = new Map();
  let checkedRoutes = 0;
  for (const [relative, expectedRoutes] of Object.entries(PINNED_ST_MUTATION_ROUTES)) {
    const bytes = await readFile(join(sourceRoot, relative));
    const source = bytes.toString('utf8');
    files.set(relative, createHash('sha256').update(bytes).digest('hex'));
    for (const [route, guard] of Object.entries(expectedRoutes)) {
      const expression = new RegExp("router\\.post\\('" + escapeRegExp(route) + "',([^\\n]*)");
      const match = source.match(expression);
      if (!match || !match[1].includes(guard)) {
        throw new Error('HOST_ST_MUTATION_ROUTE_COVERAGE_MISMATCH:' + relative + ':' + route);
      }
      checkedRoutes++;
    }
  }

  const specialFiles = [
    'src/endpoints/extensions.js',
    'src/endpoints/users-admin.js',
    'src/endpoints/users-private.js',
    'src/users.js',
    'src/endpoints/groups.js',
  ];
  for (const relative of specialFiles) {
    const bytes = await readFile(join(sourceRoot, relative));
    files.set(relative, createHash('sha256').update(bytes).digest('hex'));
    const source = bytes.toString('utf8');
    if (relative.endsWith('extensions.js') && !source.includes('HOST_EXTENSION_SOURCE_MUTATION_UNSUPPORTED')) {
      throw new Error('HOST_ST_EXTENSION_SOURCE_MUTATION_GUARD_MISSING');
    }
    if (relative.endsWith('users-admin.js')
      && (!source.includes('HOST_USER_ACCOUNT_MUTATION_UNSUPPORTED')
        || !source.includes('router.use(')
        || !source.includes("request.method === 'POST'")
        || !source.includes("!['/get', '/slugify'].includes(request.path)"))) {
      throw new Error('HOST_ST_ACCOUNT_MUTATION_GUARD_MISSING');
    }
    if (relative.endsWith('users.js')
      && (!source.includes("throw new Error('HOST_USER_DATA_MIGRATION_INCOMPLETE')")
        || !source.includes("throw new Error('HOST_SYSTEM_PROMPT_MIGRATION_INCOMPLETE')"))) {
      throw new Error('HOST_ST_USER_DATA_MIGRATION_GUARD_MISSING');
    }
    if (relative.endsWith('users-private.js')
      && (!source.includes("router.post('/logout'")
        || !source.includes('revokeHostSessionBeforeLogout(request)')
        || !source.includes('request.session = null'))) {
      throw new Error('HOST_ST_LOGOUT_SESSION_INVALIDATION_MISSING');
    }
    if (relative.endsWith('users-private.js') && !source.includes('HOST_USER_ROOT_RESET_UNSUPPORTED')) {
      throw new Error('HOST_ST_ROOT_RESET_GUARD_MISSING');
    }
    if (relative.endsWith('groups.js')
      && !source.includes('Skipping unreceipted startup group metadata migration while Host inventory is enabled.')) {
      throw new Error('HOST_ST_GROUP_MIGRATION_GUARD_MISSING');
    }
  }
  if (checkedRoutes !== PINNED_ST_MUTATION_ROUTE_COUNT) {
    throw new Error('HOST_ST_MUTATION_ROUTE_COVERAGE_COUNT_MISMATCH');
  }
  const sourceFilesSha256 = sha256(canonical([...files.entries()].sort(([a], [b]) => a.localeCompare(b))));
  return Object.freeze({
    status: 'VERIFIED',
    source_commit: PINNED_ST_COMMIT,
    coverage_manifest_sha256: PINNED_ST_MUTATION_COVERAGE_SHA256,
    route_count: checkedRoutes,
    source_files_sha256: sourceFilesSha256,
  });
}
