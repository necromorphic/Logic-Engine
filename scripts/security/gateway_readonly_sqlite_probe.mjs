import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const [mode, dbPath, readyPath] = process.argv.slice(2);
assert.ok(['writer', 'reader'].includes(mode), 'mode must be writer or reader');
assert.ok(dbPath, 'database path is required');

if (mode === 'writer') {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  db.prepare('INSERT INTO probe(value) VALUES (?)').run('fixture');
  db.prepare('SELECT * FROM probe').all();
  assert.ok(existsSync(`${dbPath}-wal`), 'writer did not retain WAL');
  assert.ok(existsSync(`${dbPath}-shm`), 'writer did not retain SHM');
  writeFileSync(readyPath, 'ready', { encoding: 'utf8', flag: 'w' });
  await delay(90_000);
  db.close();
  process.exit(0);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare('SELECT value FROM probe').all();
assert.equal(rows[0]?.value, 'fixture', 'read-only SQLite query returned unexpected data');
assert.throws(
  () => db.prepare("INSERT INTO probe(value) VALUES ('must-not-write')").run(),
  /readonly|read.only|read-only/i,
  'read-only SQLite connection unexpectedly allowed INSERT',
);
db.close();

const directory = dbPath.slice(0, dbPath.lastIndexOf('\\'));
const sentinel = `${directory}\\sentinel-do-not-rename.txt`;
const expectDenied = (operation, action) => {
  try {
    action();
  } catch (error) {
    if (error?.code === 'EACCES' || error?.code === 'EPERM') return;
    throw error;
  }
  throw new Error(`SECURITY FAILURE: Gateway ${operation} succeeded in protected store directory`);
};
expectDenied('file creation', () => writeFileSync(`${directory}\\gateway-must-not-create.txt`, 'bad'));
expectDenied('rename', () => renameSync(sentinel, `${directory}\\sentinel-renamed.txt`));
expectDenied('delete', () => unlinkSync(sentinel));
assert.ok(existsSync(sentinel), 'test fixture sentinel missing');
console.log('PASS: node:sqlite readOnly SELECT succeeded with live WAL/SHM; SQL write denied; directory create/rename/delete denied.');
