import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertVectorServiceDatabasePath } from './database-path-contract.mjs';

// This adapter speaks the Linux POSIX namespace-broker protocol. Do not let
// Windows fall through to process.getuid() or attempt to treat a Unix socket
// path as a Windows service endpoint. Windows needs its own service-backed
// manifest/lifecycle adapter before ST-VectorService can enable protected DBs.
if (process.platform !== 'linux' || typeof process.getuid !== 'function') {
  throw new Error(
    'ST-VectorService secure VFS bootstrap currently requires Linux POSIX broker support; Windows lifecycle integration is not available.',
  );
}

const serverEntry = process.env.LOGIC_ENGINE_ST_VECTOR_SERVER_ENTRY;
if (!serverEntry || !path.isAbsolute(serverEntry) || !fs.statSync(serverEntry).isFile()) {
  throw new Error('LOGIC_ENGINE_ST_VECTOR_SERVER_ENTRY must identify the absolute installed ST-VectorService server.js file');
}
const require = createRequire(serverEntry);
const packageRoot = process.env.BETTER_SQLITE3_PACKAGE_DIR;
const Database = require(packageRoot || 'better-sqlite3');

const storageRoot = path.resolve(process.env.ST_VECTOR_ROOT || process.cwd());
const storageDirectory = path.join(storageRoot, 'vector_storage');
const dbPath = process.env.LOGIC_ENGINE_VFS_ROLE_PATH;
const extensionPath = process.env.LOGIC_ENGINE_VFS_PROBE_PATH;
const brokerSocket = process.env.LOGIC_ENGINE_BROKER_SOCKET;
const roleName = process.env.LOGIC_ENGINE_VFS_ROLE_NAME;
const brokerUidText = process.env.LOGIC_ENGINE_BROKER_UID;

if (!extensionPath || !path.isAbsolute(extensionPath) || !fs.existsSync(extensionPath)) {
  throw new Error('LOGIC_ENGINE_VFS_PROBE_PATH must name the installed secure VFS extension');
}
assertVectorServiceDatabasePath(dbPath, storageDirectory);
if (!brokerSocket || !path.isAbsolute(brokerSocket)) {
  throw new Error('LOGIC_ENGINE_BROKER_SOCKET must name the configured broker socket');
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(roleName || '')) {
  throw new Error('LOGIC_ENGINE_VFS_ROLE_NAME is not a valid Host-configured broker role name');
}
if (!/^[1-9][0-9]*$/.test(brokerUidText || '')
    || !Number.isSafeInteger(Number(brokerUidText))
    || Number(brokerUidText) === process.getuid()) {
  throw new Error('LOGIC_ENGINE_BROKER_UID must be the distinct trusted broker service UID');
}

function assertBrokerOwnedAliasParent(directory) {
  const absolute = path.resolve(directory);
  const root = path.parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const info = fs.lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink()
        || (info.uid !== 0 && info.uid !== Number(brokerUidText))
        || (info.mode & 0o022) !== 0) {
      throw new Error('The logical DB alias parent chain must contain only broker/root-owned, non-group/world-writable directories');
    }
    try {
      fs.accessSync(current, fs.constants.W_OK);
      throw new Error('The application UID must not be able to mutate the logical DB alias parent chain');
    } catch (error) {
      if (error?.code !== 'EACCES' && error?.code !== 'EPERM' && error?.code !== 'EROFS') throw error;
    }
  }
  fs.accessSync(absolute, fs.constants.X_OK);
}

assertBrokerOwnedAliasParent(path.dirname(dbPath));

fs.mkdirSync(storageDirectory, { recursive: true });
const storageInfo = fs.lstatSync(storageDirectory);
if (!storageInfo.isDirectory() || storageInfo.isSymbolicLink()
    || (storageInfo.mode & 0o022) !== 0) {
  throw new Error('ST-VectorService vector_storage must be a real, non-group/world-writable directory');
}
try {
  fs.lstatSync(dbPath);
  throw new Error(
    'A local vectors.sqlite already exists. Stop ST-VectorService and migrate its data explicitly; refusing to shadow or adopt it.',
  );
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

// better-sqlite3 and this bootstrap must resolve the same native addon. Loading
// the extension through this in-memory handle registers its VFS for every later
// SQLite connection in this process before server.js constructs its DB handle.
const bootstrap = new Database(':memory:');
try {
  bootstrap.loadExtension(extensionPath, 'sqlite3_secure_vfs_probe_init');
} finally {
  bootstrap.close();
}

const registrar = new Database(':memory:');
try {
  const result = registrar.prepare(
    'SELECT logic_engine_vfs_probe_register_broker_role_from_host() AS registered',
  ).get();
  if (result.registered !== 1) {
    throw new Error('The SQLite broker did not confirm ST-VectorService role registration');
  }
} finally {
  registrar.close();
}

try {
  fs.lstatSync(dbPath);
  throw new Error('The logical vectors.sqlite alias appeared during broker registration');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

export { dbPath, storageDirectory };
