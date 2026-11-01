#!/usr/bin/env python3
"""Run the better-sqlite3 VFS against the real broker under distinct Linux UIDs.

This harness must run as root in an isolated CI VM. The app UID cannot traverse
or open the database directory; it can only use the broker's group-protected
Unix socket and SCM_RIGHTS descriptors.
"""
from __future__ import annotations

import grp
import json
import os
import pwd
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BROKER_SOURCE = REPO_ROOT / "native" / "posix-namespace-broker"
sys.path.insert(0, str(BROKER_SOURCE))
from manifest_store import _fd_filesystem, _fd_identity  # noqa: E402


DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW


def unused_ids() -> tuple[int, int, int]:
    used = {entry.pw_uid for entry in pwd.getpwall()}
    used.update(entry.gr_gid for entry in grp.getgrall())
    values = [value for value in range(50000, 65000) if value not in used]
    if len(values) < 3:
        raise RuntimeError("no unused CI UIDs/GIDs available")
    return values[0], values[1], values[2]


def drop_privileges(uid: int, gid: int):
    def apply() -> None:
        os.setgroups([gid])
        os.setgid(gid)
        os.setuid(uid)
    return apply


def identity_chain(directory: Path) -> tuple[list[str], list[dict[str, str]]]:
    components = list(directory.relative_to("/").parts)
    identities: list[dict[str, str]] = []
    current = os.open("/", DIR_FLAGS)
    try:
        for component in components:
            next_fd = os.open(component, DIR_FLAGS, dir_fd=current)
            os.close(current)
            current = next_fd
            identities.append(_fd_identity(current))
    finally:
        os.close(current)
    return components, identities


def chmod_tree(root: Path) -> None:
    for current, directories, files in os.walk(root):
        os.chmod(current, 0o755)
        for name in directories:
            os.chmod(Path(current) / name, 0o755)
        for name in files:
            path = Path(current) / name
            os.chmod(path, stat.S_IMODE(path.stat().st_mode) | 0o444)


def wait_for_broker(process: subprocess.Popen, socket_path: Path, log_path: Path) -> None:
    for _ in range(200):
        if process.poll() is not None:
            raise RuntimeError(
                "broker exited before socket readiness:\n" +
                log_path.read_text(errors="replace")
            )
        try:
            if stat.S_ISSOCK(socket_path.lstat().st_mode):
                return
        except FileNotFoundError:
            pass
        time.sleep(0.025)
    raise RuntimeError("broker socket did not become ready:\n" + log_path.read_text(errors="replace"))


def stop_broker(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.send_signal(signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def main() -> int:
    if os.geteuid() != 0:
        print("cross-UID broker integration must run under sudo/root", file=sys.stderr)
        return 2
    package_source = os.environ.get("BETTER_SQLITE3_PACKAGE_DIR")
    extension_source = os.environ.get("LOGIC_ENGINE_VFS_PROBE_PATH")
    node = shutil.which("node")
    if not package_source or not extension_source or not node:
        print("better-sqlite3 package, VFS extension and Node runtime are required", file=sys.stderr)
        return 2
    package_source_path = Path(package_source).resolve()
    extension_source_path = Path(extension_source).resolve()
    if not package_source_path.is_dir() or not extension_source_path.is_file():
        print("better-sqlite3 package or VFS extension path is missing", file=sys.stderr)
        return 2

    broker_uid, app_uid, app_gid = unused_ids()
    root = Path(tempfile.mkdtemp(prefix="logic-engine-cross-uid-", dir="/var/lib"))
    broker_process: subprocess.Popen | None = None
    broker_log = None
    try:
        os.chown(root, broker_uid, app_gid)
        os.chmod(root, 0o710)

        socket_dir = root / "socket"
        manifest_root = root / "manifest"
        anchor_root = root / "anchor"
        roles_root = root / "roles"
        role_parent = roles_root / "core"
        for directory in (socket_dir, manifest_root, anchor_root, roles_root, role_parent):
            directory.mkdir()
        for directory in (socket_dir,):
            os.chown(directory, broker_uid, app_gid)
            os.chmod(directory, 0o710)
        for directory in (manifest_root, anchor_root, roles_root, role_parent):
            os.chown(directory, broker_uid, app_gid)
            os.chmod(directory, 0o700)

        artifacts = root / "artifacts"
        app_tests = root / "app-tests"
        broker_source_copy = root / "broker-src"
        artifacts.mkdir()
        app_tests.mkdir()
        shutil.copytree(BROKER_SOURCE, broker_source_copy)
        shutil.copytree(package_source_path, artifacts / "better-sqlite3")
        shutil.copy2(extension_source_path, artifacts / "secure-vfs-probe.so")
        shutil.copy2(REPO_ROOT / "tests" / "better-sqlite3-vfs-cross-uid.test.js", app_tests)
        shutil.copy2(REPO_ROOT / "tests" / "better-sqlite3-vfs-cross-uid-recovery.test.js", app_tests)
        for directory in (artifacts, app_tests, broker_source_copy):
            chmod_tree(directory)
        for path in root.rglob("*"):
            if path.is_file() and path.parent in (artifacts, app_tests):
                os.chmod(path, 0o644)
        os.chmod(artifacts / "secure-vfs-probe.so", 0o755)

        database_path = role_parent / "core.sqlite"
        database_fd = os.open(
            database_path,
            os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW,
            0o600,
        )
        try:
            os.fchown(database_fd, broker_uid, app_gid)
            os.fchmod(database_fd, 0o600)
            os.fsync(database_fd)
            database_identity = _fd_identity(database_fd)
        finally:
            os.close(database_fd)

        manifest_fd = os.open(manifest_root, DIR_FLAGS)
        try:
            metadata_identity = _fd_identity(manifest_fd)
            filesystem = _fd_filesystem(manifest_fd)
        finally:
            os.close(manifest_fd)
        components, parent_identities = identity_chain(role_parent)
        manifest = {
            "schemaVersion": 1,
            "generation": 1,
            "platform": "linux",
            "metadataRootIdentity": metadata_identity,
            "filesystemPolicy": {
                "filesystem": filesystem,
                "identitySource": "opened-handle",
                "directoryMutationBoundary": "broker-exclusive-owner",
                "applicationUid": app_uid,
            },
            "roles": [{
                "role": "core",
                "parentComponents": components,
                "parentIdentities": parent_identities,
                "databaseBasename": database_path.name,
                "databaseIdentity": database_identity,
                "state": "active",
                "sidecars": [],
            }],
        }

        init_code = (
            "import sys; from manifest_store import ManifestStore; "
            "s=ManifestStore(sys.argv[1],sys.argv[2],int(sys.argv[3])); "
            "s.initialize(sys.stdin.buffer.read()); s.verify_roles(); s.close()"
        )
        init_env = os.environ.copy()
        init_env["PYTHONPATH"] = str(broker_source_copy)
        initialized = subprocess.run(
            [sys.executable, "-c", init_code, str(manifest_root), str(anchor_root), str(app_uid)],
            input=json.dumps(manifest, separators=(",", ":")).encode(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=broker_source_copy,
            env=init_env,
            preexec_fn=drop_privileges(broker_uid, app_gid),
            check=False,
        )
        if initialized.returncode != 0:
            raise RuntimeError(
                "manifest initialization failed:\n" +
                initialized.stdout.decode(errors="replace") +
                initialized.stderr.decode(errors="replace")
            )

        socket_path = socket_dir / "broker.sock"
        broker_log_path = root / "broker.log"
        broker_log = open(broker_log_path, "ab", buffering=0)
        broker_script = broker_source_copy / "broker_daemon.py"
        broker_env = os.environ.copy()
        broker_env["PYTHONPATH"] = str(broker_source_copy)

        def start_broker() -> subprocess.Popen:
            process = subprocess.Popen(
                [
                    sys.executable, str(broker_script),
                    "--socket", str(socket_path),
                    "--manifest-root", str(manifest_root),
                    "--anchor-root", str(anchor_root),
                    "--app-uid", str(app_uid),
                    "--app-gid", str(app_gid),
                ],
                cwd=broker_source_copy,
                env=broker_env,
                stdout=broker_log,
                stderr=subprocess.STDOUT,
                preexec_fn=drop_privileges(broker_uid, app_gid),
                close_fds=True,
            )
            wait_for_broker(process, socket_path, broker_log_path)
            return process

        app_env = os.environ.copy()
        app_env.update({
            "BETTER_SQLITE3_PACKAGE_DIR": str(artifacts / "better-sqlite3"),
            "LOGIC_ENGINE_VFS_PROBE_PATH": str(artifacts / "secure-vfs-probe.so"),
            "LOGIC_ENGINE_DATABASE_PATH": str(database_path),
            "LOGIC_ENGINE_BROKER_SOCKET": str(socket_path),
            "LOGIC_ENGINE_BROKER_UID": str(broker_uid),
            "LOGIC_ENGINE_APP_UID": str(app_uid),
            "LOGIC_ENGINE_APP_GID": str(app_gid),
            "HOME": "/tmp",
            "TMPDIR": "/tmp",
        })

        def run_app(test_name: str) -> None:
            result = subprocess.run(
                [node, "--test", str(app_tests / test_name)],
                cwd=app_tests,
                env=app_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                preexec_fn=drop_privileges(app_uid, app_gid),
                check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    f"app UID {app_uid} test {test_name} failed:\n{result.stdout}\n"
                    f"broker log:\n{broker_log_path.read_text(errors='replace')}"
                )

        broker_process = start_broker()
        run_app("better-sqlite3-vfs-cross-uid.test.js")
        stop_broker(broker_process)
        broker_process = None

        broker_process = start_broker()
        run_app("better-sqlite3-vfs-cross-uid-recovery.test.js")
        stop_broker(broker_process)
        broker_process = None

        log_text = broker_log_path.read_text(errors="replace")
        if log_text.count("startup reconciliation complete") < 2:
            raise RuntimeError("broker did not complete startup reconciliation twice:\n" + log_text)
        print(
            "PASS: better-sqlite3 VFS used broker-returned descriptors across distinct UIDs; "
            "broker restart and SQLite WAL crash recovery succeeded."
        )
        return 0
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    finally:
        stop_broker(broker_process)
        if broker_log is not None:
            broker_log.close()
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
