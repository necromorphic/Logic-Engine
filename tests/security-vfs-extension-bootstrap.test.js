import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';

const extensionPath = process.env.LOGIC_ENGINE_VFS_PROBE_PATH;

test('Node 22.13 node:sqlite keeps a loadable default VFS registered after bootstrap closes', {
  // The full npm test suite runs in a separate job without the native probe artifact.
  // This test is exercised explicitly by the Linux/Windows VFS probe workflow jobs.
  skip: !extensionPath,
}, async (t) => {
  assert.equal(typeof extensionPath, 'string', 'workflow must build the platform VFS probe first');
  assert.equal(process.versions.node, '22.13.0', 'the private SQLite VFS ABI probe is pinned to Node 22.13.0');

  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-vfs-probe-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const bootstrap = new DatabaseSync(':memory:', { allowExtension: true });
  try {
    bootstrap.loadExtension(extensionPath, 'sqlite3_secure_vfs_probe_init');
    bootstrap.enableLoadExtension(false);
  } finally {
    bootstrap.close();
  }

  // Every file-backed main database must be registered before opening. The
  // in-memory registrar shares the extension's process-local role registry.
  const roleRegistrar = new DatabaseSync(':memory:');
  t.after(() => roleRegistrar.close());
  const registerRole = (rolePath, roleName) => roleRegistrar.prepare(
    'SELECT logic_engine_vfs_probe_register_database_role(?, ?) AS registered'
  ).get(rolePath, roleName);

  // Node worker threads must see the same process-default VFS and auto-extension
  // registration, or file-backed opens in a worker could bypass the identity gate.
  const workerPath = join(directory, 'worker.sqlite');
  const corePath = join(directory, 'core.sqlite');
  registerRole(workerPath, 'worker');
  registerRole(corePath, 'core-anchor');

  const unregisteredPath = join(directory, 'unregistered.sqlite');
  assert.throws(() => new DatabaseSync(unregisteredPath),
    'an unregistered file-backed main database must fail closed');
  assert.throws(
    () => roleRegistrar.prepare(
      'SELECT logic_engine_vfs_probe_delete_registered_role(?)'
    ).get(unregisteredPath),
    'an unregistered delete must not fall through to the parent VFS by pathname',
  );

  const workerResult = await new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const bootstrap = new DatabaseSync(':memory:', { allowExtension: true });
      try {
        bootstrap.loadExtension(workerData.extensionPath, 'sqlite3_secure_vfs_probe_init');
        bootstrap.enableLoadExtension(false);
      } finally {
        bootstrap.close();
      }
      const db = new DatabaseSync(workerData.path);
      let result;
      try {
        db.exec('CREATE TABLE worker_probe(value TEXT);');
        result = {
          openCount: db.prepare('SELECT logic_engine_vfs_probe_open_count() AS count').get().count,
          sqliteVersion: db.prepare('SELECT sqlite_version() AS version').get().version
        };
      } finally {
        db.close();
      }
      parentPort.postMessage(result);
    `, { eval: true, workerData: { extensionPath, path: workerPath } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`VFS worker exited with code ${code}`));
    });
  });
  assert.ok(workerResult.openCount > 0,
    'a worker thread must route its file-backed DatabaseSync through the registered VFS');
  assert.equal(workerResult.sqliteVersion, '3.47.2');

  const first = new DatabaseSync(corePath);
  let reader;
  try {
    assert.equal(first.prepare('SELECT sqlite_version() AS version').get().version, '3.47.2',
      'the native VFS ABI probe is pinned to the SQLite version bundled with Node 22.13.0');
    const openSyscall = process.platform === 'win32' ? 'CreateFileW' : 'open';
    assert.equal(
      first.prepare('SELECT logic_engine_vfs_probe_has_syscall(?) AS available').get(openSyscall).available,
      1,
      `the pinned ${process.platform} SQLite VFS must expose its native file-open syscall hook for feasibility review`
    );
    if (process.platform !== 'win32') {
      assert.equal(
        first.prepare('SELECT logic_engine_vfs_probe_has_syscall(?) AS available').get('stat').available,
        1,
        'the pinned Unix VFS must expose stat so reused file descriptors can be bound to a checked identity'
      );
    }
    assert.ok(
      first.prepare('SELECT logic_engine_vfs_probe_native_open_count() AS count').get().count > 0,
      'the native syscall wrapper must observe the actual OS file-open calls made by node:sqlite'
    );
    first.exec("CREATE TABLE probe(value TEXT);");
    assert.equal(
      first.prepare('SELECT logic_engine_vfs_probe_temp_file_class_rejected() AS rejected').get().rejected,
      1,
      'the VFS must reject SQLITE_OPEN_TEMP_DB before it can delegate to an unanchored parent path',
    );
    const journalMode = first.prepare("PRAGMA journal_mode=WAL").get().journal_mode;
    assert.equal(journalMode, "wal", "the registered VFS must permit WAL activation");
    first.exec("INSERT INTO probe VALUES('ok');");
    assert.equal(first.prepare('SELECT value FROM probe').get().value, 'ok');
    const opened = first.prepare('SELECT logic_engine_vfs_probe_open_count() AS count').get().count;
    assert.equal(opened, 2, 'the worker and Core file-backed DatabaseSync connections must pass through the registered VFS xOpen');
    assert.equal(
      first.prepare('SELECT logic_engine_vfs_probe_hook_protection() AS protected').get().protected,
      1,
      'the VFS must refuse attempts to replace its protected native open/delete or open/stat hooks'
    );

    // Keep a reader transaction open while the writer appends another WAL frame.
    // This makes the WAL and SHM sidecars observable before the connections close.
    reader = new DatabaseSync(corePath);
    reader.exec('BEGIN; SELECT value FROM probe;');
    first.exec("INSERT INTO probe VALUES('wal-sidecar');");
    assert.equal(existsSync(`${corePath}-wal`), true,
      'WAL sidecar must exist while concurrent connections are active');
    assert.equal(existsSync(`${corePath}-shm`), true,
      'SHM sidecar must exist while concurrent connections are active');
    assert.ok(
      first.prepare('SELECT logic_engine_vfs_probe_wal_open_count() AS count').get().count > 0,
      'the WAL sidecar must be opened through the registered VFS'
    );
    assert.ok(
      first.prepare('SELECT logic_engine_vfs_probe_sidecar_identity_check_count() AS count').get().count >= 2,
      'the actual WAL and SHM OS objects must be inspected and remain distinct from the Core database'
    );
    reader.exec('ROLLBACK;');
    reader.close();
    reader = undefined;
  } finally {
    reader?.close();
    first.close();
  }

  if (process.platform !== 'win32') {
    const writableParent = join(directory, 'writable-parent');
    mkdirSync(writableParent);
    chmodSync(writableParent, 0o777);
    assert.throws(
      () => registerRole(join(writableParent, 'blocked.sqlite'), 'writable-parent'),
      /database role identity capture failed/,
      'trusted role enrollment must reject a parent directory writable by other UIDs'
    );
  }

  // POSIX deletion must re-check the pinned directory policy at the
  // destructive boundary, not only when the database role is enrolled.
  if (process.platform !== 'win32') {
    const deletionParent = join(directory, 'delete-policy-parent');
    mkdirSync(deletionParent);
    const deletionPath = join(deletionParent, 'delete-policy.sqlite');
    registerRole(deletionPath, 'delete-policy-recheck');
    const deletionDb = new DatabaseSync(deletionPath);
    try {
      deletionDb.exec("PRAGMA journal_mode=DELETE; CREATE TABLE probe(value TEXT); BEGIN IMMEDIATE; INSERT INTO probe VALUES('pending');");
      assert.equal(existsSync(`${deletionPath}-journal`), true,
        'the rollback journal must exist before the directory policy changes');
      chmodSync(deletionParent, 0o777);
      assert.throws(() => deletionDb.exec('COMMIT;'),
        'POSIX xDelete must fail closed when the pinned parent becomes writable by other UIDs');
      assert.equal(existsSync(`${deletionPath}-journal`), true,
        'a rejected delete must leave the rollback journal in place');
    } finally {
      chmodSync(deletionParent, 0o700);
      deletionDb.close();
    }
  }

  if (process.platform !== 'win32') {
    const symlinkTarget = join(directory, 'symlink-target');
    const symlinkParent = join(directory, 'symlink-parent');
    mkdirSync(symlinkTarget);
    symlinkSync(symlinkTarget, symlinkParent, 'dir');
    assert.throws(
      () => registerRole(join(symlinkParent, 'blocked.sqlite'), 'symlink-parent'),
      /database (path could not be canonicalized|role identity capture failed)/,
      'trusted directory acquisition must reject a symlink in the parent path'
    );
  }

  let aliasPathOpenCountDelta = 0;
  // A registered DB opened through a symlinked parent alias must either
  // fail closed or keep later sidecars on the pinned parent if xFullPathname
  // resolves the alias to the exact enrolled role path.
  if (process.platform !== 'win32') {
    const canonicalParent = join(directory, 'canonical-alias-parent');
    const aliasParent = join(directory, 'canonical-alias-link');
    const movedCanonicalParent = join(directory, 'canonical-alias-moved');
    const canonicalDbPath = join(canonicalParent, 'alias.sqlite');
    mkdirSync(canonicalParent);
    symlinkSync(canonicalParent, aliasParent, 'dir');
    registerRole(canonicalDbPath, 'canonical-alias');
    const aliasOpenCountBefore = roleRegistrar.prepare(
      'SELECT logic_engine_vfs_probe_open_count() AS count'
    ).get().count;
    let aliasDb = null;
    try {
      aliasDb = new DatabaseSync(join(aliasParent, 'alias.sqlite'));
    } catch {
      // Rejection is acceptable when the parent VFS preserves the symlink path.
    }
    if (aliasDb) {
      try {
        aliasDb.exec('CREATE TABLE probe(value TEXT);');
        renameSync(canonicalParent, movedCanonicalParent);
        mkdirSync(canonicalParent);
        aliasDb.exec("PRAGMA journal_mode=WAL; INSERT INTO probe VALUES('anchored');");
        assert.equal(existsSync(join(movedCanonicalParent, 'alias.sqlite-wal')), true,
          'an accepted alias must create WAL beside the pinned DB after parent rename');
        assert.equal(existsSync(join(canonicalParent, 'alias.sqlite-wal')), false,
          'an accepted alias must not redirect WAL creation into the decoy parent');
        assert.equal(aliasDb.prepare('SELECT value FROM probe').get().value, 'anchored');
      } finally {
        aliasDb.close();
      }
    } else {
      assert.equal(existsSync(`${canonicalDbPath}-wal`), false,
        'a rejected alias open must not create a WAL sidecar');
      const canonicalDb = new DatabaseSync(canonicalDbPath);
      canonicalDb.close();
    }
    aliasPathOpenCountDelta = roleRegistrar.prepare(
      'SELECT logic_engine_vfs_probe_open_count() AS count'
    ).get().count - aliasOpenCountBefore;
  }

  // POSIX-only directory-anchor proof: after registration, rename the trusted
  // parent directory and replace its old pathname with a decoy directory. The
  // registered DB and its sidecars must continue to resolve through the pinned
  // directory descriptor, not through the attacker-controlled replacement.
  if (process.platform !== 'win32') {
    const anchoredParent = join(directory, 'anchored-parent');
    const movedParent = join(directory, 'anchored-parent-moved');
    mkdirSync(anchoredParent);
    const anchoredPath = join(anchoredParent, 'anchored.sqlite');
    registerRole(anchoredPath, 'directory-anchor');
    const seed = new DatabaseSync(anchoredPath);
    try {
      seed.exec("CREATE TABLE anchored_probe(value TEXT); INSERT INTO anchored_probe VALUES('trusted-directory');");
    } finally {
      seed.close();
    }

    renameSync(anchoredParent, movedParent);
    mkdirSync(anchoredParent);
    writeFileSync(join(anchoredParent, 'anchored.sqlite'), 'decoy database');

    const anchoredWriter = new DatabaseSync(anchoredPath);
    let anchoredReader;
    try {
      assert.equal(
        anchoredWriter.prepare('SELECT value FROM anchored_probe').get().value,
        'trusted-directory',
        'the main database must resolve through the pinned parent directory after its pathname is replaced'
      );
      anchoredWriter.exec('PRAGMA journal_mode=WAL;');
      anchoredReader = new DatabaseSync(anchoredPath);
      anchoredReader.exec('BEGIN; SELECT value FROM anchored_probe;');
      anchoredWriter.exec("INSERT INTO anchored_probe VALUES('anchored-sidecar');");
      assert.equal(
        existsSync(join(movedParent, 'anchored.sqlite-wal')),
        true,
        'WAL must be created beside the database in the pinned directory, not in the replacement directory'
      );
      assert.equal(
        existsSync(join(anchoredParent, 'anchored.sqlite-wal')),
        false,
        'the replacement directory must not receive the trusted database WAL'
      );
      assert.equal(
        existsSync(join(movedParent, 'anchored.sqlite-shm')),
        true,
        'SHM must also be created beside the database in the pinned directory'
      );
      assert.equal(
        existsSync(join(anchoredParent, 'anchored.sqlite-shm')),
        false,
        'the replacement directory must not receive the trusted database SHM'
      );
    } finally {
      anchoredReader?.exec('ROLLBACK;');
      anchoredReader?.close();
      anchoredWriter.close();
    }
  }

  // Windows VFS-level directory-anchor proof: xOpen, xAccess and xDelete
  // must continue resolving the trusted DB/journal under the pinned parent
  // HANDLE after the original pathname is replaced with a decoy directory.
  if (process.platform === 'win32') {
    const anchoredParent = join(directory, 'windows-anchored-parent');
    const movedParent = join(directory, 'windows-moved-parent');
    mkdirSync(anchoredParent);
    const anchoredPath = join(anchoredParent, 'anchored.sqlite');
    registerRole(anchoredPath, 'windows-directory-anchor');
    const seed = new DatabaseSync(anchoredPath);
    try {
      seed.exec("CREATE TABLE anchored_probe(value TEXT); INSERT INTO anchored_probe VALUES('trusted-windows-directory'); PRAGMA journal_mode=DELETE;");
    } finally {
      seed.close();
    }

    let parentRenamed = false;
    try {
      renameSync(anchoredParent, movedParent);
      parentRenamed = true;
    } catch (error) {
      // Some Windows runners/filesystems deny rename while the VFS retains
      // the pinned parent HANDLE. That is a fail-closed outcome: the attacker
      // cannot replace the checked pathname while the database role is open.
      assert.ok(['EPERM', 'EACCES', 'EBUSY'].includes(error?.code),
        'only an OS denial of parent rename is an acceptable fallback');
      assert.equal(existsSync(anchoredParent), true,
        'a denied rename must leave the original trusted parent in place');
      assert.equal(existsSync(movedParent), false,
        'a denied rename must not create a moved directory');
      mkdirSync(movedParent);
    }
    if (parentRenamed) {
      mkdirSync(anchoredParent);
      writeFileSync(join(anchoredParent, 'anchored.sqlite'), 'decoy database');
    }

    const anchoredDb = new DatabaseSync(anchoredPath);
    try {
      assert.equal(
        anchoredDb.prepare('SELECT value FROM anchored_probe').get().value,
        'trusted-windows-directory',
        'the Windows VFS must open the registered database, never a substituted object'
      );
      anchoredDb.exec("BEGIN IMMEDIATE; INSERT INTO anchored_probe VALUES('anchored-journal');");
      if (parentRenamed) {
        assert.equal(
          existsSync(join(movedParent, 'anchored.sqlite-journal')),
          true,
          'the rollback journal must be created beside the trusted database after parent rename'
        );
        assert.equal(
          existsSync(join(anchoredParent, 'anchored.sqlite-journal')),
          false,
          'the replacement directory must not receive the trusted rollback journal'
        );
      } else {
        assert.equal(
          existsSync(join(anchoredParent, 'anchored.sqlite-journal')),
          true,
          'when Windows denies parent rename, the trusted path remains the only possible journal target'
        );
      }
      anchoredDb.exec('COMMIT;');
      assert.equal(
        existsSync(join(parentRenamed ? movedParent : anchoredParent, 'anchored.sqlite-journal')),
        false,
        'Windows xDelete must remove the exact trusted rollback-journal object'
      );
      if (parentRenamed) {
        assert.equal(
          existsSync(join(anchoredParent, 'anchored.sqlite-journal')),
          false,
          'Windows xDelete must not operate on the replacement pathname'
        );
      }
    } finally {
      anchoredDb.close();
    }
  }

  // Windows must reject a sidecar hardlink alias to another role's live sidecar.
  if (process.platform === 'win32') {
    const sidecarOwnerPath = join(directory, 'sidecar-owner.sqlite');
    const sidecarVictimPath = join(directory, 'sidecar-victim.sqlite');
    registerRole(sidecarOwnerPath, 'sidecar-owner');
    registerRole(sidecarVictimPath, 'sidecar-victim');
    const sidecarOwner = new DatabaseSync(sidecarOwnerPath);
    const sidecarVictim = new DatabaseSync(sidecarVictimPath);
    try {
      sidecarOwner.exec("PRAGMA journal_mode=DELETE; CREATE TABLE probe(value TEXT); BEGIN IMMEDIATE; INSERT INTO probe VALUES('owner');");
      assert.equal(existsSync(`${sidecarOwnerPath}-journal`), true,
        'the owner rollback journal must remain live while the transaction is open');
      const ownerJournalSize = statSync(`${sidecarOwnerPath}-journal`).size;
      sidecarVictim.exec('PRAGMA journal_mode=DELETE; CREATE TABLE probe(value TEXT);');
      const rejectedBefore = sidecarOwner.prepare(
        'SELECT logic_engine_vfs_probe_sidecar_identity_reject_count() AS count'
      ).get().count;
      linkSync(`${sidecarOwnerPath}-journal`, `${sidecarVictimPath}-journal`);
      assert.throws(() => sidecarVictim.exec(
        "BEGIN IMMEDIATE; INSERT INTO probe VALUES('victim');"
      ), 'a sidecar hardlink alias owned by another role must fail closed');
      assert.ok(sidecarOwner.prepare(
        'SELECT logic_engine_vfs_probe_sidecar_identity_reject_count() AS count'
      ).get().count > rejectedBefore,
      'the Windows sidecar identity registry must record the cross-role alias rejection');
      assert.equal(statSync(`${sidecarOwnerPath}-journal`).size, ownerJournalSize,
        'rejected Windows sidecar aliases must not be truncated before identity validation');
    } finally {
      try { sidecarVictim.close(); } catch { /* rejected sidecar open may leave a transaction active */ }
      try { sidecarOwner.exec('ROLLBACK;'); } catch { /* cleanup after deliberate rejection */ }
      sidecarOwner.close();
      try { unlinkSync(`${sidecarVictimPath}-journal`); } catch { /* link may not have been created */ }
    }
  }

  // POSIX must reject a rollback-journal hardlink alias to another role's live sidecar.
  if (process.platform !== 'win32') {
    const sidecarOwnerPath = join(directory, 'posix-sidecar-owner.sqlite');
    const sidecarVictimPath = join(directory, 'posix-sidecar-victim.sqlite');
    registerRole(sidecarOwnerPath, 'posix-sidecar-owner');
    registerRole(sidecarVictimPath, 'posix-sidecar-victim');
    const sidecarOwner = new DatabaseSync(sidecarOwnerPath);
    const sidecarVictim = new DatabaseSync(sidecarVictimPath);
    try {
      sidecarOwner.exec("PRAGMA journal_mode=DELETE; CREATE TABLE probe(value TEXT); BEGIN IMMEDIATE; INSERT INTO probe VALUES('owner');");
      assert.equal(existsSync(`${sidecarOwnerPath}-journal`), true,
        'the POSIX owner rollback journal must remain live during its transaction');
      const ownerJournalSize = statSync(`${sidecarOwnerPath}-journal`).size;
      sidecarVictim.exec('PRAGMA journal_mode=DELETE; CREATE TABLE probe(value TEXT);');
      const rejectedBefore = sidecarOwner.prepare(
        'SELECT logic_engine_vfs_probe_sidecar_identity_reject_count() AS count'
      ).get().count;
      linkSync(`${sidecarOwnerPath}-journal`, `${sidecarVictimPath}-journal`);
      assert.throws(() => sidecarVictim.exec(
        "BEGIN IMMEDIATE; INSERT INTO probe VALUES('victim');"
      ), 'a POSIX sidecar hardlink alias owned by another role must fail closed');
      assert.ok(sidecarOwner.prepare(
        'SELECT logic_engine_vfs_probe_sidecar_identity_reject_count() AS count'
      ).get().count > rejectedBefore,
      'the POSIX sidecar registry must record the cross-role alias rejection');
      assert.equal(statSync(`${sidecarOwnerPath}-journal`).size, ownerJournalSize,
        'rejected POSIX sidecar aliases must not be truncated before identity validation');
    } finally {
      try { sidecarVictim.close(); } catch { /* rejected sidecar open may leave a transaction active */ }
      try { sidecarOwner.exec('ROLLBACK;'); } catch { /* cleanup after deliberate rejection */ }
      sidecarOwner.close();
      try { unlinkSync(`${sidecarVictimPath}-journal`); } catch { /* link may not have been created */ }
    }
  }

  // Deleting a sidecar pathname must not release ownership while a hardlink
  // keeps the same physical object alive. Otherwise a later role can adopt
  // the old role's journal identity after xDelete removes the original name.
  {
    const retiredOwnerPath = join(directory, 'retired-sidecar-owner.sqlite');
    const retiredVictimPath = join(directory, 'retired-sidecar-victim.sqlite');
    const retainedAliasPath = join(directory, 'retired-owner-journal-alias');
    registerRole(retiredOwnerPath, 'retired-sidecar-owner');
    registerRole(retiredVictimPath, 'retired-sidecar-victim');
    const retiredOwner = new DatabaseSync(retiredOwnerPath);
    const retiredVictim = new DatabaseSync(retiredVictimPath);
    try {
      retiredOwner.exec("PRAGMA journal_mode=DELETE; CREATE TABLE probe(value TEXT); BEGIN IMMEDIATE; INSERT INTO probe VALUES('owner');");
      assert.equal(existsSync(`${retiredOwnerPath}-journal`), true,
        'the owner journal must exist before its identity is retained by a hardlink');
      linkSync(`${retiredOwnerPath}-journal`, retainedAliasPath);
      retiredOwner.exec('COMMIT;');
      assert.equal(existsSync(`${retiredOwnerPath}-journal`), false,
        'xDelete must remove the owner journal pathname');
      assert.equal(existsSync(retainedAliasPath), true,
        'the hardlink must keep the original journal object alive after xDelete');
      retiredOwner.exec("BEGIN IMMEDIATE; INSERT INTO probe VALUES('owner-again');");
      assert.equal(existsSync(`${retiredOwnerPath}-journal`), true,
        'the original role must be allowed to create a new journal generation while its old hardlinked object remains retired');
      retiredOwner.exec('ROLLBACK;');
      retiredVictim.exec('PRAGMA journal_mode=DELETE; CREATE TABLE probe(value TEXT);');
      linkSync(retainedAliasPath, `${retiredVictimPath}-journal`);
      const rejectedBefore = roleRegistrar.prepare(
        'SELECT logic_engine_vfs_probe_sidecar_identity_reject_count() AS count'
      ).get().count;
      assert.throws(() => retiredVictim.exec(
        "BEGIN IMMEDIATE; INSERT INTO probe VALUES('victim');"
      ), 'a retired sidecar object must remain owned by its original role while any hardlink survives');
      assert.ok(roleRegistrar.prepare(
        'SELECT logic_engine_vfs_probe_sidecar_identity_reject_count() AS count'
      ).get().count > rejectedBefore,
      'the sidecar registry must reject adoption of a deleted-but-still-linked object');
    } finally {
      try { retiredVictim.close(); } catch { /* deliberate sidecar rejection may leave a transaction active */ }
      retiredOwner.close();
      try { unlinkSync(`${retiredVictimPath}-journal`); } catch { /* cleanup */ }
      try { unlinkSync(retainedAliasPath); } catch { /* cleanup */ }
    }
  }

  // POSIX xDelete must refuse to delete a replacement object at a registered main-DB path.
  if (process.platform !== 'win32') {
    const deleteMainPath = join(directory, 'delete-main.sqlite');
    assert.equal(registerRole(deleteMainPath, 'delete-main').registered, 1,
      'the main-delete test role must be enrolled before its first open');
    const deleteMainDb = new DatabaseSync(deleteMainPath);
    try {
      deleteMainDb.exec('CREATE TABLE probe(value TEXT);');
    } finally {
      deleteMainDb.close();
    }
    assert.equal(existsSync(deleteMainPath), true);
    assert.equal(roleRegistrar.prepare(
      'SELECT logic_engine_vfs_probe_delete_registered_role(?) AS deleted'
    ).get(deleteMainPath).deleted, 1);
    assert.equal(existsSync(deleteMainPath), false,
      'xDelete must remove the enrolled main DB when its identity matches');

    const deleteAliasPath = join(directory, 'delete-main-alias.sqlite');
    assert.equal(registerRole(deleteAliasPath, 'delete-main-alias').registered, 1,
      'the main-delete alias test role must be enrolled before its first open');
    const deleteAliasDb = new DatabaseSync(deleteAliasPath);
    try {
      deleteAliasDb.exec('CREATE TABLE probe(value TEXT);');
    } finally {
      deleteAliasDb.close();
    }
    unlinkSync(deleteAliasPath);
    linkSync(corePath, deleteAliasPath);
    assert.throws(() => roleRegistrar.prepare(
      'SELECT logic_engine_vfs_probe_delete_registered_role(?)'
    ).get(deleteAliasPath),
    'xDelete must reject a hardlink replacement instead of deleting another role DB');
    assert.equal(existsSync(deleteAliasPath), true,
      'a rejected main-DB deletion must leave the replacement hardlink intact');
    assert.equal(existsSync(corePath), true,
      'a rejected main-DB deletion must leave the other role database intact');
  }

  // Windows main-DB xDelete must reject a substituted hardlink by handle identity.
  if (process.platform === 'win32') {
    const deleteAliasPath = join(directory, 'windows-delete-main-alias.sqlite');
    assert.equal(registerRole(deleteAliasPath, 'windows-delete-main-alias').registered, 1,
      'the Windows main-delete alias test role must be enrolled before its first open');
    const deleteAliasDb = new DatabaseSync(deleteAliasPath);
    try {
      deleteAliasDb.exec('CREATE TABLE probe(value TEXT);');
    } finally {
      deleteAliasDb.close();
    }
    unlinkSync(deleteAliasPath);
    linkSync(corePath, deleteAliasPath);
    assert.throws(() => roleRegistrar.prepare(
      'SELECT logic_engine_vfs_probe_delete_registered_role(?)'
    ).get(deleteAliasPath),
    'Windows xDelete must reject a hardlink replacement instead of deleting another role DB');
    assert.equal(existsSync(corePath), true,
      'a rejected Windows main-DB deletion must leave the other role database intact');
  }

  // Exercise the rollback-journal sidecar independently of WAL mode.
  const journalPath = join(directory, 'journal.sqlite');
  registerRole(journalPath, 'journal-test');
  const journalDb = new DatabaseSync(journalPath);
  const sidecarChecksBeforeJournal = journalDb.prepare(
    'SELECT logic_engine_vfs_probe_sidecar_identity_check_count() AS count'
  ).get().count;
  try {
    journalDb.exec("PRAGMA journal_mode=DELETE; CREATE TABLE probe(value TEXT); BEGIN IMMEDIATE; INSERT INTO probe VALUES('pending');");
    assert.equal(existsSync(`${journalPath}-journal`), true,
      'rollback journal sidecar must exist before the transaction commits');
    assert.ok(
      journalDb.prepare('SELECT logic_engine_vfs_probe_journal_open_count() AS count').get().count > 0,
      'the rollback journal must be opened through the registered VFS'
    );
    assert.ok(
      journalDb.prepare('SELECT logic_engine_vfs_probe_sidecar_identity_check_count() AS count').get().count
        > sidecarChecksBeforeJournal,
      'the rollback-journal OS object must be inspected and remain distinct from registered databases'
    );
    journalDb.exec('ROLLBACK;');
  } finally {
    journalDb.close();
  }

  // A rollback-journal replacement is rejected at the sidecar open boundary.
  const journalRacePath = join(directory, 'journal-race.sqlite');
  registerRole(journalRacePath, 'journal-race');
  const journalRaceDb = new DatabaseSync(journalRacePath);
  try {
    journalRaceDb.exec('PRAGMA journal_mode=DELETE; CREATE TABLE probe(value TEXT);');
    const injectionBefore = roleRegistrar.prepare(
      'SELECT logic_engine_vfs_probe_race_injection_count() AS count'
    ).get().count;
    const sidecarRejectBefore = roleRegistrar.prepare(
      'SELECT logic_engine_vfs_probe_sidecar_identity_reject_count() AS count'
    ).get().count;
    roleRegistrar.prepare('SELECT logic_engine_vfs_probe_configure_race(?, ?, 1)')
      .get(`${journalRacePath}-journal`, corePath);
    assert.throws(() => journalRaceDb.exec(
      "BEGIN IMMEDIATE; INSERT INTO probe VALUES('journal-race');"
    ), 'a rollback-journal hardlink to another registered database must fail closed');
    assert.equal(roleRegistrar.prepare(
      'SELECT logic_engine_vfs_probe_race_injection_count() AS count'
    ).get().count, injectionBefore + 1);
    assert.ok(roleRegistrar.prepare(
      'SELECT logic_engine_vfs_probe_sidecar_identity_reject_count() AS count'
    ).get().count > sidecarRejectBefore);
  } finally {
    try { journalRaceDb.close(); } catch { /* failed journal open may leave a transaction active */ }
  }

  // SHM is opened through xShmMap rather than xOpen. The syscall wrapper
  // must still recognize the -shm path and reject a replacement at that boundary.
  const shmRacePath = join(directory, 'shm-race.sqlite');
  registerRole(shmRacePath, 'shm-race');
  const shmRaceDb = new DatabaseSync(shmRacePath);
  try {
    shmRaceDb.exec('PRAGMA journal_mode=DELETE; CREATE TABLE probe(value TEXT);');
    const injectionBefore = roleRegistrar.prepare(
      'SELECT logic_engine_vfs_probe_race_injection_count() AS count'
    ).get().count;
    const sidecarRejectBefore = roleRegistrar.prepare(
      'SELECT logic_engine_vfs_probe_sidecar_identity_reject_count() AS count'
    ).get().count;
    roleRegistrar.prepare('SELECT logic_engine_vfs_probe_configure_race(?, ?, 1)')
      .get(`${shmRacePath}-shm`, corePath);
    let rejected = false;
    try {
      const mode = shmRaceDb.prepare('PRAGMA journal_mode=WAL').get();
      if (mode.journal_mode === 'wal') {
        shmRaceDb.exec("BEGIN IMMEDIATE; INSERT INTO probe VALUES('shm-race');");
      }
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true,
      'a SHM sidecar hardlinked to another registered database must fail closed');
    assert.equal(roleRegistrar.prepare(
      'SELECT logic_engine_vfs_probe_race_injection_count() AS count'
    ).get().count, injectionBefore + 1);
    assert.ok(roleRegistrar.prepare(
      'SELECT logic_engine_vfs_probe_sidecar_identity_reject_count() AS count'
    ).get().count > sidecarRejectBefore);
  } finally {
    try { shmRaceDb.close(); } catch { /* failed SHM open may leave a transaction active */ }
  }

  const coordinatorControlPath = join(directory, 'coordinator.sqlite');
  registerRole(coordinatorControlPath, 'coordinator-control');
  const second = new DatabaseSync(coordinatorControlPath);
  try {
    second.exec('CREATE TABLE probe(value TEXT);');
    const opened = second.prepare('SELECT logic_engine_vfs_probe_open_count() AS count').get().count;
    const expectedOpenCount = (process.platform === 'win32' ? 14 : 17) + aliasPathOpenCountDelta;
    assert.equal(opened, expectedOpenCount,
      'the VFS must remain registered across worker, Core, reader, journal, journal-race, SHM-race, coordinator and Windows/POSIX directory-anchor connections');

    // Establish the expected OS identity, then replace the path with a hardlink
    // after SQLite has reached xOpen but immediately before the native OS open.
    const aliasPath = join(directory, 'alias.sqlite');
    registerRole(aliasPath, 'alias-target');
    const aliasDb = new DatabaseSync(aliasPath);
    try {
      aliasDb.exec('CREATE TABLE alias(value TEXT);');

      // Registration captures and pins the expected identity before SQLite's
      // first open. Replacing the path in that interval must still be rejected.
      const preopenRacePath = join(directory, 'preopen-race.sqlite');
      registerRole(preopenRacePath, 'preopen-race');
      unlinkSync(preopenRacePath);
      linkSync(aliasPath, preopenRacePath);
      assert.throws(() => new DatabaseSync(preopenRacePath),
        'a path replaced after trusted registration but before first SQLite open must fail closed');

      const racePath = join(directory, 'race.sqlite');
      registerRole(racePath, 'race-target');
      second.prepare('SELECT logic_engine_vfs_probe_configure_race(?, ?, 0)')
        .get(racePath, aliasPath);
      const baseline = new DatabaseSync(racePath);
      try {
        baseline.exec('CREATE TABLE baseline(value TEXT);');
      } finally {
        baseline.close();
      }

      const raceInjectionBeforeMain = second.prepare(
        'SELECT logic_engine_vfs_probe_race_injection_count() AS count'
      ).get().count;
      second.prepare('SELECT logic_engine_vfs_probe_configure_race(?, ?, 1)')
        .get(racePath, aliasPath);
      assert.throws(() => new DatabaseSync(racePath),
        'opening a database path replaced by a hardlink to another database must fail closed');
      assert.equal(
        second.prepare('SELECT logic_engine_vfs_probe_race_injection_count() AS count').get().count,
        raceInjectionBeforeMain + 1,
        'the deterministic replacement must occur exactly once inside the VFS open boundary'
      );
      assert.ok(
        second.prepare('SELECT logic_engine_vfs_probe_identity_reject_count() AS count').get().count > 0,
        'the OS handle identity check must reject the substituted hardlink'
      );
    } finally {
      aliasDb.close();
    }

    // Register the three persistent database roles used by the integration.
    const roleCorePath = join(directory, 'role-core.sqlite');
    const roleCoordinatorPath = join(directory, 'role-coordinator.sqlite');
    const roleHostLedgerPath = join(directory, 'role-host-ledger.sqlite');
    const concurrentRolePaths = [
      [join(directory, 'concurrent-a.sqlite'), 'concurrent-a'],
      [join(directory, 'concurrent-b.sqlite'), 'concurrent-b'],
    ];
    for (const [rolePath, roleName] of [
      [roleCorePath, 'core'],
      [roleCoordinatorPath, 'coordinator'],
      [roleHostLedgerPath, 'host-ledger'],
      ...concurrentRolePaths,
    ]) {
      second.prepare('SELECT logic_engine_vfs_probe_register_database_role(?, ?) AS registered')
        .get(rolePath, roleName);
    }
    const registrationAliasPath = join(directory, 'registration-alias.sqlite');
    linkSync(roleCorePath, registrationAliasPath);
    assert.throws(
      () => registerRole(registrationAliasPath, 'duplicate-core'),
      /database role identity is already registered/,
      'one OS file identity must not be registered under two database roles',
    );

    // Two workers cross a barrier and concurrently establish first-open
    // identities for two roles. The registry mutex must serialize the updates.
    const openBarrier = new SharedArrayBuffer(4);
    const concurrentResults = await Promise.all(concurrentRolePaths.map(([rolePath]) =>
      new Promise((resolve, reject) => {
        const worker = new Worker(`
          const { parentPort, workerData } = require('node:worker_threads');
          const { DatabaseSync } = require('node:sqlite');
          const gate = new Int32Array(workerData.barrier);
          Atomics.add(gate, 0, 1);
          Atomics.notify(gate, 0);
          while (Atomics.load(gate, 0) < 2) {
            if (Atomics.wait(gate, 0, 1, 10000) === 'timed-out') {
              throw new Error('concurrent VFS worker barrier timed out');
            }
          }
          const db = new DatabaseSync(workerData.path);
          try {
            db.exec('CREATE TABLE concurrent_probe(value INTEGER); INSERT INTO concurrent_probe VALUES(1);');
            parentPort.postMessage(db.prepare('SELECT value FROM concurrent_probe').get().value);
          } finally {
            db.close();
          }
        `, { eval: true, workerData: { path: rolePath, barrier: openBarrier } });
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', (code) => {
          if (code !== 0) reject(new Error(`Concurrent VFS worker exited with code ${code}`));
        });
      })
    ));
    assert.deepEqual(concurrentResults, [1, 1]);

    const roleCoreDb = new DatabaseSync(roleCorePath);
    const roleCoordinatorDb = new DatabaseSync(roleCoordinatorPath);
    try {
      roleCoreDb.exec('CREATE TABLE role_data(value TEXT);');
      roleCoordinatorDb.exec('CREATE TABLE role_data(value TEXT);');
      const roleHostDb = new DatabaseSync(roleHostLedgerPath);
      try {
        roleHostDb.exec('CREATE TABLE role_data(value TEXT);');
      } finally {
        roleHostDb.close();
      }

      const rejectsBeforeAliases = second.prepare(
        'SELECT logic_engine_vfs_probe_identity_reject_count() AS count'
      ).get().count;
      const roleHostBackupPath = `${roleHostLedgerPath}.original`;
      renameSync(roleHostLedgerPath, roleHostBackupPath);
      try {
        linkSync(roleCorePath, roleHostLedgerPath);
        assert.throws(() => new DatabaseSync(roleHostLedgerPath),
          'Host ledger must not open a hardlink alias of Core');
        unlinkSync(roleHostLedgerPath);
        linkSync(roleCoordinatorPath, roleHostLedgerPath);
        assert.throws(() => new DatabaseSync(roleHostLedgerPath),
          'Host ledger must not open a hardlink alias of Coordinator');
        assert.ok(
          second.prepare('SELECT logic_engine_vfs_probe_identity_reject_count() AS count').get().count
            >= rejectsBeforeAliases + 2,
          'the opened OS identities must reject aliases to both other database roles'
        );
      } finally {
        if (existsSync(roleHostLedgerPath)) unlinkSync(roleHostLedgerPath);
        renameSync(roleHostBackupPath, roleHostLedgerPath);
      }

      if (process.platform !== 'win32') {
        const reusePath = join(directory, 'reuse.sqlite');
        second.prepare('SELECT logic_engine_vfs_probe_register_database_role(?, ?) AS registered')
          .get(reusePath, 'descriptor-reuse');
        const reuseA = new DatabaseSync(reusePath);
        let reuseB;
        try {
          reuseA.exec('CREATE TABLE reuse_data(value INTEGER); INSERT INTO reuse_data VALUES(1);');
          reuseA.exec('BEGIN; SELECT value FROM reuse_data;');
          reuseB = new DatabaseSync(reusePath);
          reuseB.exec('BEGIN; SELECT value FROM reuse_data;');
          reuseB.close();
          reuseB = undefined;

          const reuseCountBefore = second.prepare(
            'SELECT logic_engine_vfs_probe_reused_descriptor_accept_count() AS count'
          ).get().count;
          const reuseC = new DatabaseSync(reusePath);
          try {
            assert.equal(reuseC.prepare('SELECT value FROM reuse_data').get().value, 1);
          } finally {
            reuseC.close();
          }
          assert.ok(
            second.prepare('SELECT logic_engine_vfs_probe_reused_descriptor_accept_count() AS count').get().count
              > reuseCountBefore,
            'SQLite must reuse the pending descriptor only after the stat identity matches the registered role'
          );
        } finally {
          reuseB?.close();
          reuseA.exec('ROLLBACK;');
          reuseA.close();
        }
      }

      // The WAL sidecar itself must not be substituted with a hardlink to Core.
      const sidecarRacePath = join(directory, 'sidecar-race.sqlite');
      second.prepare('SELECT logic_engine_vfs_probe_register_database_role(?, ?) AS registered')
        .get(sidecarRacePath, 'sidecar-race');
      const raceInjectionBeforeWal = second.prepare(
        'SELECT logic_engine_vfs_probe_race_injection_count() AS count'
      ).get().count;
      second.prepare('SELECT logic_engine_vfs_probe_configure_race(?, ?, 1)')
        .get(`${sidecarRacePath}-wal`, roleCorePath);
      const sidecarRaceDb = new DatabaseSync(sidecarRacePath);
      try {
        assert.throws(() => sidecarRaceDb.exec(
          "PRAGMA journal_mode=WAL; CREATE TABLE probe(value TEXT); INSERT INTO probe VALUES('race');"
        ), 'a WAL sidecar hardlinked to the Core database must fail closed');
      } finally {
        sidecarRaceDb.close();
      }
      assert.equal(
        second.prepare('SELECT logic_engine_vfs_probe_race_injection_count() AS count').get().count,
        raceInjectionBeforeWal + 1,
        'the WAL sidecar replacement race must be injected exactly once'
      );
      assert.ok(
        second.prepare('SELECT logic_engine_vfs_probe_sidecar_identity_reject_count() AS count').get().count > 0,
        'the native sidecar identity check must reject the WAL-to-Core hardlink'
      );
    } finally {
      roleCoordinatorDb.close();
      roleCoreDb.close();
    }
  } finally {
    second.close();
  }

  // SQLite 3.47.2 bypasses VFS xDelete for WAL SHM cleanup on both
  // platforms: Windows winShmPurge() calls winDelete()/DeleteFileW directly;
  // Unix unixShmUnmap() calls osUnlink()/unlink directly. Both syscall paths
  // must route through the role/sidecar identity checks.
  if (process.platform === 'win32' || process.platform === 'linux') {
    const deleteHookPath = join(directory, 'sidecar-delete-hook.sqlite');
    registerRole(deleteHookPath, 'sidecar-delete-hook');
    const hookDb = new DatabaseSync(deleteHookPath);
    try {
      hookDb.exec('PRAGMA journal_mode=WAL; CREATE TABLE hook_probe(value INTEGER); INSERT INTO hook_probe VALUES(1);');
      hookDb.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      hookDb.prepare('PRAGMA journal_mode=DELETE').get();
    } finally {
      hookDb.close();
    }
    if (process.platform === 'win32') {
      assert.ok(
        roleRegistrar.prepare('SELECT logic_engine_vfs_probe_delete_file_hook_count() AS count').get().count > 0,
        'the internal Windows SHM deletion path must route through the handle-relative DeleteFileW hook',
      );
    } else {
      assert.ok(
        roleRegistrar.prepare('SELECT logic_engine_vfs_probe_unlink_hook_count() AS count').get().count > 0,
        'the internal POSIX SHM deletion path must route through the identity-checked unlink hook',
      );
    }
  }

  // Cross-process SQLite locking must remain effective when each process
  // independently loads the secure-open probe and registers the same role.
  const lockPath = join(directory, 'cross-process-lock.sqlite');
  registerRole(lockPath, 'cross-process-lock-parent');
  const lockOwner = new DatabaseSync(lockPath);
  try {
    lockOwner.exec('CREATE TABLE lock_probe(value INTEGER); BEGIN IMMEDIATE;');
    const lockChild = `
      const { DatabaseSync } = require('node:sqlite');
      const bootstrap = new DatabaseSync(':memory:', { allowExtension: true });
      bootstrap.loadExtension(process.env.LOGIC_ENGINE_VFS_PROBE_PATH, 'sqlite3_secure_vfs_probe_init');
      bootstrap.enableLoadExtension(false);
      bootstrap.close();
      const registry = new DatabaseSync(':memory:');
      registry.prepare('SELECT logic_engine_vfs_probe_register_database_role(?, ?)').get(process.argv[1], 'cross-process-lock-child');
      const db = new DatabaseSync(process.argv[1]);
      db.exec('PRAGMA busy_timeout=100;');
      try {
        db.exec('BEGIN IMMEDIATE;');
        process.stderr.write('unexpected lock acquisition\\n');
        process.exitCode = 3;
      } catch (error) {
        if (!/locked|busy/i.test(String(error.message))) {
          process.stderr.write(String(error.stack || error) + '\\n');
          process.exitCode = 4;
        } else {
          process.stdout.write('LOCKED\\n');
        }
      } finally {
        try { db.exec('ROLLBACK;'); } catch {}
        db.close();
        registry.close();
      }
    `;
    const lockResult = spawnSync(process.execPath, ['-e', lockChild, lockPath], {
      encoding: 'utf8',
      env: process.env,
      timeout: 10000,
    });
    assert.equal(lockResult.status, 0, lockResult.stderr || lockResult.stdout);
    assert.match(lockResult.stdout, /LOCKED/,
      'a second process must not acquire BEGIN IMMEDIATE while the first process holds the writer lock');
  } finally {
    try { lockOwner.exec('ROLLBACK;'); } catch {}
    lockOwner.close();
  }

  // Simulate process death after WAL pages are written but before COMMIT.
  // SQLite must ignore the uncommitted frames and recover the committed row.
  const crashPath = join(directory, 'wal-crash-recovery.sqlite');
  registerRole(crashPath, 'wal-crash-recovery');
  const seed = new DatabaseSync(crashPath);
  try {
    seed.exec('PRAGMA journal_mode=WAL; CREATE TABLE crash_probe(value TEXT); INSERT INTO crash_probe VALUES(\'committed\');');
  } finally {
    seed.close();
  }
  const crashChild = `
    const fs = require('node:fs');
    const { DatabaseSync } = require('node:sqlite');
    const bootstrap = new DatabaseSync(':memory:', { allowExtension: true });
    bootstrap.loadExtension(process.env.LOGIC_ENGINE_VFS_PROBE_PATH, 'sqlite3_secure_vfs_probe_init');
    bootstrap.enableLoadExtension(false);
    bootstrap.close();
    const registry = new DatabaseSync(':memory:');
    registry.prepare('SELECT logic_engine_vfs_probe_register_database_role(?, ?)').get(process.argv[1], 'wal-crash-recovery-child');
    const db = new DatabaseSync(process.argv[1]);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA cache_size=1; BEGIN IMMEDIATE;');
    const insert = db.prepare('INSERT INTO crash_probe(value) VALUES (?)');
    for (let i = 0; i < 256; i += 1) {
      insert.run('uncommitted-after-crash-' + i + '-' + 'x'.repeat(512));
    }
    fs.writeSync(1, 'READY\\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
  `;
  const child = spawn(process.execPath, ['-e', crashChild, crashPath], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOutput = '';
  const ready = new Promise((resolve, reject) => {
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      childOutput += chunk;
      if (childOutput.includes('READY')) resolve();
    });
    child.stderr.on('data', (chunk) => { childOutput += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (!childOutput.includes('READY')) {
        reject(new Error(`WAL crash child exited before writing: code=${code}, signal=${signal}, output=${childOutput}`));
      }
    });
  });
  await ready;
  assert.ok(statSync(`${crashPath}-wal`).size > 32,
    'the killed writer must have emitted WAL frames before the transaction commit marker');
  const childExit = once(child, 'exit');
  child.kill('SIGKILL');
  await childExit;
  // Reopen in a fresh process so the test exercises restart-time identity
  // enrollment rather than reusing the killed writer's process-local registry.
  const recoveryChild = `
    const { DatabaseSync } = require('node:sqlite');
    const bootstrap = new DatabaseSync(':memory:', { allowExtension: true });
    bootstrap.loadExtension(process.env.LOGIC_ENGINE_VFS_PROBE_PATH, 'sqlite3_secure_vfs_probe_init');
    bootstrap.enableLoadExtension(false);
    bootstrap.close();
    const registry = new DatabaseSync(':memory:');
    registry.prepare('SELECT logic_engine_vfs_probe_register_database_role(?, ?)').get(process.argv[1], 'wal-crash-recovery-restart');
    const db = new DatabaseSync(process.argv[1]);
    const rows = db.prepare('SELECT value FROM crash_probe ORDER BY rowid').all().map((row) => row.value);
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    db.close();
    registry.close();
    process.stdout.write(JSON.stringify({ rows, integrity }));
  `;
  const recovery = spawnSync(process.execPath, ['-e', recoveryChild, crashPath], {
    encoding: 'utf8',
    env: process.env,
    timeout: 10000,
  });
  assert.equal(recovery.status, 0, recovery.stderr || recovery.stdout);
  const recoveryResult = JSON.parse(recovery.stdout.trim());
  assert.deepEqual(
    recoveryResult.rows,
    ['committed'],
    'WAL recovery must discard the transaction that was interrupted before COMMIT',
  );
  assert.equal(
    recoveryResult.integrity,
    'ok',
    'the database must pass integrity_check after abrupt writer termination',
  );
});
