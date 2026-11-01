import path from 'node:path';

const WINDOWS_IDENTITY = Object.freeze({
  volumeSerial: /^[0-9A-Fa-f]{16}$/,
  fileId: /^[0-9A-Fa-f]{32}$/,
});

function assertWindowsIdentity(identity, label) {
  if (!identity || identity.kind !== 'windows'
      || !WINDOWS_IDENTITY.volumeSerial.test(identity.volumeSerial)
      || !WINDOWS_IDENTITY.fileId.test(identity.fileId)) {
    throw new TypeError(`Invalid Windows ${label} identity in trusted role manifest`);
  }
}

function assertManifestShape(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.platform !== 'windows'
      || !Number.isSafeInteger(manifest.generation) || manifest.generation < 1
      || !Array.isArray(manifest.roles) || manifest.roles.length === 0) {
    throw new TypeError('Invalid Windows SQLite role manifest envelope');
  }
  assertWindowsIdentity(manifest.metadataRootIdentity, 'metadata-root');
  const roleNames = new Set();
  const directoryIds = new Set([
    `${manifest.metadataRootIdentity.volumeSerial.toLowerCase()}:${manifest.metadataRootIdentity.fileId.toLowerCase()}`,
  ]);
  const physicalIds = new Set();
  const claimIdentity = (identity, label) => {
    const key = `${identity.volumeSerial.toLowerCase()}:${identity.fileId.toLowerCase()}`;
    if (directoryIds.has(key) || physicalIds.has(key)) {
      throw new TypeError(`Duplicate physical Windows identity in trusted role manifest: ${label}`);
    }
    physicalIds.add(key);
  };
  /*
   * Multiple roles may legitimately share one parent directory, and the
   * metadata root may itself be an ancestor in a role's parent chain. Gather
   * all directory identities first so file identities can never alias them.
   */
  for (const role of manifest.roles) {
    if (!role || !Array.isArray(role.parentIdentities)
        || !Array.isArray(role.parentComponents)
        || role.parentComponents.length !== role.parentIdentities.length) {
      throw new TypeError('Invalid Windows parent identity chain in trusted role manifest');
    }
    const parentIds = new Set();
    for (const identity of role.parentIdentities) {
      assertWindowsIdentity(identity, `parent ${role.role}`);
      const key = `${identity.volumeSerial.toLowerCase()}:${identity.fileId.toLowerCase()}`;
      if (parentIds.has(key)) {
        throw new TypeError(`Duplicate parent directory identity in role ${role.role}`);
      }
      parentIds.add(key);
      directoryIds.add(key);
    }
  }
  for (const role of manifest.roles) {
    if (!role || typeof role.role !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(role.role)
        || roleNames.has(role.role) || role.state !== 'active'
        || !Array.isArray(role.parentComponents)
        || !Array.isArray(role.parentIdentities)
        || role.parentComponents.length !== role.parentIdentities.length
        || role.parentComponents.length === 0
        || typeof role.databaseBasename !== 'string'
        || !role.databaseBasename || /[\\/:\0]/.test(role.databaseBasename)
        || !Array.isArray(role.sidecars)) {
      throw new TypeError('Invalid or non-active Windows database role in manifest');
    }
    roleNames.add(role.role);
    assertWindowsIdentity(role.databaseIdentity, `database ${role.role}`);
    for (const component of role.parentComponents) {
      if (typeof component !== 'string' || !component || component === '.' || component === '..'
          || /[\\/:*?"<>|\0]/.test(component) || /[. ]$/.test(component)) {
        throw new TypeError(`Invalid Windows parent component for role ${role.role}`);
      }
    }
    claimIdentity(role.databaseIdentity, `database ${role.role}`);
    const sidecarKinds = new Set();
    for (const sidecar of role.sidecars) {
      if (!sidecar || !['wal', 'shm', 'journal'].includes(sidecar.kind)
          || sidecarKinds.has(sidecar.kind)
          || !['active', 'retired'].includes(sidecar.state)
          || !Number.isSafeInteger(sidecar.generation) || sidecar.generation < 1
          || sidecar.generation > manifest.generation) {
        throw new TypeError(`Role ${role.role} has a transitional or invalid sidecar record`);
      }
      sidecarKinds.add(sidecar.kind);
      assertWindowsIdentity(sidecar.identity, `${role.role} ${sidecar.kind} sidecar`);
      if (sidecar.state !== 'retired') {
        claimIdentity(sidecar.identity, `${role.role} ${sidecar.kind} sidecar`);
      }
    }
  }
}

export function registerWindowsManifestRole(database, manifest, roleName, databasePath) {
  assertManifestShape(manifest);
  const role = manifest.roles.find((entry) => entry.role === roleName);
  if (!role) throw new TypeError(`Role ${roleName} is absent from trusted manifest`);
  const resolvedPath = path.win32.resolve(databasePath);
  if (path.win32.basename(resolvedPath).toLowerCase()
      !== role.databaseBasename.toLowerCase()) {
    throw new TypeError('Database path basename does not match the trusted manifest');
  }
  const parentIdentity = role.parentIdentities.at(-1);
  assertWindowsIdentity(parentIdentity, `final parent ${roleName}`);
  const result = database.prepare(
    'SELECT logic_engine_vfs_probe_register_database_role_manifest(?, ?, ?, ?, ?, ?, ?) AS registered'
  ).get(
    resolvedPath,
    role.role,
    role.databaseIdentity.volumeSerial,
    role.databaseIdentity.fileId,
    parentIdentity.volumeSerial,
    parentIdentity.fileId,
    role.databaseBasename,
  );
  if (result?.registered !== 1) {
    throw new Error('Secure VFS rejected persistent-manifest role enrollment');
  }
  for (const sidecar of role.sidecars) {
    const enrolled = database.prepare(
      'SELECT logic_engine_vfs_probe_register_manifest_sidecar(?, ?, ?, ?, ?) AS registered'
    ).get(
      role.role,
      sidecar.kind,
      sidecar.identity.volumeSerial,
      sidecar.identity.fileId,
      sidecar.state,
    );
    if (enrolled?.registered !== 1) {
      throw new Error(`Secure VFS rejected manifest sidecar ${role.role}/${sidecar.kind}`);
    }
  }
  return result.registered;
}
