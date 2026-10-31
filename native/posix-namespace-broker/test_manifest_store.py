#!/usr/bin/env python3
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path

from manifest_store import ManifestStore, StoreError, _anchor_bytes, _canonical_json, _write_atomic


def identity(inode: int) -> dict:
    return {"kind": "posix", "device": "1", "inode": str(inode), "mountId": "1"}


def manifest(generation: int) -> bytes:
    return _canonical_json({
        "schemaVersion": 1,
        "generation": generation,
        "platform": "linux",
        "metadataRootIdentity": identity(10),
        "filesystemPolicy": {
            "filesystem": "ext4",
            "identitySource": "opened-handle",
            "directoryMutationBoundary": "dedicated-service-identity"
        },
        "roles": [{
            "role": "core",
            "parentComponents": ["data"],
            "parentIdentities": [identity(11)],
            "databaseBasename": "core.sqlite",
            "databaseIdentity": identity(12),
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
        self.store = ManifestStore(str(self.manifest_root), str(self.anchor_root))

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def test_initialize_and_load(self):
        self.store.initialize(manifest(1))
        self.assertEqual(self.store.load()["generation"], 1)

    def test_commit_advances_generation(self):
        self.store.initialize(manifest(1))
        self.assertEqual(self.store.commit(manifest(2))["generation"], 2)
        self.assertEqual(self.store.load()["generation"], 2)

    def test_rejects_generation_skip(self):
        self.store.initialize(manifest(1))
        with self.assertRaises(StoreError):
            self.store.commit(manifest(3))

    def test_recovers_crash_after_anchor_commit(self):
        self.store.initialize(manifest(1))
        staged = manifest(2)
        digest = hashlib.sha256(staged).hexdigest()
        _write_atomic(self.store.manifest_fd, "manifest.tmp", "manifest.next", staged)
        _write_atomic(self.store.anchor_fd, "anchor.tmp", "anchor.json",
                      _anchor_bytes(2, digest))
        self.assertEqual(self.store.load()["generation"], 2)
        self.assertTrue((self.manifest_root / "manifest.json").exists())
        self.assertFalse((self.manifest_root / "manifest.next").exists())

    def test_rejects_manifest_rollback_or_tampering(self):
        self.store.initialize(manifest(1))
        self.store.commit(manifest(2))
        (self.manifest_root / "manifest.json").write_bytes(manifest(1))
        with self.assertRaises(StoreError):
            self.store.load()

    def test_rejects_symlinked_manifest(self):
        self.store.initialize(manifest(1))
        (self.manifest_root / "manifest.json").unlink()
        target = self.manifest_root / "target"
        target.write_bytes(manifest(1))
        os.chmod(target, 0o600)
        (self.manifest_root / "manifest.json").symlink_to(target)
        with self.assertRaises(OSError):
            self.store.load()

    def test_rejects_duplicate_json_keys(self):
        self.store.initialize(manifest(1))
        bad = b'{"schemaVersion":1,"schemaVersion":1}'
        with self.assertRaises(StoreError):
            self.store.commit(bad)


if __name__ == "__main__":
    unittest.main(verbosity=2)
