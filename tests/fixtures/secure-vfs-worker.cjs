const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');

if (!parentPort || !workerData
  || typeof workerData.extensionPath !== 'string'
  || typeof workerData.path !== 'string') {
  throw new Error('SECURE_VFS_WORKER_DATA_INVALID');
}

const bootstrap = new DatabaseSync(':memory:', { allowExtension: true });
try {
  bootstrap.loadExtension(workerData.extensionPath, 'sqlite3_secure_vfs_probe_init');
  bootstrap.enableLoadExtension(false);
} finally {
  bootstrap.close();
}

const openAndCreate = () => {
  const db = new DatabaseSync(workerData.path);
  try {
    db.exec('CREATE TABLE worker_probe(value TEXT);');
    return {
      openCount: db.prepare(
        'SELECT logic_engine_vfs_probe_open_count() AS count',
      ).get().count,
      sqliteVersion: db.prepare(
        'SELECT sqlite_version() AS version',
      ).get().version,
    };
  } finally {
    db.close();
  }
};

let result;
try {
  // Prefer a process-shared role if this Node build exposes one to workers.
  result = openAndCreate();
} catch (initialError) {
  // Some Node builds keep SQLite VFS role registries isolate-local. Enroll
  // the exact worker path in this worker's own registry before retrying.
  const localRegistry = new DatabaseSync(':memory:');
  try {
    const enrollment = localRegistry.prepare(
      'SELECT logic_engine_vfs_probe_register_database_role(?, ?) AS registered',
    ).get(workerData.path, 'worker');
    if (enrollment.registered !== 1) {
      throw new Error('Worker-local VFS role enrollment was not accepted', {
        cause: initialError,
      });
    }
    result = openAndCreate();
  } finally {
    localRegistry.close();
  }
}

parentPort.postMessage(result);
