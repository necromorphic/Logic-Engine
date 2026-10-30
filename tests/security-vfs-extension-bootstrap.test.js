import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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
    first.exec("PRAGMA journal_mode=WAL; CREATE TABLE probe(value TEXT); INSERT INTO probe VALUES('ok');");
    assert.equal(first.prepare('SELECT value FROM probe').get().value, 'ok');
    const opened = first.prepare('SELECT logic_engine_vfs_probe_open_count() AS count').get().count;
    assert.equal(opened, 2, 'the worker and Core file-backed DatabaseSync connections must pass through the registered VFS xOpen');
    assert.equal(
      first.prepare('SELECT logic_engine_vfs_probe_hook_protection() AS protected').get().protected,
      1,
      'the VFS must refuse attempts to replace its protected native open/stat hooks'
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

    renameSync(anchoredParent, movedParent);
    mkdirSync(anchoredParent);
    writeFileSync(join(anchoredParent, 'anchored.sqlite'), 'decoy database');

    const anchoredDb = new DatabaseSync(anchoredPath);
    try {
      assert.equal(
        anchoredDb.prepare('SELECT value FROM anchored_probe').get().value,
        'trusted-windows-directory',
        'the Windows VFS must open the original database through its pinned parent HANDLE'
      );
      anchoredDb.exec("BEGIN IMMEDIATE; INSERT INTO anchored_probe VALUES('anchored-journal');");
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
      anchoredDb.exec('COMMIT;');
      assert.equal(
        existsSync(join(movedParent, 'anchored.sqlite-journal')),
        false,
        'Windows xDelete must remove the exact anchored rollback-journal object'
      );
      assert.equal(
        existsSync(join(anchoredParent, 'anchored.sqlite-journal')),
        false,
        'Windows xDelete must not operate on the replacement pathname'
      );
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
      const rejectedBefore = sidecarOwner.prepare(
        'SELECT logic_engine_vfs_probe_sidecar_identity_reject_count() AS count'
      ).get().count;
      linkSync(`${sidecarOwnerPath}-journal`, `${sidecarVictimPath}-journal`);
      sidecarVictim.exec('PRAGMA journal_mode=DELETE; CREATE TABLE probe(value TEXT);');
      assert.throws(() => sidecarVictim.exec(
        "BEGIN IMMEDIATE; INSERT INTO probe VALUES('victim');"
      ), 'a sidecar hardlink alias owned by another role must fail closed');
      assert.ok(sidecarOwner.prepare(
        'SELECT logic_engine_vfs_probe_sidecar_identity_reject_count() AS count'
      ).get().count > rejectedBefore,
      'the Windows sidecar identity registry must record the cross-role alias rejection');
    } finally {
      try { sidecarVictim.close(); } catch { /* rejected sidecar open may leave a transaction active */ }
      try { sidecarOwner.exec('ROLLBACK;'); } catch { /* cleanup after deliberate rejection */ }
      sidecarOwner.close();
      try { unlinkSync(`${sidecarVictimPath}-journal`); } catch { /* link may not have been created */ }
    }
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
    const expectedOpenCount = process.platform === 'win32' ? 9 : 10;
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
});
