#!/usr/bin/env python3
import os
import tempfile
import unittest
from pathlib import Path

from init_manifest import build_empty_manifest
from manifest_store import ManifestStore, StoreError


class InitialManifestTests(unittest.TestCase):
    def test_bootstrap_creates_a_valid_empty_generation_one_manifest(self):
        with tempfile.TemporaryDirectory(dir=str(Path.home())) as temporary:
            root = Path(temporary)
            manifest_root = root / "manifest"
            anchor_root = root / "anchor"
            manifest_root.mkdir(mode=0o700)
            anchor_root.mkdir(mode=0o700)
            os.chmod(manifest_root, 0o700)
            os.chmod(anchor_root, 0o700)
            application_uid = os.geteuid() + 1
            store = ManifestStore(str(manifest_root), str(anchor_root), application_uid)
            try:
                store.initialize(build_empty_manifest(store, application_uid, "ext4"))
                manifest = store.load()
                self.assertEqual(manifest["generation"], 1)
                self.assertEqual(manifest["roles"], [])
                self.assertEqual(manifest["filesystemPolicy"]["applicationUid"], application_uid)
                self.assertEqual(manifest["filesystemPolicy"]["directoryMutationBoundary"],
                                 "dedicated-service-identity")
            finally:
                store.close()

    def test_bootstrap_rejects_unqualified_filesystem(self):
        with tempfile.TemporaryDirectory(dir=str(Path.home())) as temporary:
            root = Path(temporary)
            manifest_root = root / "manifest"
            anchor_root = root / "anchor"
            manifest_root.mkdir(mode=0o700)
            anchor_root.mkdir(mode=0o700)
            os.chmod(manifest_root, 0o700)
            os.chmod(anchor_root, 0o700)
            store = ManifestStore(str(manifest_root), str(anchor_root), os.geteuid() + 1)
            try:
                with self.assertRaisesRegex(StoreError, "unsupported filesystem"):
                    build_empty_manifest(store, os.geteuid() + 1, "tmpfs")
            finally:
                store.close()


if __name__ == "__main__":
    unittest.main()
