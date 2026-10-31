import path from 'node:path';
import { withWindowsVssSnapshot } from './windows-vss-snapshot.mjs';
import {
  enumerateStableFileInventory,
  enumerateStableFileInventoryFromWindowsSnapshot,
} from './fs-inventory.js';
import {
  enumeratePinnedSillyTavernChatFiles,
  enumeratePinnedSillyTavernChatFilesFromWindowsSnapshot,
} from './st-source-inventory.mjs';

const fail = code => { throw new Error(code); };
const isWithin = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep)
    && relative !== '..' && !path.isAbsolute(relative));
};

function validateDirectories(directories) {
  if (!directories || typeof directories !== 'object' || Array.isArray(directories)
    || !['root', 'chats', 'groups', 'groupChats'].every(key =>
      typeof directories[key] === 'string' && path.isAbsolute(directories[key]))) {
    fail('HOST_DATA_DIRECTORIES_INVALID');
  }
  const root = path.resolve(directories.root);
  const normalized = {};
  for (const key of ['chats', 'groups', 'groupChats']) {
    const directory = path.resolve(directories[key]);
    const relative = path.relative(root, directory);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep)
      || path.isAbsolute(relative) || !isWithin(root, directory)) {
      fail('HOST_DATA_DIRECTORY_OUTSIDE_ROOT');
    }
    normalized[key] = directory;
  }
  return { root, directories: normalized };
}

export async function enumerateHostDataInventory({ directories, hostCommit }) {
  const validated = validateDirectories(directories);

  if (process.platform !== 'win32') {
    const filesystem = await enumerateStableFileInventory(validated.root);
    if (filesystem.status !== 'complete') fail(filesystem.code ?? 'HOST_DATA_FILESYSTEM_INVENTORY_NON_READY');
    const source = await enumeratePinnedSillyTavernChatFiles({
      directories: validated.directories,
      ...(hostCommit === undefined ? {} : { hostCommit }),
    });
    return {
      filesystem,
      source,
      snapshot_alignment: 'INDEPENDENT_DOUBLE_SCAN',
    };
  }

  return withWindowsVssSnapshot(validated.root, async lease => {
    const filesystem = await enumerateStableFileInventoryFromWindowsSnapshot(lease);
    if (filesystem.status !== 'complete') fail(filesystem.code ?? 'HOST_DATA_FILESYSTEM_INVENTORY_NON_READY');

    const snapshotDirectories = Object.fromEntries(
      Object.entries(validated.directories).map(([key, directory]) => [
        key,
        path.join(lease.snapshotRoot, path.relative(validated.root, directory)),
      ]),
    );
    const source = await enumeratePinnedSillyTavernChatFilesFromWindowsSnapshot({
      directories: snapshotDirectories,
      ...(hostCommit === undefined ? {} : { hostCommit }),
    }, lease);

    if (filesystem.snapshot_id !== lease.snapshotId || source.snapshot_id !== lease.snapshotId) {
      fail('HOST_DATA_SNAPSHOT_ALIGNMENT_FAILED');
    }
    return {
      filesystem,
      source,
      snapshot_alignment: 'SHARED_VSS_SNAPSHOT',
    };
  });
}
