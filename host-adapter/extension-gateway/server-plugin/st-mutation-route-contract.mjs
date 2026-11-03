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
    '/delete': 'hostUnsupportedMutationGuard',
    '/upload': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/files.js': Object.freeze({
    '/upload': 'hostUnsupportedMutationGuard',
    '/delete': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/worldinfo.js': Object.freeze({
    '/delete': 'hostUnsupportedMutationGuard',
    '/import': 'hostUnsupportedMutationGuard',
    '/edit': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/presets.js': Object.freeze({
    '/save': 'hostUnsupportedMutationGuard',
    '/delete': 'hostUnsupportedMutationGuard',
    '/restore': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/quick-replies.js': Object.freeze({
    '/save': 'hostUnsupportedMutationGuard',
    '/delete': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/themes.js': Object.freeze({
    '/save': 'hostUnsupportedMutationGuard',
    '/delete': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/backgrounds.js': Object.freeze({
    '/delete': 'hostUnsupportedMutationGuard',
    '/rename': 'hostUnsupportedMutationGuard',
    '/upload': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/assets.js': Object.freeze({
    '/delete': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/vectors.js': Object.freeze({
    '/insert': 'hostUnsupportedMutationGuard',
    '/delete': 'hostUnsupportedMutationGuard',
    '/purge-all': 'hostUnsupportedMutationGuard',
    '/purge': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/settings.js': Object.freeze({
    '/save': 'hostUnsupportedMutationGuard',
    '/make-snapshot': 'hostUnsupportedMutationGuard',
    '/restore-snapshot': 'hostBulkMutationGuard',
  }),
  'src/endpoints/backups.js': Object.freeze({
    '/chat/delete': 'hostBulkMutationGuard',
  }),
  'src/endpoints/data-maid.js': Object.freeze({
    '/delete': 'hostBulkMutationGuard',
  }),
  'src/endpoints/extensions.js': Object.freeze({
    '/install': 'hostUnsupportedMutationGuard',
    '/update': 'hostUnsupportedMutationGuard',
    '/switch': 'hostUnsupportedMutationGuard',
    '/move': 'hostUnsupportedMutationGuard',
    '/delete': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/users-private.js': Object.freeze({
    '/reset-settings': 'hostBulkMutationGuard',
    '/reset-step2': 'hostRootResetGuard',
  }),
});

export const PINNED_ST_UNSUPPORTED_MUTATION_ROUTES = Object.freeze({
  'src/endpoints/content-manager.js': Object.freeze({
    '/importURL': 'hostUnsupportedMutationGuard',
    '/importUUID': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/image-metadata.js': Object.freeze({
    '/folders/create': 'hostUnsupportedMutationGuard',
    '/folders/set-thumbnails': 'hostUnsupportedMutationGuard',
    '/folders/update': 'hostUnsupportedMutationGuard',
    '/folders/delete': 'hostUnsupportedMutationGuard',
    '/folders/assign': 'hostUnsupportedMutationGuard',
    '/folders/unassign': 'hostUnsupportedMutationGuard',
    '/': 'hostUnsupportedMutationGuard',
    '/cleanup': 'hostUnsupportedMutationGuard',
    '/all': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/images.js': Object.freeze({
    '/upload': 'hostUnsupportedMutationGuard',
    '/delete': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/moving-ui.js': Object.freeze({
    '/save': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/presets.js': Object.freeze({
    '/save': 'hostUnsupportedMutationGuard',
    '/delete': 'hostUnsupportedMutationGuard',
    '/restore': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/quick-replies.js': Object.freeze({
    '/save': 'hostUnsupportedMutationGuard',
    '/delete': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/secrets.js': Object.freeze({
    '/write': 'hostUnsupportedMutationGuard',
    '/delete': 'hostUnsupportedMutationGuard',
    '/rotate': 'hostUnsupportedMutationGuard',
    '/rename': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/sprites.js': Object.freeze({
    '/delete': 'hostUnsupportedMutationGuard',
    '/upload-zip': 'hostUnsupportedMutationGuard',
    '/upload': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/stats.js': Object.freeze({
    '/recreate': 'hostUnsupportedMutationGuard',
    '/update': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/themes.js': Object.freeze({
    '/save': 'hostUnsupportedMutationGuard',
    '/delete': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/worldinfo.js': Object.freeze({
    '/delete': 'hostUnsupportedMutationGuard',
    '/import': 'hostUnsupportedMutationGuard',
    '/edit': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/vectors.js': Object.freeze({
    '/insert': 'hostUnsupportedMutationGuard',
    '/delete': 'hostUnsupportedMutationGuard',
    '/purge-all': 'hostUnsupportedMutationGuard',
    '/purge': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/extensions.js': Object.freeze({
    '/install': 'hostUnsupportedMutationGuard',
    '/update': 'hostUnsupportedMutationGuard',
    '/switch': 'hostUnsupportedMutationGuard',
    '/move': 'hostUnsupportedMutationGuard',
    '/delete': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/backgrounds.js': Object.freeze({
    '/delete': 'hostUnsupportedMutationGuard',
    '/rename': 'hostUnsupportedMutationGuard',
    '/upload': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/avatars.js': Object.freeze({
    '/delete': 'hostUnsupportedMutationGuard',
    '/upload': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/assets.js': Object.freeze({
    '/delete': 'hostUnsupportedMutationGuard',
    '/character': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/files.js': Object.freeze({
    '/upload': 'hostUnsupportedMutationGuard',
    '/delete': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/stable-diffusion.js': Object.freeze({
    '/save-workflow': 'hostUnsupportedMutationGuard',
    '/delete-workflow': 'hostUnsupportedMutationGuard',
    '/rename-workflow': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/users-public.js': Object.freeze({
    '/recover-step2': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/users-private.js': Object.freeze({
    '/change-avatar': 'hostUnsupportedMutationGuard',
    '/change-password': 'hostUnsupportedMutationGuard',
    '/backup': 'hostUnsupportedMutationGuard',
    '/change-name': 'hostUnsupportedMutationGuard',
  }),
  'src/endpoints/users-admin.js': Object.freeze({
    '/disable': 'hostUnsupportedMutationGuard',
    '/enable': 'hostUnsupportedMutationGuard',
    '/promote': 'hostUnsupportedMutationGuard',
    '/demote': 'hostUnsupportedMutationGuard',
    '/create': 'hostUnsupportedMutationGuard',
    '/delete': 'hostAccountDeleteGuard',
  }),
});

const PINNED_ST_ALL_MUTATION_ROUTES = Object.freeze(Object.fromEntries(
  [...new Set([
    ...Object.keys(PINNED_ST_MUTATION_ROUTES),
    ...Object.keys(PINNED_ST_UNSUPPORTED_MUTATION_ROUTES),
  ])].sort().map(relative => {
    const primary = PINNED_ST_MUTATION_ROUTES[relative] ?? {};
    const unsupported = PINNED_ST_UNSUPPORTED_MUTATION_ROUTES[relative] ?? {};
    const routes = [...new Set([...Object.keys(primary), ...Object.keys(unsupported)])].sort();
    return [relative, Object.freeze(Object.fromEntries(routes.map(route => [
      route,
      Object.freeze([...new Set([
        ...(primary[route] === undefined ? [] : [primary[route]]),
        ...(unsupported[route] === undefined ? [] : [unsupported[route]]),
      ])]),
    ])))];
  }),
));

const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const routeCount = Object.values(PINNED_ST_ALL_MUTATION_ROUTES)
  .reduce((count, routes) => count + Object.keys(routes).length, 0);
const guardAssertionCount = Object.values(PINNED_ST_ALL_MUTATION_ROUTES)
  .reduce((count, routes) => count + Object.values(routes).reduce((total, guards) => total + guards.length, 0), 0);

export const PINNED_ST_MUTATION_ROUTE_COUNT = routeCount;
export const PINNED_ST_MUTATION_GUARD_ASSERTION_COUNT = guardAssertionCount;
export const PINNED_ST_MUTATION_COVERAGE_SHA256 = sha256(canonical({
  version: 1,
  source_commit: PINNED_ST_COMMIT,
  routes: PINNED_ST_ALL_MUTATION_ROUTES,
  source_guards: [
    'HOST_EXTENSION_SOURCE_MUTATION_UNSUPPORTED',
    'HOST_MUTATION_ROUTE_UNSUPPORTED',
    'HOST_USER_ACCOUNT_DELETE_UNSUPPORTED',
    'HOST_USER_ROOT_RESET_UNSUPPORTED',
    'revokeHostSessionBeforeLogout(request)',
    'HOST_LIFECYCLE_USER_DIRECTORY_MISSING',
    'HOST_LIFECYCLE_LEGACY_USER_DATA_MIGRATION_BLOCKED',
    'Skipping system prompt migration while Host authority is active.',
    'assertHostStartupMigrationAllowed({',
    'Skipping startup group metadata migration: ',
  ],
}));

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hasPinnedPostRouteGuards(source, route, guards) {
  if (typeof source !== 'string' || typeof route !== 'string' || !route
    || !Array.isArray(guards) || guards.length === 0
    || guards.some(guard => typeof guard !== 'string' || !guard)) return false;
  const expression = new RegExp(
    "(?:router|comfy)\\.post\\(\\s*(['\"])" + escapeRegExp(route) + "\\1\\s*,([^\\r\\n]*)",
    'g',
  );
  const declarations = [...source.matchAll(expression)].map(match => match[2]);
  return declarations.length > 0
    && declarations.every(middleware => guards.every(guard => middleware.includes(guard)));
}
/**
 * Verify the actual, patched SillyTavern source tree loaded by the Host plugin.
 * The digest binds the exact bytes of every endpoint file used by the route
 * contract, not a deployment environment variable or browser assertion.
 */
export async function verifyPinnedSillyTavernMutationCoverage({
  // The server-plugin package files are copied into
  // <SillyTavern>/plugins/logic-engine-extension-gateway/.
  // Two parent traversals resolve the actual pinned SillyTavern source root.
  sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'),
} = {}) {
  if (typeof sourceRoot !== 'string' || !sourceRoot.trim()) {
    throw new TypeError('A SillyTavern source root is required for mutation-route attestation.');
  }
  const files = new Map();
  let checkedRoutes = 0;
  let checkedGuards = 0;
  for (const [relative, expectedRoutes] of Object.entries(PINNED_ST_ALL_MUTATION_ROUTES)) {
    const bytes = await readFile(join(sourceRoot, relative));
    const source = bytes.toString('utf8');
    files.set(relative, createHash('sha256').update(bytes).digest('hex'));
    for (const [route, guards] of Object.entries(expectedRoutes)) {
      if (!hasPinnedPostRouteGuards(source, route, guards)) {
        throw new Error('HOST_ST_MUTATION_ROUTE_COVERAGE_MISMATCH:' + relative + ':' + route);
      }
      checkedGuards += guards.length;
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
    if (relative.endsWith('extensions.js')
      && (!source.includes('createHostUnsupportedMutationGuard')
        || !source.includes('const hostUnsupportedMutationGuard = createHostUnsupportedMutationGuard();'))) {
      throw new Error('HOST_ST_EXTENSION_SOURCE_MUTATION_GUARD_MISSING');
    }
    if (relative.endsWith('users-admin.js')
      && (!source.includes('const hostUnsupportedMutationGuard = createHostUnsupportedMutationGuard();')
        || !source.includes("const hostAccountDeleteGuard = createHostUnsupportedMutationGuard({ code: 'HOST_USER_ACCOUNT_DELETE_UNSUPPORTED' });"))) {
      // Every users-admin POST route is separately checked against the pinned
      // route map above. The account guard is route-scoped, not router.use(),
      // and its default denial code is implemented by the shared Gateway
      // guard factory rather than duplicated in this endpoint module.
      throw new Error('HOST_ST_ACCOUNT_MUTATION_GUARD_MISSING');
    }
    if (relative.endsWith('users.js')
      && (!source.includes("throw new Error('HOST_LIFECYCLE_USER_DIRECTORY_MISSING')")
        || !source.includes("throw new Error('HOST_LIFECYCLE_LEGACY_USER_DATA_MIGRATION_BLOCKED')")
        || !source.includes("console.warn('Skipping system prompt migration while Host authority is active.')")
        || !source.includes('if (process.env.LOGIC_ENGINE_HOST_IDENTITY_DIR)'))) {
      throw new Error('HOST_ST_USER_DATA_MIGRATION_GUARD_MISSING');
    }
    if (relative.endsWith('users-private.js')
      && (!source.includes("router.post('/logout'")
        || !source.includes('revokeHostSessionBeforeLogout(request)')
        || !source.includes('Host session revocation unavailable; session was not logged out.')
        || !source.includes('request.session = null')
        || source.indexOf('revokeHostSessionBeforeLogout(request)') > source.indexOf('request.session = null'))) {
      throw new Error('HOST_ST_LOGOUT_SESSION_INVALIDATION_MISSING');
    }
    if (relative.endsWith('users-private.js') && !source.includes('HOST_USER_ROOT_RESET_UNSUPPORTED')) {
      throw new Error('HOST_ST_ROOT_RESET_GUARD_MISSING');
    }
    if (relative.endsWith('groups.js')
      && (!source.includes('assertHostStartupMigrationAllowed({')
        || !source.includes('Skipping startup group metadata migration: ')
        || !source.includes('continue;'))) {
      throw new Error('HOST_ST_GROUP_MIGRATION_GUARD_MISSING');
    }
  }
  if (checkedRoutes !== PINNED_ST_MUTATION_ROUTE_COUNT
    || checkedGuards !== PINNED_ST_MUTATION_GUARD_ASSERTION_COUNT) {
    throw new Error('HOST_ST_MUTATION_ROUTE_COVERAGE_COUNT_MISMATCH');
  }
  const sourceFilesSha256 = sha256(canonical([...files.entries()].sort(([a], [b]) => a.localeCompare(b))));
  return Object.freeze({
    status: 'VERIFIED',
    source_commit: PINNED_ST_COMMIT,
    coverage_manifest_sha256: PINNED_ST_MUTATION_COVERAGE_SHA256,
    route_count: checkedRoutes,
    guard_assertion_count: checkedGuards,
    source_files_sha256: sourceFilesSha256,
  });
}
