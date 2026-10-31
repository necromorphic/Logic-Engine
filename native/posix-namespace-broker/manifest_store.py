#!/usr/bin/env python3
"""Protected POSIX SQLite role-manifest store (enrollment/recovery primitive).

The broker does not consume this module yet. Both roots must be provisioned
for the broker service identity and must not be writable by the application.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import stat
import sys
from contextlib import contextmanager
from pathlib import PurePosixPath
from typing import Any

MANIFEST = "manifest.json"
STAGED = "manifest.next"
ANCHOR = "anchor.json"
ANCHOR_NEXT = "anchor.next"
MAX_BYTES = 1 << 20
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


def _open_trusted_dir(path: str) -> int:
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
            or not isinstance(policy.get("filesystem"), str)
            or not policy["filesystem"]):
        raise StoreError("manifest filesystemPolicy is invalid")
    def check_identity(value: Any, label: str) -> None:
        if (not isinstance(value, dict) or value.get("kind") != "posix"
                or set(value) != {"kind", "device", "inode", "mountId"}):
            raise StoreError(f"{label}: invalid POSIX identity shape")
        for key in ("device", "inode", "mountId"):
            raw = value.get(key)
            if not isinstance(raw, str) or not raw.isascii() or not raw.isdigit():
                raise StoreError(f"{label}: invalid {key}")
            if (key != "device" and raw == "0") or (len(raw) > 1 and raw[0] == "0"):
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


def _fd_identity(fd: int) -> dict[str, str]:
    info = os.fstat(fd)
    mount_id = None
    try:
        with open(f"/proc/self/fdinfo/{fd}", "r", encoding="ascii") as handle:
            for line in handle:
                if line.startswith("mnt_id:"):
                    mount_id = line.split(":", 1)[1].strip()
                    break
    except OSError as exc:
        raise StoreError(f"cannot read opened object mount identity: {exc}") from exc
    if not mount_id or not mount_id.isdigit() or mount_id == "0":
        raise StoreError("opened object mount identity is unavailable")
    return {"kind": "posix", "device": str(info.st_dev),
            "inode": str(info.st_ino), "mountId": mount_id}


def _open_role_parent(components: list[str], identities: list[dict[str, str]]) -> int:
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
            if _fd_identity(fd) != identities[index]:
                raise StoreError(f"role parent identity mismatch at component {component}")
        if os.fstat(fd).st_uid != os.geteuid() or stat.S_IMODE(os.fstat(fd).st_mode) != 0o700:
            raise StoreError("final role parent must be service-owned mode 0700")
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
        return _fd_identity(fd)
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
        if _fd_identity(fd) != expected:
            raise StoreError(f"{label} identity mismatch")
    finally:
        os.close(fd)


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
    def __init__(self, manifest_root: str, anchor_root: str):
        self.manifest_fd = _open_trusted_dir(manifest_root)
        try:
            self.anchor_fd = _open_trusted_dir(anchor_root)
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
            parent_fd = _open_role_parent(role["parentComponents"], role["parentIdentities"])
            try:
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
                parent_fd = _open_role_parent(role["parentComponents"], role["parentIdentities"])
                try:
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

    def load(self) -> dict[str, Any]:
        with _locked_roots(self.manifest_fd, self.anchor_fd, exclusive=False):
            return self._load_pair()[0]

    def commit(self, manifest_data: bytes) -> dict[str, Any]:
        with _locked_roots(self.manifest_fd, self.anchor_fd, exclusive=True):
            return self._commit_locked(manifest_data)

    def _commit_locked(self, manifest_data: bytes) -> dict[str, Any]:
        _, _, generation, _ = self._load_pair()
        candidate = _validate_manifest(manifest_data)
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
    parser.add_argument("command", choices=("init", "verify", "recovery-plan", "show"))
    parser.add_argument("--input", help="manifest JSON for init")
    args = parser.parse_args()
    store = ManifestStore(args.manifest_root, args.anchor_root)
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
