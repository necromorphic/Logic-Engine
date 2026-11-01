import { lstat, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

async function canonicalizeWithoutFollowingLinks(candidate) {
  const absolute = resolve(candidate);
  const suffix = [];
  let cursor = absolute;
  while (true) {
    try {
      const item = await lstat(cursor);
      if (item.isSymbolicLink()) {
        return { status: 'FAIL', path: absolute, reason: 'SYMLINK_OR_REPARSE_ANCESTOR', at: cursor };
      }
      if (cursor !== absolute && !item.isDirectory()) {
        return { status: 'FAIL', path: absolute, reason: 'NON_DIRECTORY_ANCESTOR', at: cursor };
      }
      const base = await realpath(cursor);
      const canonical = resolve(base, ...suffix.reverse());
      return { status: 'PASS', path: canonical, exists: cursor === absolute };
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        return { status: 'NOT_TESTED', path: absolute, reason: 'PATH_INSPECTION_ERROR', code: error?.code ?? 'unknown' };
      }
      const parent = dirname(cursor);
      if (parent === cursor) {
        return { status: 'NOT_TESTED', path: absolute, reason: 'NO_EXISTING_ANCESTOR' };
      }
      suffix.push(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
      cursor = parent;
    }
  }
}

export async function resolveDeploymentPathRegistry({
  manifest,
  deploymentRoot,
  resolveConfiguredPath = async (resource) => resource.path.value,
}) {
  if (!manifest || !Array.isArray(manifest.resources)) throw new TypeError('DEPLOYMENT_MANIFEST_RESOURCES_REQUIRED');
  const root = resolve(deploymentRoot);
  const rootResult = await canonicalizeWithoutFollowingLinks(root);
  if (rootResult.status !== 'PASS' || rootResult.exists !== true) {
    return Object.freeze({
      status: rootResult.status,
      resources: Object.freeze([]),
      conflicts: Object.freeze([{ kind: rootResult.status === 'PASS' ? 'DEPLOYMENT_ROOT_MISSING' : 'DEPLOYMENT_ROOT_UNSAFE', ...rootResult }]),
    });
  }

  const resources = [];
  const conflicts = [];
  for (const resource of manifest.resources) {
    let candidate;
    if (resource.path.source === 'deployment-root-relative') {
      if (isAbsolute(resource.path.value)) {
        conflicts.push({ kind: 'ABSOLUTE_PATH_IN_RELATIVE_RESOURCE', resourceId: resource.id });
        continue;
      }
      candidate = resolve(root, resource.path.value);
      if (!isWithin(root, candidate)) {
        conflicts.push({ kind: 'PATH_ESCAPES_DEPLOYMENT_ROOT', resourceId: resource.id });
        continue;
      }
    } else {
      candidate = await resolveConfiguredPath(resource);
      if (typeof candidate !== 'string' || !isAbsolute(candidate)) {
        conflicts.push({ kind: 'CONFIGURED_PATH_NOT_ABSOLUTE', resourceId: resource.id });
        continue;
      }
    }

    const inspected = await canonicalizeWithoutFollowingLinks(candidate);
    if (inspected.status !== 'PASS') {
      conflicts.push({ kind: inspected.reason ?? 'PATH_NOT_VERIFIED', resourceId: resource.id, path: inspected.path, status: inspected.status });
      continue;
    }
    let identity = null;
    if (inspected.exists) {
      try {
        const info = await stat(inspected.path, { bigint: true });
        if (info.isFile()) identity = String(info.dev) + ':' + String(info.ino);
      } catch {
        conflicts.push({ kind: 'FILE_IDENTITY_NOT_TESTED', resourceId: resource.id, path: inspected.path });
      }
    }
    resources.push(Object.freeze({
      id: resource.id,
      ownerDomain: resource.owner_domain,
      kind: resource.kind,
      canonicalPath: inspected.path,
      exists: inspected.exists,
      fileIdentity: identity,
    }));
  }

  for (let i = 0; i < resources.length; i++) {
    for (let j = i + 1; j < resources.length; j++) {
      const left = resources[i], right = resources[j];
      if (left.fileIdentity && left.fileIdentity === right.fileIdentity) {
        conflicts.push({ kind: 'SAME_FILE_IDENTITY_ALIAS', resources: [left.id, right.id] });
      } else if (left.canonicalPath === right.canonicalPath) {
        conflicts.push({ kind: 'DUPLICATE_CANONICAL_PATH', resources: [left.id, right.id] });
      } else if (isWithin(left.canonicalPath, right.canonicalPath) || isWithin(right.canonicalPath, left.canonicalPath)) {
        conflicts.push({ kind: 'RESOURCE_PATH_OVERLAP', resources: [left.id, right.id] });
      }
    }
  }

  return Object.freeze({
    status: conflicts.length === 0 ? 'PASS' : 'FAIL',
    root,
    resources: Object.freeze(resources),
    conflicts: Object.freeze(conflicts),
  });
}
