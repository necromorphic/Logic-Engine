#!/usr/bin/env python3
"""Protected POSIX SQLite role-manifest store (enrollment/recovery primitive).

The broker does not consume this module yet. Both roots must be provisioned
for the broker service identity and must not be writable by the application.
"""
from __future__ import annotations

import argparse
import ctypes
import fcntl
import hashlib
import json
import os
import stat
import secrets
import sys
from contextlib import contextmanager
from pathlib import PurePosixPath
from typing import Any

MANIFEST = "manifest.json"
STAGED = "manifest.next"
ANCHOR = "anchor.json"
ANCHOR_NEXT = "anchor.next"
MAX_BYTES = 1 << 20
SUPPORTED_ROLE_FILESYSTEMS = frozenset({"ext4", "xfs", "btrfs"})
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW
FILE_FLAGS = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW


class StoreError(RuntimeError):
    pass


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise StoreError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _read_fd(fd: int, limit: int = MAX_BYTES) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        part = os.read(fd, min(65536, limit + 1 - total))
        if not part:
            return b"".join(chunks)
        total += len(part)
        if total > limit:
            raise StoreError("metadata file exceeds size limit")
        chunks.append(part)


def _open_trusted_dir(path: str, application_uid: int) -> int:
    if not os.path.isabs(path):
        raise StoreError("trusted directory path must be absolute")
    parts = PurePosixPath(path).parts[1:]
    fd = os.open("/", DIR_FLAGS)
    try:
        for part in parts:
            if part in ("", ".", ".."):
                raise StoreError("invalid trusted directory component")
            next_fd = os.open(part, DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = next_fd
            info = os.fstat(fd)
            if not stat.S_ISDIR(info.st_mode):
                raise StoreError("trusted path component is not a directory")
            if info.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
                raise StoreError("trusted path contains group/other-writable directory")
            if application_uid != os.geteuid() and info.st_uid == application_uid and info.st_mode & stat.S_IWUSR:
                raise StoreError("trusted path contains an application-writable ancestor")
        info = os.fstat(fd)
        if info.st_uid != os.geteuid():
            raise StoreError("trusted directory must be owned by the broker service UID")
        if stat.S_IMODE(info.st_mode) != 0o700:
            raise StoreError("trusted directory must have exact mode 0700")
        return fd
    except Exception:
        os.close(fd)
        raise


def _read_named(dir_fd: int, name: str) -> bytes | None:
    try:
        fd = os.open(name, FILE_FLAGS, dir_fd=dir_fd)
    except FileNotFoundError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise StoreError(f"{name} is not a single-link regular file")
        if info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise StoreError(f"{name} has unexpected owner or permissions")
        return _read_fd(fd)
    finally:
        os.close(fd)


def _write_atomic(dir_fd: int, temp_name: str, final_name: str, data: bytes) -> None:
    try:
        os.unlink(temp_name, dir_fd=dir_fd)
    except FileNotFoundError:
        pass
    fd = os.open(temp_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                 os.O_CLOEXEC | os.O_NOFOLLOW, 0o600, dir_fd=dir_fd)
    try:
        view = memoryview(data)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise StoreError("short write to metadata file")
            view = view[written:]
        os.fsync(fd)
    except Exception:
        os.close(fd)
        try:
            os.unlink(temp_name, dir_fd=dir_fd)
        except OSError:
            pass
        raise
    os.close(fd)
    os.replace(temp_name, final_name, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
    os.fsync(dir_fd)


def _canonical_json(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"),
                       ensure_ascii=True) + "\n").encode("ascii")


def _parse(data: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_object)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise StoreError(f"{label} is invalid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise StoreError(f"{label} must be a JSON object")
    return value


def _validate_manifest(data: bytes) -> dict[str, Any]:
    obj = _parse(data, "manifest")
    if obj.get("schemaVersion") != 1 or obj.get("platform") != "linux":
        raise StoreError("manifest schemaVersion/platform is unsupported")
    generation = obj.get("generation")
    if not isinstance(generation, int) or isinstance(generation, bool) or generation < 1:
        raise StoreError("manifest generation must be a positive integer")
    root_identity = obj.get("metadataRootIdentity")
    if not isinstance(root_identity, dict):
        raise StoreError("manifest metadataRootIdentity is missing")
    policy = obj.get("filesystemPolicy")
    if (not isinstance(policy, dict)
            or policy.get("identitySource") != "opened-handle"
            or policy.get("directoryMutationBoundary") not in
               ("broker-exclusive-owner", "dedicated-service-identity")
            or policy.get("filesystem") not in SUPPORTED_ROLE_FILESYSTEMS
            or not isinstance(policy.get("applicationUid"), int)
            or isinstance(policy.get("applicationUid"), bool)
            or policy.get("applicationUid") < 0
            or policy.get("applicationUid") == os.geteuid()):
        raise StoreError("manifest filesystemPolicy is invalid")
    def check_identity(value: Any, label: str) -> None:
        if (not isinstance(value, dict) or value.get("kind") != "posix"
                or set(value) != {"kind", "device", "inode", "mountId"}):
            raise StoreError(f"{label}: invalid POSIX identity shape")
        for key in ("device", "inode", "mountId"):
            raw = value.get(key)
            if not isinstance(raw, str) or not raw.isascii() or not raw.isdigit():
                raise StoreError(f"{label}: invalid {key}")
            if raw == "0" or (len(raw) > 1 and raw[0] == "0"):
                raise StoreError(f"{label}: non-canonical {key}")
    check_identity(root_identity, "metadataRootIdentity")
    roles = obj.get("roles")
    if not isinstance(roles, list) or not roles:
        raise StoreError("manifest roles must be a non-empty array")
    seen: set[str] = set()
    for role in roles:
        if not isinstance(role, dict):
            raise StoreError("role entry must be an object")
        name = role.get("role")
        if not isinstance(name, str) or not name or name in seen:
            raise StoreError("role names must be unique non-empty strings")
        seen.add(name)
        components = role.get("parentComponents")
        identities = role.get("parentIdentities")
        if not isinstance(components, list) or not isinstance(identities, list):
            raise StoreError(f"role {name}: parent components/identities are required")
        if len(components) != len(identities):
            raise StoreError(f"role {name}: parent component/identity count mismatch")
        for component in components + [role.get("databaseBasename")]:
            if (not isinstance(component, str) or not component or component in (".", "..")
                    or "/" in component or "\x00" in component or "\\" in component):
                raise StoreError(f"role {name}: invalid path component")
        for index, value in enumerate(identities):
            check_identity(value, f"role {name} parent identity {index}")
        check_identity(role.get("databaseIdentity"), f"role {name} database identity")
        if role.get("state") not in ("enrolling", "active", "disabled", "recovery-required"):
            raise StoreError(f"role {name}: invalid state")
        sidecars = role.get("sidecars")
        if not isinstance(sidecars, list):
            raise StoreError(f"role {name}: sidecars must be an array")
        for sidecar in sidecars:
            if (not isinstance(sidecar, dict)
                    or sidecar.get("kind") not in ("wal", "shm", "journal")
                    or sidecar.get("state") not in ("creating", "active", "deleting", "retired")
                    or not isinstance(sidecar.get("generation"), int)
                    or isinstance(sidecar.get("generation"), bool)
                    or sidecar["generation"] < 1):
                raise StoreError(f"role {name}: invalid sidecar entry")
            check_identity(sidecar.get("identity"), f"role {name} sidecar identity")
            if sidecar["generation"] > generation:
                raise StoreError(f"role {name}: sidecar generation exceeds manifest generation")
        kinds = [entry["kind"] for entry in sidecars]
        if len(kinds) != len(set(kinds)):
            raise StoreError(f"role {name}: duplicate sidecar kind")
    # Physical file identities must be unique across protected roles. A manifest
    # that aliases one inode under multiple logical names makes ownership and
    # sidecar lifecycle transitions ambiguous.
    parent_identity_keys: set[tuple[str, str, str]] = set()
    file_identity_keys: set[tuple[str, str, str]] = set()
    for role in roles:
        for identity in role["parentIdentities"]:
            parent_identity_keys.add((identity["device"], identity["inode"], identity["mountId"]))
    for role in roles:
        database_identity = role["databaseIdentity"]
        key = (database_identity["device"], database_identity["inode"], database_identity["mountId"])
        if key in parent_identity_keys or key in file_identity_keys:
            raise StoreError("database identity aliases a directory or another role file")
        file_identity_keys.add(key)
        for sidecar in role["sidecars"]:
            identity = sidecar["identity"]
            key = (identity["device"], identity["inode"], identity["mountId"])
            if key in parent_identity_keys or key in file_identity_keys:
                raise StoreError("sidecar identity aliases a directory or another role file")
            file_identity_keys.add(key)
    return obj


def _anchor_bytes(generation: int, digest: str) -> bytes:
    return _canonical_json({"schemaVersion": 1, "generation": generation,
                            "manifestSha256": digest})


def _parse_anchor(data: bytes) -> tuple[int, str]:
    obj = _parse(data, "anchor")
    generation = obj.get("generation")
    digest = obj.get("manifestSha256")
    if (obj.get("schemaVersion") != 1 or not isinstance(generation, int)
            or isinstance(generation, bool) or generation < 1
            or not isinstance(digest, str) or len(digest) != 64
            or any(ch not in "0123456789abcdef" for ch in digest)):
        raise StoreError("anchor fields are invalid")
    return generation, digest


def _fd_mount_id(fd: int) -> str:
    try:
        with open(f"/proc/self/fdinfo/{fd}", "r", encoding="ascii") as handle:
            for line in handle:
                if line.startswith("mnt_id:"):
                    mount_id = line.split(":", 1)[1].strip()
                    if mount_id.isdigit() and mount_id != "0":
                        return mount_id
                    break
    except OSError as exc:
        raise StoreError(f"cannot read opened object mount identity: {exc}") from exc
    raise StoreError("opened object mount identity is unavailable")


def _fd_identity(fd: int) -> dict[str, str]:
    info = os.fstat(fd)
    mount_id = _fd_mount_id(fd)
    if info.st_dev == 0 or info.st_ino == 0:
        raise StoreError("opened object has a zero device or inode identity")
    return {"kind": "posix", "device": str(info.st_dev),
            "inode": str(info.st_ino), "mountId": mount_id}


def _fd_filesystem(fd: int) -> str:
    mount_id = _fd_mount_id(fd)
    try:
        with open("/proc/self/mountinfo", "r", encoding="ascii") as handle:
            for line in handle:
                fields = line.split()
                if fields and fields[0] == mount_id:
                    separator = fields.index("-")
                    if separator + 1 < len(fields):
                        return fields[separator + 1]
    except (OSError, ValueError) as exc:
        raise StoreError(f"cannot resolve opened object filesystem: {exc}") from exc
    raise StoreError("opened object filesystem type is unavailable")


def _open_role_parent(components: list[str], identities: list[dict[str, str]],
                      expected_filesystem: str, application_uid: int) -> int:
    if len(components) != len(identities):
        raise StoreError("role parent component/identity count mismatch")
    fd = os.open("/", DIR_FLAGS)
    try:
        for index, component in enumerate(components):
            if (not isinstance(component, str) or not component or
                    component in (".", "..") or "/" in component or
                    "\x00" in component or "\\" in component):
                raise StoreError("role parent contains an invalid path component")
            next_fd = os.open(component, DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = next_fd
            info = os.fstat(fd)
            if not stat.S_ISDIR(info.st_mode):
                raise StoreError("role parent component is not a directory")
            if info.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
                raise StoreError("role parent component is group/other writable")
            if application_uid != os.geteuid() and info.st_uid == application_uid and info.st_mode & stat.S_IWUSR:
                raise StoreError("role parent component is application-writable")
            if _fd_identity(fd) != identities[index]:
                raise StoreError(f"role parent identity mismatch at component {component}")
        if os.fstat(fd).st_uid != os.geteuid() or stat.S_IMODE(os.fstat(fd).st_mode) != 0o700:
            raise StoreError("final role parent must be service-owned mode 0700")
        actual_filesystem = _fd_filesystem(fd)
        if actual_filesystem != expected_filesystem:
            raise StoreError(
                f"role parent filesystem mismatch: expected {expected_filesystem}, "
                f"observed {actual_filesystem}"
            )
        return fd
    except Exception:
        os.close(fd)
        raise


def _observe_regular_at(parent_fd: int, name: str, label: str) -> dict[str, str] | None:
    try:
        fd = os.open(name, FILE_FLAGS, dir_fd=parent_fd)
    except FileNotFoundError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise StoreError(f"{label} is not a single-link regular file")
        if info.st_uid != os.geteuid():
            raise StoreError(f"{label} is not owned by the broker service UID")
        identity = _fd_identity(fd)
        if identity["mountId"] != _fd_mount_id(parent_fd):
            raise StoreError(f"{label} is not on the enrolled role-parent mount")
        return identity
    finally:
        os.close(fd)


def _verify_regular_at(parent_fd: int, name: str,
                       expected: dict[str, str], label: str) -> None:
    try:
        fd = os.open(name, FILE_FLAGS, dir_fd=parent_fd)
    except FileNotFoundError as exc:
        raise StoreError(f"{label} is missing") from exc
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise StoreError(f"{label} is not a single-link regular file")
        if info.st_uid != os.geteuid():
            raise StoreError(f"{label} is not owned by the broker service UID")
        actual_identity = _fd_identity(fd)
        if actual_identity["mountId"] != _fd_mount_id(parent_fd):
            raise StoreError(f"{label} is not on the enrolled role-parent mount")
        if actual_identity != expected:
            raise StoreError(f"{label} identity mismatch")
    finally:
        os.close(fd)


QUARANTINE_DIR = ".le-quarantine"


def _open_quarantine_dir(parent_fd: int, *, create: bool) -> int | None:
    if create:
        try:
            os.mkdir(QUARANTINE_DIR, 0o700, dir_fd=parent_fd)
        except FileExistsError:
            pass
    try:
        fd = os.open(QUARANTINE_DIR, DIR_FLAGS, dir_fd=parent_fd)
    except FileNotFoundError:
        return None
    try:
        info = os.fstat(fd)
        parent_info = os.fstat(parent_fd)
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid()
                or stat.S_IMODE(info.st_mode) != 0o700
                or _fd_mount_id(fd) != _fd_mount_id(parent_fd)
                or (info.st_dev, info.st_ino) == (parent_info.st_dev, parent_info.st_ino)):
            raise StoreError("sidecar quarantine directory has an untrusted identity or policy")
        return fd
    except Exception:
        os.close(fd)
        raise


def _require_empty_quarantine(parent_fd: int) -> None:
    fd = _open_quarantine_dir(parent_fd, create=False)
    if fd is None:
        return
    try:
        if os.listdir(fd):
            raise StoreError("sidecar quarantine contains retained entries; operator recovery required")
    finally:
        os.close(fd)


def _renameat2_noreplace(old_dir_fd: int, old_name: str,
                         new_dir_fd: int, new_name: str) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    try:
        renameat2 = libc.renameat2
    except AttributeError as exc:
        raise StoreError("renameat2(RENAME_NOREPLACE) is unavailable") from exc
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                          ctypes.c_char_p, ctypes.c_uint]
    renameat2.restype = ctypes.c_int
    result = renameat2(old_dir_fd, os.fsencode(old_name), new_dir_fd,
                       os.fsencode(new_name), 1)  # RENAME_NOREPLACE
    if result != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), old_name)


def _quarantine_delete_at(parent_fd: int, name: str,
                          expected: dict[str, str]) -> None:
    if (not name or name in (".", "..") or "/" in name or "\x00" in name):
        raise StoreError("invalid sidecar basename for quarantine deletion")
    quarantine_fd = _open_quarantine_dir(parent_fd, create=True)
    if quarantine_fd is None:
        raise StoreError("failed to create sidecar quarantine directory")
    opened_fd = -1
    moved_fd = -1
    moved_name: str | None = None
    try:
        _require_empty_quarantine(parent_fd)
        opened_fd = os.open(name, os.O_PATH | os.O_NOFOLLOW | os.O_CLOEXEC,
                            dir_fd=parent_fd)
        opened_info = os.fstat(opened_fd)
        opened_identity = _fd_identity(opened_fd)
        if (not stat.S_ISREG(opened_info.st_mode) or opened_info.st_nlink != 1
                or opened_info.st_uid != os.geteuid()
                or opened_identity["mountId"] != _fd_mount_id(parent_fd)
                or opened_identity != expected):
            raise StoreError("sidecar identity mismatch before quarantine rename")
        for _attempt in range(16):
            candidate = "entry-" + secrets.token_hex(16)
            try:
                _renameat2_noreplace(parent_fd, name, quarantine_fd, candidate)
                moved_name = candidate
                break
            except FileExistsError:
                continue
        if moved_name is None:
            raise StoreError("unable to allocate a unique quarantine name")
        # Persist both sides of the cross-directory rename before inspecting or unlinking.
        os.fsync(quarantine_fd)
        os.fsync(parent_fd)
        moved_fd = os.open(moved_name, os.O_PATH | os.O_NOFOLLOW | os.O_CLOEXEC,
                           dir_fd=quarantine_fd)
        moved_info = os.fstat(moved_fd)
        moved_identity = _fd_identity(moved_fd)
        if (not stat.S_ISREG(moved_info.st_mode) or moved_info.st_nlink != 1
                or moved_info.st_uid != os.geteuid()
                or moved_identity["mountId"] != _fd_mount_id(quarantine_fd)
                or moved_identity != opened_identity or moved_identity != expected):
            raise StoreError("quarantined sidecar identity mismatch; retained for operator recovery")
        os.unlink(moved_name, dir_fd=quarantine_fd)
        os.fsync(quarantine_fd)
    finally:
        if moved_fd >= 0:
            os.close(moved_fd)
        if opened_fd >= 0:
            os.close(opened_fd)
        os.close(quarantine_fd)


@contextmanager
def _locked_roots(manifest_fd: int, anchor_fd: int, *, exclusive: bool):
    """Lock both retained metadata directories in a stable global order."""
    descriptors = sorted(
        (manifest_fd, anchor_fd),
        key=lambda fd: (os.fstat(fd).st_dev, os.fstat(fd).st_ino),
    )
    operation = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
    acquired: list[int] = []
    try:
        for fd in descriptors:
            fcntl.flock(fd, operation)
            acquired.append(fd)
        yield
    finally:
        for fd in reversed(acquired):
            fcntl.flock(fd, fcntl.LOCK_UN)


class ManifestStore:
    def __init__(self, manifest_root: str, anchor_root: str, application_uid: int):
        if (not isinstance(application_uid, int) or isinstance(application_uid, bool)
                or application_uid < 0 or application_uid == os.geteuid()):
            raise StoreError("application UID must be a non-negative UID distinct from broker service UID")
        self.application_uid = application_uid
        self.manifest_fd = _open_trusted_dir(manifest_root, application_uid)
        try:
            self.anchor_fd = _open_trusted_dir(anchor_root, application_uid)
            manifest_info = os.fstat(self.manifest_fd)
            anchor_info = os.fstat(self.anchor_fd)
            if (manifest_info.st_dev, manifest_info.st_ino) == (anchor_info.st_dev, anchor_info.st_ino):
                os.close(self.anchor_fd)
                raise StoreError("manifest and rollback-anchor roots must be separate directories")
        except Exception:
            os.close(self.manifest_fd)
            raise

    def close(self) -> None:
        os.close(self.manifest_fd)
        os.close(self.anchor_fd)

    def metadata_identity(self) -> dict[str, str]:
        info = os.fstat(self.manifest_fd)
        mount_id = None
        try:
            with open(f"/proc/self/fdinfo/{self.manifest_fd}", "r", encoding="ascii") as handle:
                for line in handle:
                    if line.startswith("mnt_id:"):
                        mount_id = line.split(":", 1)[1].strip()
                        break
        except OSError as exc:
            raise StoreError(f"cannot read metadata directory mount identity: {exc}") from exc
        if not mount_id or not mount_id.isdigit() or mount_id == "0":
            raise StoreError("metadata directory mount identity is unavailable")
        return {"kind": "posix", "device": str(info.st_dev),
                "inode": str(info.st_ino), "mountId": mount_id}

    def _load_pair(self) -> tuple[dict[str, Any], bytes, int, str]:
        anchor_data = _read_named(self.anchor_fd, ANCHOR)
        if anchor_data is None:
            raise StoreError("anchor is not initialized")
        generation, expected_digest = _parse_anchor(anchor_data)
        current = _read_named(self.manifest_fd, MANIFEST)
        staged = _read_named(self.manifest_fd, STAGED)
        for candidate, is_staged in ((current, False), (staged, True)):
            if candidate is None:
                continue
            digest = hashlib.sha256(candidate).hexdigest()
            if digest == expected_digest:
                manifest = _validate_manifest(candidate)
                if manifest["filesystemPolicy"]["applicationUid"] != self.application_uid:
                    raise StoreError("manifest application UID does not match broker configuration")
                if manifest["metadataRootIdentity"] != self.metadata_identity():
                    raise StoreError("manifest metadata root identity mismatch")
                if manifest["generation"] != generation:
                    raise StoreError("manifest/anchor generation mismatch")
                if is_staged:
                    os.replace(STAGED, MANIFEST, src_dir_fd=self.manifest_fd,
                               dst_dir_fd=self.manifest_fd)
                    os.fsync(self.manifest_fd)
                return manifest, candidate, generation, expected_digest
        raise StoreError("manifest does not match protected anchor; recovery required")

    def initialize(self, manifest_data: bytes) -> None:
        with _locked_roots(self.manifest_fd, self.anchor_fd, exclusive=True):
            self._initialize_locked(manifest_data)

    def _initialize_locked(self, manifest_data: bytes) -> None:
        if _read_named(self.anchor_fd, ANCHOR) is not None:
            raise StoreError("anchor already initialized")
        manifest = _validate_manifest(manifest_data)
        if manifest["filesystemPolicy"]["applicationUid"] != self.application_uid:
            raise StoreError("manifest application UID does not match broker configuration")
        if manifest["generation"] != 1:
            raise StoreError("initial manifest generation must be 1")
        if manifest["metadataRootIdentity"] != self.metadata_identity():
            raise StoreError("manifest metadata root identity does not match opened directory")
        canonical = _canonical_json(manifest)
        digest = hashlib.sha256(canonical).hexdigest()
        _write_atomic(self.manifest_fd, "manifest.tmp", STAGED, canonical)
        _write_atomic(self.anchor_fd, ANCHOR_NEXT, ANCHOR,
                      _anchor_bytes(1, digest))
        os.replace(STAGED, MANIFEST, src_dir_fd=self.manifest_fd,
                   dst_dir_fd=self.manifest_fd)
        os.fsync(self.manifest_fd)

    def open_role_file(self, role_name: str, file_kind: str = "main") -> int:
        """Return an identity-verified descriptor for an enrolled DB or active sidecar.

        The returned descriptor is pinned to the verified object and may be
        transferred to an authorized application process with SCM_RIGHTS.
        The caller owns the returned descriptor and must close it.
        """
        suffixes = {"wal": "-wal", "shm": "-shm", "journal": "-journal"}
        if file_kind != "main" and file_kind not in suffixes:
            raise StoreError("unsupported role file kind")
        with _locked_roots(self.manifest_fd, self.anchor_fd, exclusive=False):
            manifest = self._load_pair()[0]
            matches = [entry for entry in manifest["roles"] if entry["role"] == role_name]
            if len(matches) != 1:
                raise StoreError("unknown or ambiguous database role")
            role = matches[0]
            if role["state"] != "active":
                raise StoreError(f"role {role_name} is not active")
            if file_kind == "main":
                basename = role["databaseBasename"]
                expected = role["databaseIdentity"]
                label = f"role {role_name} database"
            else:
                sidecars = [entry for entry in role["sidecars"] if entry["kind"] == file_kind]
                if len(sidecars) != 1 or sidecars[0]["state"] != "active":
                    raise StoreError(f"role {role_name} {file_kind} sidecar is not active")
                basename = role["databaseBasename"] + suffixes[file_kind]
                expected = sidecars[0]["identity"]
                label = f"role {role_name} {file_kind} sidecar"
            parent_fd = _open_role_parent(
                role["parentComponents"], role["parentIdentities"],
                manifest["filesystemPolicy"]["filesystem"],
                manifest["filesystemPolicy"]["applicationUid"],
            )
            try:
                flags = os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK
                try:
                    fd = os.open(basename, flags, dir_fd=parent_fd)
                except OSError as exc:
                    raise StoreError(f"{label} secure open failed: {exc}") from exc
                try:
                    info = os.fstat(fd)
                    actual = _fd_identity(fd)
                    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                            or info.st_uid != os.geteuid()
                            or actual["mountId"] != _fd_mount_id(parent_fd)
                            or actual != expected):
                        raise StoreError(f"{label} identity or file type mismatch")
                    return fd
                except Exception:
                    os.close(fd)
                    raise
            finally:
                os.close(parent_fd)

    def role_file_exists(self, role_name: str, file_kind: str = "main") -> bool:
        """Check an enrolled role file without treating an untrusted path as absent."""
        suffixes = {"wal": "-wal", "shm": "-shm", "journal": "-journal"}
        if file_kind != "main" and file_kind not in suffixes:
            raise StoreError("unsupported role file kind")
        with _locked_roots(self.manifest_fd, self.anchor_fd, exclusive=False):
            manifest = self._load_pair()[0]
            matches = [entry for entry in manifest["roles"] if entry["role"] == role_name]
            if len(matches) != 1 or matches[0]["state"] != "active":
                raise StoreError("unknown or inactive database role")
            role = matches[0]
            if file_kind == "main":
                basename = role["databaseBasename"]
                expected = role["databaseIdentity"]
            else:
                sidecars = [entry for entry in role["sidecars"] if entry["kind"] == file_kind]
                if len(sidecars) != 1 or sidecars[0]["state"] != "active":
                    return False
                basename = role["databaseBasename"] + suffixes[file_kind]
                expected = sidecars[0]["identity"]
            parent_fd = _open_role_parent(
                role["parentComponents"], role["parentIdentities"],
                manifest["filesystemPolicy"]["filesystem"],
                manifest["filesystemPolicy"]["applicationUid"],
            )
            try:
                try:
                    fd = os.open(basename, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK,
                                 dir_fd=parent_fd)
                except FileNotFoundError:
                    return False
                try:
                    info = os.fstat(fd)
                    actual = _fd_identity(fd)
                    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                            or info.st_uid != os.geteuid()
                            or actual["mountId"] != _fd_mount_id(parent_fd)
                            or actual != expected):
                        raise StoreError("role file identity or type mismatch")
                    return True
                finally:
                    os.close(fd)
            finally:
                os.close(parent_fd)

    def open_role_parent_directory(self, role_name: str) -> int:
        """Return a verified directory descriptor for VFS-relative file operations."""
        with _locked_roots(self.manifest_fd, self.anchor_fd, exclusive=False):
            manifest = self._load_pair()[0]
            matches = [entry for entry in manifest["roles"] if entry["role"] == role_name]
            if len(matches) != 1 or matches[0]["state"] != "active":
                raise StoreError("unknown or inactive database role")
            role = matches[0]
            parent_fd = _open_role_parent(
                role["parentComponents"], role["parentIdentities"],
                manifest["filesystemPolicy"]["filesystem"],
                manifest["filesystemPolicy"]["applicationUid"],
            )
            try:
                _verify_regular_at(
                    parent_fd, role["databaseBasename"],
                    role["databaseIdentity"], f"role {role_name} database",
                )
                return parent_fd
            except Exception:
                os.close(parent_fd)
                raise

    def verify_roles(self) -> None:
        with _locked_roots(self.manifest_fd, self.anchor_fd, exclusive=True):
            manifest = self._load_pair()[0]
            self._verify_roles_locked(manifest)

    def _verify_roles_locked(self, manifest: dict[str, Any]) -> None:
        for role in manifest["roles"]:
            state = role["state"]
            if state == "disabled":
                continue
            if state != "active":
                raise StoreError(f"role {role['role']} is not active; recovery/enrollment required")
            parent_fd = _open_role_parent(
                role["parentComponents"], role["parentIdentities"],
                manifest["filesystemPolicy"]["filesystem"],
                manifest["filesystemPolicy"]["applicationUid"]
            )
            try:
                _require_empty_quarantine(parent_fd)
                _verify_regular_at(parent_fd, role["databaseBasename"],
                                   role["databaseIdentity"], f"role {role['role']} database")
                suffixes = {"wal": "-wal", "shm": "-shm", "journal": "-journal"}
                for sidecar in role["sidecars"]:
                    sidecar_state = sidecar["state"]
                    sidecar_name = role["databaseBasename"] + suffixes[sidecar["kind"]]
                    if sidecar_state == "retired":
                        try:
                            unexpected_fd = os.open(sidecar_name, FILE_FLAGS, dir_fd=parent_fd)
                        except FileNotFoundError:
                            continue
                        else:
                            os.close(unexpected_fd)
                            raise StoreError(f"retired sidecar still exists: {sidecar_name}")
                    if sidecar_state != "active":
                        raise StoreError(f"sidecar {sidecar_name} requires recovery")
                    _verify_regular_at(parent_fd, sidecar_name, sidecar["identity"],
                                       f"role {role['role']} sidecar {sidecar_name}")
            finally:
                os.close(parent_fd)

    def create_role_sidecar(self, role_name: str, kind: str) -> int:
        """Create, enroll and return one new sidecar descriptor; never adopt an existing name."""
        suffixes = {"wal": "-wal", "shm": "-shm", "journal": "-journal"}
        if kind not in suffixes:
            raise StoreError("unsupported sidecar kind")
        with _locked_roots(self.manifest_fd, self.anchor_fd, exclusive=True):
            manifest = self._load_pair()[0]
            roles = [entry for entry in manifest["roles"] if entry["role"] == role_name]
            if len(roles) != 1 or roles[0]["state"] != "active":
                raise StoreError("unknown or inactive database role")
            role = roles[0]
            existing = [entry for entry in role["sidecars"] if entry["kind"] == kind]
            if existing and existing[0]["state"] != "retired":
                raise StoreError("sidecar already has a non-retired manifest entry")
            parent_fd = _open_role_parent(
                role["parentComponents"], role["parentIdentities"],
                manifest["filesystemPolicy"]["filesystem"],
                manifest["filesystemPolicy"]["applicationUid"],
            )
            fd = -1
            try:
                _require_empty_quarantine(parent_fd)
                basename = role["databaseBasename"] + suffixes[kind]
                flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK
                try:
                    fd = os.open(basename, flags, 0o600, dir_fd=parent_fd)
                except FileExistsError as exc:
                    raise StoreError("unmanifested or existing sidecar blocks secure creation") from exc
                info = os.fstat(fd)
                identity = _fd_identity(fd)
                if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                        or info.st_uid != os.geteuid()
                        or identity["mountId"] != _fd_mount_id(parent_fd)):
                    raise StoreError("new sidecar failed opened-handle validation")
                os.fchmod(fd, 0o600)
                os.fsync(fd)
                os.fsync(parent_fd)

                creating = json.loads(_canonical_json(manifest))
                creating["generation"] = manifest["generation"] + 1
                creating_role = next(entry for entry in creating["roles"] if entry["role"] == role_name)
                creating_role["sidecars"] = [entry for entry in creating_role["sidecars"]
                                               if entry["kind"] != kind]
                creating_role["sidecars"].append({
                    "kind": kind, "identity": identity, "state": "creating",
                    "generation": creating["generation"],
                })
                self._commit_locked(_canonical_json(creating))

                current = self._load_pair()[0]
                active = json.loads(_canonical_json(current))
                active["generation"] = current["generation"] + 1
                active_role = next(entry for entry in active["roles"] if entry["role"] == role_name)
                active_sidecar = next(entry for entry in active_role["sidecars"]
                                      if entry["kind"] == kind)
                active_sidecar["state"] = "active"
                active_sidecar["generation"] = active["generation"]
                self._commit_locked(_canonical_json(active))
                return fd
            except Exception:
                if fd >= 0:
                    os.close(fd)
                    fd = -1
                raise
            finally:
                os.close(parent_fd)

    def open_or_create_role_sidecar(self, role_name: str, kind: str) -> int:
        """Return an identity-verified sidecar FD, durably enrolling it if absent."""
        try:
            return self.open_role_file(role_name, kind)
        except StoreError as initial_error:
            try:
                return self.create_role_sidecar(role_name, kind)
            except StoreError:
                # Another broker request may have won the create race. Re-open
                # only through the active manifest identity; never adopt by name.
                try:
                    return self.open_role_file(role_name, kind)
                except StoreError:
                    raise initial_error

    def delete_role_sidecar(self, role_name: str, kind: str) -> dict[str, Any]:
        """Delete one active sidecar through durable manifest transitions and quarantine."""
        suffixes = {"wal": "-wal", "shm": "-shm", "journal": "-journal"}
        if kind not in suffixes:
            raise StoreError("unsupported sidecar kind")
        with _locked_roots(self.manifest_fd, self.anchor_fd, exclusive=True):
            manifest = self._load_pair()[0]
            roles = [entry for entry in manifest["roles"] if entry["role"] == role_name]
            if len(roles) != 1 or roles[0]["state"] != "active":
                raise StoreError("unknown or inactive database role")
            role = roles[0]
            sidecars = [entry for entry in role["sidecars"] if entry["kind"] == kind]
            if len(sidecars) > 1:
                raise StoreError("sidecar manifest entry is ambiguous")
            sidecar = sidecars[0] if sidecars else None
            basename = role["databaseBasename"] + suffixes[kind]
            parent_fd = _open_role_parent(
                role["parentComponents"], role["parentIdentities"],
                manifest["filesystemPolicy"]["filesystem"],
                manifest["filesystemPolicy"]["applicationUid"],
            )
            try:
                _require_empty_quarantine(parent_fd)
                if sidecar is None:
                    if _observe_regular_at(parent_fd, basename, f"sidecar {basename}") is None:
                        return manifest
                    raise StoreError("unmanifested sidecar blocks deletion")
                if sidecar["state"] == "retired":
                    if _observe_regular_at(parent_fd, basename, f"sidecar {basename}") is None:
                        return manifest
                    raise StoreError("retired sidecar path unexpectedly exists")
                if sidecar["state"] != "active":
                    raise StoreError("sidecar is not in the active state")
                _verify_regular_at(parent_fd, basename, sidecar["identity"],
                                   f"role {role_name} {kind} sidecar")
                deleting = json.loads(_canonical_json(manifest))
                deleting["generation"] = manifest["generation"] + 1
                deleting_role = next(entry for entry in deleting["roles"]
                                     if entry["role"] == role_name)
                deleting_sidecar = next(entry for entry in deleting_role["sidecars"]
                                        if entry["kind"] == kind)
                deleting_sidecar["state"] = "deleting"
                deleting_sidecar["generation"] = deleting["generation"]
                self._commit_locked(_canonical_json(deleting))

                # If this fails after the rename, the durable "deleting" state
                # and non-empty quarantine force restart recovery to fail closed.
                _quarantine_delete_at(parent_fd, basename, sidecar["identity"])

                current = self._load_pair()[0]
                retired = json.loads(_canonical_json(current))
                retired["generation"] = current["generation"] + 1
                retired_role = next(entry for entry in retired["roles"]
                                    if entry["role"] == role_name)
                retired_sidecar = next(entry for entry in retired_role["sidecars"]
                                       if entry["kind"] == kind)
                retired_sidecar["state"] = "retired"
                retired_sidecar["generation"] = retired["generation"]
                return self._commit_locked(_canonical_json(retired))
            finally:
                os.close(parent_fd)

    def plan_recovery(self) -> dict[str, Any]:
        """Inspect interrupted sidecar transitions without mutating SQLite files."""
        with _locked_roots(self.manifest_fd, self.anchor_fd, exclusive=True):
            manifest = self._load_pair()[0]
            roles: list[dict[str, Any]] = []
            suffixes = {"wal": "-wal", "shm": "-shm", "journal": "-journal"}
            for role in manifest["roles"]:
                if role["state"] == "disabled":
                    continue
                if role["state"] not in ("active", "recovery-required", "enrolling"):
                    raise StoreError(f"role {role['role']} has unsupported recovery state")
                parent_fd = _open_role_parent(
                    role["parentComponents"], role["parentIdentities"],
                    manifest["filesystemPolicy"]["filesystem"],
                    manifest["filesystemPolicy"]["applicationUid"]
                )
                try:
                    _require_empty_quarantine(parent_fd)
                    _verify_regular_at(parent_fd, role["databaseBasename"],
                                       role["databaseIdentity"], f"role {role['role']} database")
                    declared = {entry["kind"]: entry for entry in role["sidecars"]}
                    observed: list[dict[str, Any]] = []
                    for kind, suffix in suffixes.items():
                        name = role["databaseBasename"] + suffix
                        entry = declared.get(kind)
                        actual = _observe_regular_at(parent_fd, name, f"sidecar {name}")
                        if entry is None:
                            if actual is not None:
                                raise StoreError(f"unmanifested sidecar exists: {name}")
                            continue
                        expected = entry["identity"]
                        if actual is not None and actual != expected:
                            raise StoreError(f"sidecar identity mismatch: {name}")
                        state = entry["state"]
                        if state == "active":
                            if actual is None:
                                raise StoreError(f"active sidecar is missing: {name}")
                            disposition = "stable"
                        elif state == "retired":
                            if actual is not None:
                                raise StoreError(f"retired sidecar still exists: {name}")
                            disposition = "stable"
                        elif state == "creating":
                            disposition = ("created-before-crash; validate with SQLite before promotion"
                                           if actual is not None else
                                           "not-created; may be retired in a manifest commit")
                        elif state == "deleting":
                            disposition = ("still-present; retain and run SQLite recovery before any deletion"
                                           if actual is not None else
                                           "deletion-completed; may be retired in a manifest commit")
                        else:
                            raise StoreError(f"unknown sidecar state for {name}")
                        observed.append({
                            "kind": kind,
                            "name": name,
                            "manifestState": state,
                            "present": actual is not None,
                            "disposition": disposition,
                        })
                    roles.append({
                        "role": role["role"],
                        "roleState": role["state"],
                        "database": "identity-verified",
                        "sidecars": observed,
                    })
                finally:
                    os.close(parent_fd)
            return {
                "manifestGeneration": manifest["generation"],
                "mode": "inspect-only",
                "roles": roles,
                "warning": "No sidecar is deleted, renamed, checkpointed, or opened by SQLite.",
            }

    def retire_absent_sidecars(self) -> dict[str, Any]:
        """Commit only absent creating/deleting sidecars as retired.

        Caller must quiesce the application and all namespace mutators. This
        primitive is not a substitute for broker-enforced namespace locking.
        """
        with _locked_roots(self.manifest_fd, self.anchor_fd, exclusive=True):
            manifest = self._load_pair()[0]
            candidate = json.loads(_canonical_json(manifest))
            suffixes = {"wal": "-wal", "shm": "-shm", "journal": "-journal"}
            changed = False
            for role in candidate["roles"]:
                if role["state"] == "disabled":
                    continue
                if role["state"] not in ("active", "recovery-required", "enrolling"):
                    raise StoreError(f"role {role['role']} has unsupported recovery state")
                parent_fd = _open_role_parent(
                    role["parentComponents"], role["parentIdentities"],
                    manifest["filesystemPolicy"]["filesystem"],
                    manifest["filesystemPolicy"]["applicationUid"]
                )
                try:
                    _require_empty_quarantine(parent_fd)
                    _verify_regular_at(parent_fd, role["databaseBasename"],
                                       role["databaseIdentity"], f"role {role['role']} database")
                    declared = {entry["kind"]: entry for entry in role["sidecars"]}
                    for kind, suffix in suffixes.items():
                        name = role["databaseBasename"] + suffix
                        entry = declared.get(kind)
                        actual = _observe_regular_at(parent_fd, name, f"sidecar {name}")
                        if entry is None:
                            if actual is not None:
                                raise StoreError(f"unmanifested sidecar exists: {name}")
                            continue
                        if actual is not None and actual != entry["identity"]:
                            raise StoreError(f"sidecar identity mismatch: {name}")
                        state = entry["state"]
                        if state == "active" and actual is None:
                            raise StoreError(f"active sidecar is missing: {name}")
                        if state == "retired" and actual is not None:
                            raise StoreError(f"retired sidecar still exists: {name}")
                        if state in ("creating", "deleting") and actual is None:
                            entry["state"] = "retired"
                            changed = True
                finally:
                    os.close(parent_fd)
            if not changed:
                return manifest
            next_generation = manifest["generation"] + 1
            candidate["generation"] = next_generation
            for role_old, role_new in zip(manifest["roles"], candidate["roles"]):
                old_by_kind = {entry["kind"]: entry for entry in role_old["sidecars"]}
                for entry in role_new["sidecars"]:
                    old = old_by_kind[entry["kind"]]
                    if old["state"] in ("creating", "deleting") and entry["state"] == "retired":
                        entry["generation"] = next_generation
            return self._commit_locked(_canonical_json(candidate))

    def load(self) -> dict[str, Any]:
        with _locked_roots(self.manifest_fd, self.anchor_fd, exclusive=False):
            return self._load_pair()[0]

    def commit(self, manifest_data: bytes) -> dict[str, Any]:
        with _locked_roots(self.manifest_fd, self.anchor_fd, exclusive=True):
            return self._commit_locked(manifest_data)

    def _commit_locked(self, manifest_data: bytes) -> dict[str, Any]:
        _, _, generation, _ = self._load_pair()
        candidate = _validate_manifest(manifest_data)
        if candidate["filesystemPolicy"]["applicationUid"] != self.application_uid:
            raise StoreError("manifest application UID does not match broker configuration")
        if candidate["metadataRootIdentity"] != self.metadata_identity():
            raise StoreError("new manifest metadata root identity does not match opened directory")
        if candidate["generation"] != generation + 1:
            raise StoreError("new manifest generation must be exactly current + 1")
        canonical = _canonical_json(candidate)
        digest = hashlib.sha256(canonical).hexdigest()
        # Stage durable manifest first. Advancing the separate anchor is the commit point.
        _write_atomic(self.manifest_fd, "manifest.tmp", STAGED, canonical)
        _write_atomic(self.anchor_fd, ANCHOR_NEXT, ANCHOR,
                      _anchor_bytes(generation + 1, digest))
        # If interrupted here, load() completes the staged generation after hash verification.
        os.replace(STAGED, MANIFEST, src_dir_fd=self.manifest_fd,
                   dst_dir_fd=self.manifest_fd)
        os.fsync(self.manifest_fd)
        return candidate


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest-root", required=True)
    parser.add_argument("--anchor-root", required=True)
    parser.add_argument("--app-uid", required=True, type=int,
                        help="application UID; must differ from broker service UID")
    parser.add_argument("command", choices=("init", "verify", "recovery-plan", "reconcile-absent", "show"))
    parser.add_argument("--input", help="manifest JSON for init")
    args = parser.parse_args()
    store = ManifestStore(args.manifest_root, args.anchor_root, args.app_uid)
    try:
        if args.command == "init":
            if not args.input:
                parser.error("init requires --input")
            fd = os.open(args.input, FILE_FLAGS)
            try:
                data = _read_fd(fd)
            finally:
                os.close(fd)
            store.initialize(data)
        if args.command == "verify":
            store.verify_roles()
        if args.command == "recovery-plan":
            sys.stdout.buffer.write(_canonical_json(store.plan_recovery()))
            return 0
        if args.command == "reconcile-absent":
            manifest = store.retire_absent_sidecars()
            print(f"manifest reconciled: generation={manifest['generation']}")
            return 0
        manifest = store.load()
        if args.command == "show":
            sys.stdout.buffer.write(_canonical_json(manifest))
        else:
            print(f"manifest verified: generation={manifest['generation']}")
        return 0
    except StoreError as exc:
        print(f"manifest-store: {exc}", file=sys.stderr)
        return 2
    finally:
        store.close()


if __name__ == "__main__":
    raise SystemExit(main())
