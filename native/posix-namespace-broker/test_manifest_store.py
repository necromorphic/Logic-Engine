#!/usr/bin/env python3
import hashlib
import os
import stat
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from manifest_store import (
    ManifestStore, StoreError, _anchor_bytes, _canonical_json, _open_role_parent, _validate_manifest,
    _write_atomic, _quarantine_delete_at
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
            "applicationUid": os.geteuid() ^ 1
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
        self.application_uid = os.geteuid() ^ 1
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

    def test_rejects_database_identity_aliased_across_roles(self):
        import json
        value = json.loads(self.data(1))
        second = dict(value["roles"][0])
        second["role"] = "vectors"
        value["roles"].append(second)
        with self.assertRaises(StoreError):
            _validate_manifest(_canonical_json(value))

    def test_rejects_sidecar_identity_aliased_to_database(self):
        import json
        value = json.loads(self.data(1))
        value["generation"] = 2
        value["roles"][0]["sidecars"] = [{
            "kind": "wal", "identity": value["roles"][0]["databaseIdentity"],
            "state": "active", "generation": 2
        }]
        with self.assertRaises(StoreError):
            _validate_manifest(_canonical_json(value))

    def test_retired_sidecar_identity_may_be_reused_by_live_role_file(self):
        import json
        value = json.loads(self.data(1))
        second = dict(value["roles"][0])
        second["role"] = "vectors"
        reused_identity = {
            "kind": "posix", "device": "99999999",
            "inode": "99999998", "mountId": "99999997"
        }
        second["databaseIdentity"] = reused_identity
        value["roles"][0]["sidecars"] = [{
            "kind": "wal", "identity": reused_identity,
            "state": "retired", "generation": 1
        }]
        value["roles"].append(second)
        # A retired identity is historical evidence; the filesystem may reuse
        # its inode after deletion, so it must not block a new live role.
        _validate_manifest(_canonical_json(value))

    def test_commit_rejects_database_identity_replacement(self):
        import json
        self.store.initialize(self.data(1))
        value = json.loads(self.data(2))
        value["roles"][0]["databaseIdentity"] = {
            "kind": "posix", "device": "99999999",
            "inode": "99999998", "mountId": "99999997"
        }
        with self.assertRaises(StoreError):
            self.store.commit(_canonical_json(value))
        self.assertEqual(self.store.load()["generation"], 1)

    def test_commit_rejects_active_sidecar_directly_retired(self):
        _wal, _identity = self._enroll_active_wal()
        import json
        current = self.store.load()
        value = json.loads(_canonical_json(current))
        value["generation"] = current["generation"] + 1
        value["roles"][0]["sidecars"][0]["state"] = "retired"
        value["roles"][0]["sidecars"][0]["generation"] = value["generation"]
        with self.assertRaises(StoreError):
            self.store.commit(_canonical_json(value))
        self.assertEqual(self.store.load()["generation"], current["generation"])

    def test_commit_allows_retired_sidecar_replacement_in_creating_state(self):
        import json
        self.store.initialize(self.data(1))
        value = json.loads(self.data(2))
        identity = {
            "kind": "posix", "device": "99999999",
            "inode": "99999998", "mountId": "99999997"
        }
        value["roles"][0]["sidecars"] = [{
            "kind": "wal", "identity": identity,
            "state": "creating", "generation": 2
        }]
        self.store.commit(_canonical_json(value))
        value = json.loads(_canonical_json(self.store.load()))
        value["generation"] = 3
        value["roles"][0]["sidecars"][0]["state"] = "deleting"
        value["roles"][0]["sidecars"][0]["generation"] = 3
        self.store.commit(_canonical_json(value))
        value = json.loads(_canonical_json(self.store.load()))
        value["generation"] = 4
        value["roles"][0]["sidecars"][0]["state"] = "retired"
        value["roles"][0]["sidecars"][0]["generation"] = 4
        self.store.commit(_canonical_json(value))
        value = json.loads(_canonical_json(self.store.load()))
        value["generation"] = 5
        value["roles"][0]["sidecars"][0]["state"] = "creating"
        value["roles"][0]["sidecars"][0]["generation"] = 5
        self.store.commit(_canonical_json(value))
        self.assertEqual(self.store.load()["roles"][0]["sidecars"][0]["state"], "creating")

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

    def test_rejects_application_owned_writable_directory_ancestor(self):
        import json
        value = json.loads(self.data(1))
        real_fstat = os.fstat

        def app_owned_writable(fd):
            info = real_fstat(fd)
            fields = list(info)
            fields[0] |= stat.S_IWUSR
            fields[4] = self.application_uid
            return os.stat_result(fields)

        with patch("manifest_store.os.fstat", side_effect=app_owned_writable):
            with self.assertRaises(StoreError):
                _open_role_parent(
                    value["roles"][0]["parentComponents"],
                    value["roles"][0]["parentIdentities"],
                    value["filesystemPolicy"]["filesystem"],
                    self.application_uid,
                )

    def test_rejects_manifest_for_different_application_uid(self):
        import json
        value = json.loads(self.data(1))
        value["filesystemPolicy"]["applicationUid"] = self.application_uid + 1
        with self.assertRaises(StoreError):
            self.store.initialize(_canonical_json(value))

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
            {"kind": "shm", "identity": shm_identity, "state": "creating", "generation": 2},
        ]
        self.store.initialize(self.data(1))
        self.store.commit(_canonical_json(value))
        value["generation"] = 3
        value["roles"][0]["sidecars"][1]["state"] = "deleting"
        value["roles"][0]["sidecars"][1]["generation"] = 3
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
            "kind": "wal", "identity": wal_identity,
            "state": "creating", "generation": 2,
        }]
        self.store.initialize(self.data(1))
        self.store.commit(_canonical_json(value))
        value["generation"] = 3
        value["roles"][0]["sidecars"][0]["state"] = "deleting"
        value["roles"][0]["sidecars"][0]["generation"] = 3
        self.store.commit(_canonical_json(value))

        result = self.store.retire_absent_sidecars()
        self.assertEqual(result["generation"], 4)
        self.assertEqual(result["roles"][0]["sidecars"][0]["state"], "retired")
        self.assertEqual(result["roles"][0]["sidecars"][0]["generation"], 4)
        self.assertFalse(wal.exists())
        self.assertEqual(self.store.load()["generation"], 4)

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
            "kind": "wal", "identity": wal_identity,
            "state": "creating", "generation": 2,
        }]
        self.store.initialize(self.data(1))
        self.store.commit(_canonical_json(value))
        value["generation"] = 3
        value["roles"][0]["sidecars"][0]["state"] = "deleting"
        value["roles"][0]["sidecars"][0]["generation"] = 3
        self.store.commit(_canonical_json(value))

        result = self.store.retire_absent_sidecars()
        self.assertEqual(result["generation"], 3)
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


    def test_open_role_file_returns_verified_main_database_descriptor(self):
        self.store.initialize(self.data(1))
        fd = self.store.open_role_file("core")
        try:
            self.assertEqual(os.read(fd, 64), b"sqlite-test-placeholder")
            self.assertEqual(fd_identity(fd), self.store.load()["roles"][0]["databaseIdentity"])
        finally:
            os.close(fd)

    def test_open_role_file_requires_manifested_active_sidecar(self):
        self.store.initialize(self.data(1))
        wal = self.role_parent / "core.sqlite-wal"
        wal.write_bytes(b"wal-placeholder")
        os.chmod(wal, 0o600)
        with self.assertRaises(StoreError):
            self.store.open_role_file("core", "wal")

        wal_fd = os.open(wal, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            wal_identity = fd_identity(wal_fd)
        finally:
            os.close(wal_fd)
        import json
        value = json.loads(self.data(1))
        value["generation"] = 2
        value["roles"][0]["sidecars"] = [{
            "kind": "wal", "identity": wal_identity, "state": "creating", "generation": 2
        }]
        self.store.commit(_canonical_json(value))
        value["generation"] = 3
        value["roles"][0]["sidecars"][0]["state"] = "active"
        value["roles"][0]["sidecars"][0]["generation"] = 3
        self.store.commit(_canonical_json(value))
        fd = self.store.open_role_file("core", "wal")
        try:
            self.assertEqual(os.read(fd, 64), b"wal-placeholder")
            self.assertEqual(fd_identity(fd), wal_identity)
        finally:
            os.close(fd)


    def test_open_role_file_descriptor_survives_parent_path_replacement(self):
        self.store.initialize(self.data(1))
        fd = self.store.open_role_file("core")
        moved_parent = self.role_parent.with_name("role-data-original")
        os.rename(self.role_parent, moved_parent)
        self.role_parent.mkdir(mode=0o700)
        decoy = self.role_parent / "core.sqlite"
        decoy.write_bytes(b"decoy-database")
        os.chmod(decoy, 0o600)
        decoy_fd = os.open(decoy, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            self.assertEqual(os.read(fd, 64), b"sqlite-test-placeholder")
            self.assertNotEqual(fd_identity(fd), fd_identity(decoy_fd))
        finally:
            os.close(decoy_fd)
            os.close(fd)


    def _enroll_active_wal(self):
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
            "kind": "wal", "identity": wal_identity, "state": "creating", "generation": 2
        }]
        self.store.initialize(self.data(1))
        self.store.commit(_canonical_json(value))
        value["generation"] = 3
        value["roles"][0]["sidecars"][0]["state"] = "active"
        value["roles"][0]["sidecars"][0]["generation"] = 3
        self.store.commit(_canonical_json(value))
        return wal, wal_identity

    def test_create_role_sidecar_persists_identity_before_returning_descriptor(self):
        self.store.initialize(self.data(1))
        fd = self.store.create_role_sidecar("core", "wal")
        try:
            self.assertEqual(os.fstat(fd).st_size, 0)
            manifest_after = self.store.load()
            self.assertEqual(manifest_after["generation"], 3)
            sidecar = manifest_after["roles"][0]["sidecars"][0]
            self.assertEqual(sidecar["kind"], "wal")
            self.assertEqual(sidecar["state"], "active")
            self.assertEqual(sidecar["identity"], fd_identity(fd))
            reopened_fd = self.store.open_role_file("core", "wal")
            try:
                self.assertEqual(fd_identity(reopened_fd), sidecar["identity"])
            finally:
                os.close(reopened_fd)
        finally:
            os.close(fd)

    def test_create_role_sidecar_never_adopts_an_existing_path(self):
        self.store.initialize(self.data(1))
        wal = self.role_parent / "core.sqlite-wal"
        wal.write_bytes(b"untrusted")
        with self.assertRaises(StoreError):
            self.store.create_role_sidecar("core", "wal")
        self.assertEqual(wal.read_bytes(), b"untrusted")
        self.assertEqual(self.store.load()["generation"], 1)

    def test_role_file_exists_checks_main_and_manifested_sidecars(self):
        self.store.initialize(self.data(1))
        self.assertTrue(self.store.role_file_exists("core", "main"))
        self.assertFalse(self.store.role_file_exists("core", "wal"))
        fd = self.store.open_or_create_role_sidecar("core", "wal")
        os.close(fd)
        self.assertTrue(self.store.role_file_exists("core", "wal"))

    def test_role_file_exists_rejects_replaced_database_identity(self):
        self.store.initialize(self.data(1))
        replacement = self.role_parent / "replacement.sqlite"
        replacement.write_bytes(b"replacement")
        replacement.replace(self.database)
        with self.assertRaises(StoreError):
            self.store.role_file_exists("core", "main")

    def test_open_or_create_sidecar_durably_creates_then_reopens_same_identity(self):
        self.store.initialize(self.data(1))
        first_fd = self.store.open_or_create_role_sidecar("core", "wal")
        try:
            first_identity = fd_identity(first_fd)
            self.assertEqual(self.store.load()["generation"], 3)
            second_fd = self.store.open_or_create_role_sidecar("core", "wal")
            try:
                self.assertEqual(fd_identity(second_fd), first_identity)
                self.assertEqual(self.store.load()["generation"], 3)
            finally:
                os.close(second_fd)
        finally:
            os.close(first_fd)

    def test_open_or_create_sidecar_does_not_adopt_unmanifested_existing_file(self):
        self.store.initialize(self.data(1))
        wal = self.role_parent / "core.sqlite-wal"
        wal.write_bytes(b"untrusted")
        with self.assertRaises(StoreError):
            self.store.open_or_create_role_sidecar("core", "wal")
        self.assertEqual(wal.read_bytes(), b"untrusted")
        self.assertEqual(self.store.load()["generation"], 1)

    def test_open_role_parent_directory_verifies_database_and_returns_parent_fd(self):
        self.store.initialize(self.data(1))
        fd = self.store.open_role_parent_directory("core")
        try:
            info = os.fstat(fd)
            self.assertTrue(stat.S_ISDIR(info.st_mode))
            self.assertEqual((info.st_dev, info.st_ino),
                             (self.role_parent.stat().st_dev, self.role_parent.stat().st_ino))
        finally:
            os.close(fd)

    def test_open_role_parent_rejects_replaced_database(self):
        self.store.initialize(self.data(1))
        replacement = self.role_parent / "replacement.sqlite"
        replacement.write_bytes(b"replacement")
        replacement.replace(self.database)
        with self.assertRaises(StoreError):
            self.store.open_role_parent_directory("core")

    def test_delete_role_sidecar_quarantines_and_commits_retired_state(self):
        wal, _identity = self._enroll_active_wal()
        result = self.store.delete_role_sidecar("core", "wal")
        self.assertEqual(result["generation"], 5)
        sidecar = result["roles"][0]["sidecars"][0]
        self.assertEqual(sidecar["state"], "retired")
        self.assertEqual(sidecar["generation"], 5)
        self.assertFalse(wal.exists())
        quarantine = self.role_parent / ".le-quarantine"
        self.assertTrue(quarantine.is_dir())
        self.assertEqual(list(quarantine.iterdir()), [])

    def test_delete_role_sidecar_is_idempotent_after_retired_transition(self):
        wal, _identity = self._enroll_active_wal()
        first = self.store.delete_role_sidecar("core", "wal")
        second = self.store.delete_role_sidecar("core", "wal")
        self.assertEqual(first["generation"], second["generation"])
        self.assertEqual(second["roles"][0]["sidecars"][0]["state"], "retired")
        self.assertFalse(wal.exists())

    def test_delete_absent_unmanifested_sidecar_is_idempotent(self):
        self.store.initialize(self.data(1))
        result = self.store.delete_role_sidecar("core", "wal")
        self.assertEqual(result["generation"], 1)
        self.assertFalse((self.role_parent / "core.sqlite-wal").exists())

    def test_delete_role_sidecar_retains_replacement_in_quarantine(self):
        import manifest_store
        wal, _identity = self._enroll_active_wal()
        original_rename = manifest_store._renameat2_noreplace

        def replace_before_atomic_rename(parent_fd, old_name, quarantine_fd, new_name):
            os.unlink(old_name, dir_fd=parent_fd)
            replacement_fd = os.open(
                old_name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW,
                0o600,
                dir_fd=parent_fd,
            )
            try:
                os.write(replacement_fd, b"attacker-replacement")
            finally:
                os.close(replacement_fd)
            return original_rename(parent_fd, old_name, quarantine_fd, new_name)

        with patch("manifest_store._renameat2_noreplace",
                   side_effect=replace_before_atomic_rename):
            with self.assertRaises(StoreError):
                self.store.delete_role_sidecar("core", "wal")

        self.assertFalse(wal.exists())
        manifest = self.store.load()
        self.assertEqual(manifest["roles"][0]["sidecars"][0]["state"], "deleting")
        quarantine = self.role_parent / ".le-quarantine"
        retained = list(quarantine.iterdir())
        self.assertEqual(len(retained), 1)
        self.assertEqual(retained[0].read_bytes(), b"attacker-replacement")
        with self.assertRaises(StoreError):
            self.store.plan_recovery()


    def test_quarantine_delete_rejects_nul_in_basename(self):
        parent_fd = os.open(self.role_parent, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        try:
            with self.assertRaises(StoreError):
                _quarantine_delete_at(parent_fd, "bad\x00name", {})
        finally:
            os.close(parent_fd)


if __name__ == "__main__":
    unittest.main(verbosity=2)
