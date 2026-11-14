import path from 'node:path';

/**
 * ST-VectorService server.js derives its SQLite filename as
 * path.join(STORAGE_DIR, 'vectors.sqlite'). Keep the Host enrollment path
 * identical so the secure VFS cannot be registered for a different file.
 */
export function assertVectorServiceDatabasePath(configuredDbPath, storageDirectory) {
  if (typeof configuredDbPath !== 'string' || !path.isAbsolute(configuredDbPath)) {
    throw new Error('LOGIC_ENGINE_VFS_ROLE_PATH must be the absolute Host-configured logical DB path');
  }

  const expectedDbPath = path.join(storageDirectory, 'vectors.sqlite');
  if (path.resolve(configuredDbPath) !== expectedDbPath) {
    throw new Error(
      `LOGIC_ENGINE_VFS_ROLE_PATH must exactly match ST-VectorService DB_PATH (${expectedDbPath}); refusing to protect a different database path.`,
    );
  }
  return expectedDbPath;
}
