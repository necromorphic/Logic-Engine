const Database = require(process.env.BETTER_SQLITE3_PACKAGE_DIR);
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.env.BETTER_SQLITE3_PACKAGE_DIR) {
  throw new Error('BETTER_SQLITE3_PACKAGE_DIR is required');
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'st-vectorservice-sqlite-'));
const databasePath = path.join(directory, 'vectors.sqlite');
let database;
try {
  database = new Database(databasePath);
  const row = database.prepare(
    'SELECT sqlite_version() AS version, sqlite_source_id() AS source_id',
  ).get();
  const compileOptions = database.pragma('compile_options').map(item => item.compile_options);
  database.pragma('journal_mode = WAL');
  const journalMode = database.pragma('journal_mode', { simple: true });
  database.pragma('temp_store = MEMORY');
  const tempStore = database.pragma('temp_store', { simple: true });

  console.log('better-sqlite3 Windows runtime', JSON.stringify({
    ...row, journalMode, tempStore, compileOptions,
  }, null, 2));

  if (row.version !== '3.53.4') throw new Error('Unexpected SQLite version');
  if (row.source_id !== '2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc') {
    throw new Error('Unexpected SQLite source ID');
  }
  if (journalMode !== 'wal' || tempStore !== 2) {
    throw new Error('Unexpected ST-VectorService SQLite PRAGMA behavior');
  }
} finally {
  if (database) database.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
