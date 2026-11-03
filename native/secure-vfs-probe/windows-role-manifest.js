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
      const metadataRootKey = `${manifest.metadataRootIdentity.volumeSerial.toLowerCase()}:${manifest.metadataRootIdentity.fileId.toLowerCase()}`;
      if (key === metadataRootKey || parentIds.has(key)) {
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
    const activeSidecarKinds = new Set();
    const activeSidecarGenerations = new Map();
    const latestRetiredGeneration = new Map();
    const sidecarGenerations = new Set();
    for (const sidecar of role.sidecars) {
      assertExactKeys(sidecar, ['kind', 'identity', 'state', 'generation'], 'sidecar');
      const generationKey = `${sidecar.kind}:${sidecar.generation}`;
      if (!['wal', 'shm', 'journal'].includes(sidecar.kind)
          || !['active', 'retired'].includes(sidecar.state)
          || !Number.isSafeInteger(sidecar.generation) || sidecar.generation < 1
          || sidecar.generation > manifest.generation
          || sidecarGenerations.has(generationKey)
          || (sidecar.state === 'active' && activeSidecarKinds.has(sidecar.kind))) {
        throw new TypeError(`Role ${role.role} has a transitional or invalid sidecar record`);
      }
      sidecarGenerations.add(generationKey);
      if (sidecar.state === 'active') {
        activeSidecarKinds.add(sidecar.kind);
        activeSidecarGenerations.set(sidecar.kind, sidecar.generation);
      } else {
        latestRetiredGeneration.set(
          sidecar.kind,
          Math.max(latestRetiredGeneration.get(sidecar.kind) ?? 0, sidecar.generation),
        );
      }
      assertWindowsIdentity(sidecar.identity, `${role.role} ${sidecar.kind} sidecar`);
      // Keep every retired identity as durable history. A new active
      // generation may coexist with older retired generations of the same
      // kind, but there can be only one active identity per kind.
      claimIdentity(sidecar.identity, `${role.role} ${sidecar.kind} sidecar`);
    }
    for (const [kind, generation] of activeSidecarGenerations) {
      if (generation <= (latestRetiredGeneration.get(kind) ?? 0)) {
        throw new TypeError(`Role ${role.role} has a non-monotonic active ${kind} generation`);
      }
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
  const manifestSuffix = role.parentComponents.length > 0
    ? actualComponents.slice(-role.parentComponents.length) : [];
  if (actualComponents.length < role.parentComponents.length
      || manifestSuffix.some((component, index) =>
        component.toLowerCase() !== role.parentComponents[index].toLowerCase())) {
    throw new TypeError('Database parent path does not match the trusted manifest component chain');
  }
  if (path.win32.basename(resolvedPath).toLowerCase()
      !== role.databaseBasename.toLowerCase()) {
    throw new TypeError('Database path basename does not match the trusted manifest');
  }
  // Validate the metadata root and every directory in the manifest-owned
  // suffix against identities obtained from freshly opened, handle-relative
  // directory chains. Checking only the final parent would miss an ancestor
  // replacement that happens to preserve the same child names.
  const metadataRootComponents = role.parentComponents.length > 0
    ? actualComponents.slice(0, actualComponents.length - role.parentComponents.length)
    : actualComponents;
  const metadataRootPath = metadataRootComponents.length > 0
    ? path.win32.join(root, ...metadataRootComponents)
    : root;
  const validateDirectory = (directoryPath, identity, label) => {
    assertWindowsIdentity(identity, label);
    const checked = database.prepare(
      'SELECT logic_engine_vfs_probe_validate_manifest_directory_identity(?, ?, ?) AS validated'
    ).get(directoryPath, identity.volumeSerial, identity.fileId);
    if (checked?.validated !== 1) {
      throw new Error(`Secure VFS rejected manifest directory identity: ${label}`);
    }
  };
  validateDirectory(metadataRootPath, manifest.metadataRootIdentity, 'metadata root');
  let parentPathCursor = metadataRootPath;
  for (let index = 0; index < role.parentComponents.length; index += 1) {
    parentPathCursor = path.win32.join(parentPathCursor, role.parentComponents[index]);
    validateDirectory(
      parentPathCursor,
      role.parentIdentities[index],
      `parent ${index + 1} for ${roleName}`
    );
  }
  const parentIdentity = role.parentIdentities.at(-1)
    ?? manifest.metadataRootIdentity;
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
  const expectedSidecars = database.prepare(
    'SELECT logic_engine_vfs_probe_set_manifest_sidecar_count(?, ?) AS registered'
  ).get(role.role, BigInt(role.sidecars.length));
  if (expectedSidecars?.registered !== 1) {
    throw new Error(`Secure VFS rejected expected sidecar count for role ${role.role}`);
  }
  // Register the current live identity before replaying retired history.
  // Native validation of a retired generation must distinguish an absent
  // pathname from the same basename occupied by this role's active generation.
  const sidecarsByRegistrationOrder = [...role.sidecars].sort(
    (left, right) => Number(right.state === 'active') - Number(left.state === 'active'),
  );
  for (const sidecar of sidecarsByRegistrationOrder) {
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
  const activated = database.prepare(
    'SELECT logic_engine_vfs_probe_activate_manifest_role(?) AS activated'
  ).get(role.role);
  if (activated?.activated !== 1) {
    throw new Error(`Secure VFS could not finalize manifest role ${role.role}`);
  }
  return result.registered;
}
