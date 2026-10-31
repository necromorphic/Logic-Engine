#!/usr/bin/env python3
import hashlib
import os
import tempfile
import unittest
from pathlib import Path

from manifest_store import (
    ManifestStore, StoreError, _anchor_bytes, _canonical_json, _write_atomic
)


def fd_identity(fd: int) -> dict:
    info = os.fstat(fd)
    with open(f"/proc/self/fdinfo/{fd}", "r", encoding="ascii") as handle:
        mount_id = next(line.split(":", 1)[1].strip()
                        for line in handle if line.startswith("mnt_id:"))
    return {"kind": "posix", "device": str(info.st_dev),
            "inode": str(info.st_ino), "mountId": mount_id}


def manifest(generation: int, root_identity: dict, components: list,
             parent_identities: list, database_identity: dict) -> bytes:
    return _canonical_json({
        "schemaVersion": 1,
        "generation": generation,
        "platform": "linux",
        "metadataRootIdentity": root_identity,
        "filesystemPolicy": {
            "filesystem": "ext4",
            "identitySource": "opened-handle",
            "directoryMutationBoundary": "dedicated-service-identity"
        },
        "roles": [{
            "role": "core",
            "parentComponents": components,
            "parentIdentities": parent_identities,
            "databaseBasename": "core.sqlite",
            "databaseIdentity": database_identity,
            "state": "active",
            "sidecars": []
        }]
    })


class ManifestStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=str(Path.home()))
        base = Path(self.temp.name)
        self.manifest_root = base / "manifest"
        self.anchor_root = base / "anchor"
        self.manifest_root.mkdir(mode=0o700)
        self.anchor_root.mkdir(mode=0o700)
        os.chmod(self.manifest_root, 0o700)
        os.chmod(self.anchor_root, 0o700)
        self.role_parent = base / "role-data"
        self.role_parent.mkdir(mode=0o700)
        os.chmod(self.role_parent, 0o700)
        self.database = self.role_parent / "core.sqlite"
        self.database.write_bytes(b"sqlite-test-placeholder")
        os.chmod(self.database, 0o600)
        self.store = ManifestStore(str(self.manifest_root), str(self.anchor_root))

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def data(self, generation: int) -> bytes:
        components = list(self.role_parent.parts[1:])
        identities = []
        fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        try:
            for component in components:
                next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY |
                                   os.O_CLOEXEC | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = next_fd
                identities.append(fd_identity(fd))
        finally:
            os.close(fd)
        db_fd = os.open(self.database, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            db_identity = fd_identity(db_fd)
        finally:
            os.close(db_fd)
        return manifest(generation, self.store.metadata_identity(),
                        components, identities, db_identity)

    def test_initialize_and_load(self):
        self.store.initialize(self.data(1))
        self.assertEqual(self.store.load()["generation"], 1)

    def test_commit_advances_generation(self):
        self.store.initialize(self.data(1))
        self.assertEqual(self.store.commit(self.data(2))["generation"], 2)
        self.assertEqual(self.store.load()["generation"], 2)

    def test_rejects_generation_skip(self):
        self.store.initialize(self.data(1))
        with self.assertRaises(StoreError):
            self.store.commit(self.data(3))

    def test_recovers_crash_after_anchor_commit(self):
        self.store.initialize(self.data(1))
        staged = self.data(2)
        digest = hashlib.sha256(staged).hexdigest()
        _write_atomic(self.store.manifest_fd, "manifest.tmp", "manifest.next", staged)
        _write_atomic(self.store.anchor_fd, "anchor.tmp", "anchor.json",
                      _anchor_bytes(2, digest))
        self.assertEqual(self.store.load()["generation"], 2)
        self.assertTrue((self.manifest_root / "manifest.json").exists())
        self.assertFalse((self.manifest_root / "manifest.next").exists())

    def test_rejects_manifest_rollback_or_tampering(self):
        self.store.initialize(self.data(1))
        self.store.commit(self.data(2))
        (self.manifest_root / "manifest.json").write_bytes(self.data(1))
        with self.assertRaises(StoreError):
            self.store.load()

    def test_rejects_symlinked_manifest(self):
        self.store.initialize(self.data(1))
        (self.manifest_root / "manifest.json").unlink()
        target = self.manifest_root / "target"
        target.write_bytes(self.data(1))
        os.chmod(target, 0o600)
        (self.manifest_root / "manifest.json").symlink_to(target)
        with self.assertRaises(OSError):
            self.store.load()

    def test_rejects_duplicate_json_keys(self):
        self.store.initialize(self.data(1))
        bad = b'{"schemaVersion":1,"schemaVersion":1}'
        with self.assertRaises(StoreError):
            self.store.commit(bad)

    def test_verifies_database_identity_from_open_descriptor(self):
        self.store.initialize(self.data(1))
        self.store.verify_roles()

    def test_rejects_replaced_database_identity(self):
        self.store.initialize(self.data(1))
        replacement = self.role_parent / "replacement"
        replacement.write_bytes(b"replacement")
        os.chmod(replacement, 0o600)
        os.replace(replacement, self.database)
        with self.assertRaises(StoreError):
            self.store.verify_roles()


if __name__ == "__main__":
    unittest.main(verbosity=2)
