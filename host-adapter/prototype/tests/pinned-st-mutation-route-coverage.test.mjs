import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.env.SILLYTAVERN_SOURCE_ROOT ?? null;
const routes = {
  'src/endpoints/chats.js': {
    '/save': 'hostLifecycleSaveGuard',
    '/group/save': 'hostLifecycleSaveGuard',
    '/rename': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
    '/export': 'hostBulkMutationGuard',
    '/group/import': 'hostBulkMutationGuard',
    '/import': 'hostBulkMutationGuard',
    '/group/delete': 'hostBulkMutationGuard',
  },
  'src/endpoints/groups.js': {
    '/create': 'hostBulkMutationGuard',
    '/edit': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
  },
  'src/endpoints/characters.js': {
    '/create': 'hostBulkMutationGuard',
    '/rename': 'hostBulkMutationGuard',
    '/edit': 'hostBulkMutationGuard',
    '/edit-avatar': 'hostBulkMutationGuard',
    '/edit-attribute': 'hostBulkMutationGuard',
    '/merge-attributes': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
    '/import': 'hostBulkMutationGuard',
    '/duplicate': 'hostBulkMutationGuard',
  },
  'src/endpoints/avatars.js': {
    '/delete': 'hostBulkMutationGuard',
    '/upload': 'hostBulkMutationGuard',
  },
  'src/endpoints/files.js': {
    '/upload': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
  },
  'src/endpoints/worldinfo.js': {
    '/delete': 'hostBulkMutationGuard',
    '/import': 'hostBulkMutationGuard',
    '/edit': 'hostBulkMutationGuard',
  },
  'src/endpoints/presets.js': {
    '/save': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
    '/restore': 'hostBulkMutationGuard',
  },
  'src/endpoints/quick-replies.js': {
    '/save': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
  },
  'src/endpoints/themes.js': {
    '/save': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
  },
  'src/endpoints/backgrounds.js': {
    '/delete': 'hostBulkMutationGuard',
    '/rename': 'hostBulkMutationGuard',
    '/upload': 'hostBulkMutationGuard',
  },
  'src/endpoints/assets.js': {
    '/delete': 'hostBulkMutationGuard',
  },
  'src/endpoints/vectors.js': {
    '/insert': 'hostBulkMutationGuard',
    '/delete': 'hostBulkMutationGuard',
    '/purge-all': 'hostBulkMutationGuard',
    '/purge': 'hostBulkMutationGuard',
  },
  'src/endpoints/settings.js': {
    '/save': 'hostBulkMutationGuard',
    '/make-snapshot': 'hostBulkMutationGuard',
    '/restore-snapshot': 'hostBulkMutationGuard',
  },
  'src/endpoints/backups.js': {
    '/chat/delete': 'hostBulkMutationGuard',
  },
  'src/endpoints/data-maid.js': {
    '/delete': 'hostBulkMutationGuard',
  },
};

async function sourceFile(relative) {
  assert.ok(root, 'SILLYTAVERN_SOURCE_ROOT must point to the patched pinned checkout');
  return readFile(path.join(root, relative), 'utf8');
}

test('every reviewed per-user SillyTavern mutation route is guarded in the applied pinned source', {
  skip: !root,
}, async () => {
  let covered = 0;
  for (const [file, expectedRoutes] of Object.entries(routes)) {
    const source = await sourceFile(file);
    for (const [route, guard] of Object.entries(expectedRoutes)) {
      const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = source.match(new RegExp("router\\.post\\('" + escaped + "',([^\\n]*)"));
      assert.ok(match, file + ' is missing reviewed mutation route ' + route);
      assert.ok(match[1].includes(guard), file + ' ' + route + ' is not protected by ' + guard);
      covered++;
    }
  }
  assert.equal(covered, 58, 'the approved route inventory changed; review before updating coverage');
});

test('global Host-source and account mutations remain fail-closed while Host is enabled', {
  skip: !root,
}, async () => {
  const extensions = await sourceFile('src/endpoints/extensions.js');
  assert.ok(extensions.includes('HOST_EXTENSION_SOURCE_MUTATION_UNSUPPORTED'));
  for (const route of ['/install', '/update', '/switch', '/move', '/delete']) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = extensions.match(new RegExp("router\\.post\\('" + escaped + "',([^\\n]*)"));
    assert.ok(match && match[1].includes('hostSourceMutationGuard'), 'extension mutation is not blocked: ' + route);
  }

  const usersAdmin = await sourceFile('src/endpoints/users-admin.js');
  assert.ok(usersAdmin.includes('HOST_USER_ACCOUNT_MUTATION_UNSUPPORTED'));
  assert.ok(usersAdmin.includes("!['/get', '/slugify'].includes(request.path)"));

  const usersPrivate = await sourceFile('src/endpoints/users-private.js');
  assert.ok(usersPrivate.includes('HOST_USER_ROOT_RESET_UNSUPPORTED'));

  const groups = await sourceFile('src/endpoints/groups.js');
  assert.ok(groups.includes('Skipping unreceipted startup group metadata migration while Host inventory is enabled.'));
});
