#!/usr/bin/env python3
import hashlib
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

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
             parent_identities: list, database_identity: dict, sidecars: list | None = None) -> bytes:
    return _canonical_json({
        "schemaVersion": 1,
        "generation": generation,
        "platform": "linux",
        "metadataRootIdentity": root_identity,
        "filesystemPolicy": {
            "filesystem": "ext4",
            "identitySource": "opened-handle",
            "directoryMutationBoundary": "dedicated-service-identity",
            "applicationUid": os.getuid() ^ 1
        },
        "roles": [{
            "role": "core",
            "parentComponents": components,
            "parentIdentities": parent_identities,
            "databaseBasename": "core.sqlite",
            "databaseIdentity": database_identity,
            "state": "active",
            "sidecars": sidecars or []
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
        self.application_uid = os.getuid() ^ 1
        self.store = ManifestStore(str(self.manifest_root), str(self.anchor_root), self.application_uid)

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

    def test_concurrent_commits_are_serialized(self):
        self.store.initialize(self.data(1))
        barrier = threading.Barrier(2)
        outcomes = []
        failures = []

        def writer():
            local_store = ManifestStore(str(self.manifest_root), str(self.anchor_root), self.application_uid)
            try:
                barrier.wait(timeout=5)
                local_store.commit(self.data(2))
                outcomes.append("committed")
            except StoreError:
                outcomes.append("rejected")
            except Exception as exc:
                failures.append(repr(exc))
            finally:
                local_store.close()

        threads = [threading.Thread(target=writer) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        self.assertTrue(all(not thread.is_alive() for thread in threads))
        self.assertEqual(failures, [])
        self.assertCountEqual(outcomes, ["committed", "rejected"])
        self.assertEqual(self.store.load()["generation"], 2)

    def test_rejects_commit_for_different_metadata_root(self):
        self.store.initialize(self.data(1))
        other = self.manifest_root.parent / "other-metadata-root"
        other.mkdir(mode=0o700)
        os.chmod(other, 0o700)
        other_fd = os.open(other, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        try:
            other_identity = fd_identity(other_fd)
        finally:
            os.close(other_fd)
        candidate = self.data(2)
        import json
        value = json.loads(candidate)
        value["metadataRootIdentity"] = other_identity
        with self.assertRaises(StoreError):
            self.store.commit(_canonical_json(value))
        self.assertEqual(self.store.load()["generation"], 1)

    def test_recovery_plan_inspects_transitional_sidecars_without_mutation(self):
        wal = self.role_parent / "core.sqlite-wal"
        wal.write_bytes(b"wal-placeholder")
        os.chmod(wal, 0o600)
        wal_fd = os.open(wal, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            wal_identity = fd_identity(wal_fd)
        finally:
            os.close(wal_fd)

        shm = self.role_parent / "core.sqlite-shm"
        shm.write_bytes(b"shm-placeholder")
        os.chmod(shm, 0o600)
        shm_fd = os.open(shm, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            shm_identity = fd_identity(shm_fd)
        finally:
            os.close(shm_fd)
        shm.unlink()

        # Reuse the enrolled role's exact directory and database identities.
        import json
        value = json.loads(self.data(1))
        value["generation"] = 2
        value["roles"][0]["sidecars"] = [
            {"kind": "wal", "identity": wal_identity, "state": "creating", "generation": 2},
            {"kind": "shm", "identity": shm_identity, "state": "deleting", "generation": 2},
        ]
        self.store.initialize(self.data(1))
        self.store.commit(_canonical_json(value))

        plan = self.store.plan_recovery()
        self.assertEqual(plan["mode"], "inspect-only")
        states = {entry["kind"]: entry for entry in plan["roles"][0]["sidecars"]}
        self.assertTrue(states["wal"]["present"])
        self.assertIn("validate with SQLite", states["wal"]["disposition"])
        self.assertFalse(states["shm"]["present"])
        self.assertIn("deletion-completed", states["shm"]["disposition"])
        self.assertTrue(wal.exists())
        self.assertFalse(shm.exists())

    def test_recovery_plan_rejects_unmanifested_sidecar(self):
        self.store.initialize(self.data(1))
        (self.role_parent / "core.sqlite-wal").write_bytes(b"unexpected")
        with self.assertRaises(StoreError):
            self.store.plan_recovery()

    def test_reconcile_absent_transitional_sidecar_commits_retired_state(self):
        wal = self.role_parent / "core.sqlite-wal"
        wal.write_bytes(b"wal-placeholder")
        os.chmod(wal, 0o600)
        wal_fd = os.open(wal, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            wal_identity = fd_identity(wal_fd)
        finally:
            os.close(wal_fd)
        wal.unlink()

        import json
        value = json.loads(self.data(1))
        value["generation"] = 2
        value["roles"][0]["sidecars"] = [{
            "kind": "wal",
            "identity": wal_identity,
            "state": "deleting",
            "generation": 2,
        }]
        self.store.initialize(self.data(1))
        self.store.commit(_canonical_json(value))

        result = self.store.retire_absent_sidecars()
        self.assertEqual(result["generation"], 3)
        self.assertEqual(result["roles"][0]["sidecars"][0]["state"], "retired")
        self.assertEqual(result["roles"][0]["sidecars"][0]["generation"], 3)
        self.assertFalse(wal.exists())
        self.assertEqual(self.store.load()["generation"], 3)

    def test_reconcile_does_not_retire_present_transitional_sidecar(self):
        wal = self.role_parent / "core.sqlite-wal"
        wal.write_bytes(b"wal-placeholder")
        os.chmod(wal, 0o600)
        wal_fd = os.open(wal, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            wal_identity = fd_identity(wal_fd)
        finally:
            os.close(wal_fd)

        import json
        value = json.loads(self.data(1))
        value["generation"] = 2
        value["roles"][0]["sidecars"] = [{
            "kind": "wal",
            "identity": wal_identity,
            "state": "deleting",
            "generation": 2,
        }]
        self.store.initialize(self.data(1))
        self.store.commit(_canonical_json(value))

        result = self.store.retire_absent_sidecars()
        self.assertEqual(result["generation"], 2)
        self.assertEqual(result["roles"][0]["sidecars"][0]["state"], "deleting")
        self.assertTrue(wal.exists())

    def test_rejects_zero_identity_components(self):
        import json
        for component in ("device", "inode", "mountId"):
            with self.subTest(component=component):
                value = json.loads(self.data(1))
                value["roles"][0]["databaseIdentity"][component] = "0"
                with self.assertRaises(StoreError):
                    self.store.initialize(_canonical_json(value))

    def test_rejects_unqualified_filesystem_policy(self):
        import json
        value = json.loads(self.data(1))
        value["filesystemPolicy"]["filesystem"] = "overlay"
        with self.assertRaises(StoreError):
            self.store.initialize(_canonical_json(value))

    def test_rejects_runtime_filesystem_policy_mismatch(self):
        self.store.initialize(self.data(1))
        with patch("manifest_store._fd_filesystem", return_value="xfs"):
            with self.assertRaises(StoreError):
                self.store.verify_roles()

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
