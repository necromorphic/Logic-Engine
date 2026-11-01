import path from 'node:path';

const WINDOWS_IDENTITY = Object.freeze({
  volumeSerial: /^[0-9A-Fa-f]{16}$/,
  fileId: /^[0-9A-Fa-f]{32}$/,
});

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid ${label} object in trusted role manifest`);
  }
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length
      || actual.some((key, index) => key !== allowed[index])) {
    throw new TypeError(`Unexpected or missing fields in trusted role manifest ${label}`);
  }
}

function assertWindowsIdentity(identity, label) {
  assertExactKeys(identity, ['kind', 'volumeSerial', 'fileId'], label + ' identity');
  if (identity.kind !== 'windows'
      || typeof identity.volumeSerial !== 'string'
      || !WINDOWS_IDENTITY.volumeSerial.test(identity.volumeSerial)
      || typeof identity.fileId !== 'string'
      || !WINDOWS_IDENTITY.fileId.test(identity.fileId)) {
    throw new TypeError(`Invalid Windows ${label} identity in trusted role manifest`);
  }
}

function assertManifestShape(manifest) {
  assertExactKeys(manifest, [
    'schemaVersion', 'generation', 'platform', 'metadataRootIdentity',
    'filesystemPolicy', 'roles',
  ], 'envelope');
  if (manifest.schemaVersion !== 1 || manifest.platform !== 'windows'
      || !Number.isSafeInteger(manifest.generation) || manifest.generation < 1
      || !Array.isArray(manifest.roles) || manifest.roles.length === 0) {
    throw new TypeError('Invalid Windows SQLite role manifest envelope');
  }
  assertWindowsIdentity(manifest.metadataRootIdentity, 'metadata-root');
  assertExactKeys(manifest.filesystemPolicy, [
    'filesystem', 'identitySource', 'directoryMutationBoundary',
  ], 'filesystem policy');
  if (typeof manifest.filesystemPolicy.filesystem !== 'string'
      || !manifest.filesystemPolicy.filesystem.trim()
      || manifest.filesystemPolicy.identitySource !== 'opened-handle'
      || manifest.filesystemPolicy.directoryMutationBoundary !== 'dedicated-service-identity') {
    throw new TypeError('Invalid Windows filesystem trust policy in role manifest');
  }

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
    assertExactKeys(role, [
      'role', 'parentComponents', 'parentIdentities', 'databaseBasename',
      'databaseIdentity', 'state', 'sidecars',
    ], 'database role');
    if (typeof role.role !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(role.role)
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
      assertExactKeys(sidecar, ['kind', 'identity', 'state', 'generation'], 'sidecar');
      if (!['wal', 'shm', 'journal'].includes(sidecar.kind)
          || sidecarKinds.has(sidecar.kind)
          || !['active', 'retired'].includes(sidecar.state)
          || !Number.isSafeInteger(sidecar.generation) || sidecar.generation < 1
          || sidecar.generation > manifest.generation) {
        throw new TypeError(`Role ${role.role} has a transitional or invalid sidecar record`);
      }
      sidecarKinds.add(sidecar.kind);
      assertWindowsIdentity(sidecar.identity, `${role.role} ${sidecar.kind} sidecar`);
      // Retired records remain part of the durable identity history. They
      // must not alias a live DB/sidecar or another role's retired object:
      // otherwise restart reconciliation cannot distinguish identity reuse
      // from reuse of a still-linked file identity.
      claimIdentity(sidecar.identity, `${role.role} ${sidecar.kind} sidecar`);
    }
  }
}

export function registerWindowsManifestRole(database, manifest, roleName, databasePath) {
  assertManifestShape(manifest);
  const role = manifest.roles.find((entry) => entry.role === roleName);
  if (!role) throw new TypeError(`Role ${roleName} is absent from trusted manifest`);
  if (typeof databasePath !== 'string' || !path.win32.isAbsolute(databasePath)
      || !/^[A-Za-z]:\\/.test(databasePath)) {
    throw new TypeError('Database path must be an absolute drive-letter Windows path');
  }
  const resolvedPath = path.win32.resolve(databasePath);
  if (resolvedPath !== databasePath) {
    throw new TypeError('Database path must be normalized and contain no dot components');
  }
  const parentPath = path.win32.dirname(resolvedPath);
  const root = path.win32.parse(resolvedPath).root;
  const actualComponents = parentPath.slice(root.length).split('\\').filter(Boolean);
  /*
   * parentComponents are relative to metadataRootIdentity, not necessarily
   * relative to the volume root. The absolute path can therefore have trusted
   * platform/runtime ancestors before the manifest-owned suffix.
   */
  const manifestSuffix = actualComponents.slice(-role.parentComponents.length);
  if (actualComponents.length < role.parentComponents.length
      || manifestSuffix.some((component, index) =>
        component.toLowerCase() !== role.parentComponents[index].toLowerCase())) {
    throw new TypeError('Database parent path does not match the trusted manifest component chain');
  }
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
