#!/usr/bin/env python3
"""Test-only broker endpoint for exercising the native SQLite VFS SCM_RIGHTS client."""
import os
import signal
import socket
import stat
import sys
from pathlib import Path

from broker_daemon import handle_connection

STOP = False


def stop(_signum, _frame):
    global STOP
    STOP = True


class FakeStore:
    """Test fixture only; production tests use ManifestStore directly."""

    def __init__(self, database: str, log_path: str):
        self.database = Path(database)
        self.log_path = Path(log_path)

    def record(self, operation: str):
        with self.log_path.open("a", encoding="ascii") as handle:
            handle.write(operation + "\n")

    def open_role_file(self, role: str, kind: str = "main") -> int:
        self.record(f"open:{role}:{kind}")
        path = self.database if kind == "main" else Path(str(self.database) + {
            "wal": "-wal", "shm": "-shm", "journal": "-journal"
        }[kind])
        fd = os.open(path, os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            os.close(fd)
            raise RuntimeError("test broker refused non-regular or multiply-linked file")
        return fd

    def open_or_create_role_sidecar(self, role: str, kind: str) -> int:
        self.record(f"open-or-create:{role}:{kind}")
        suffix = {"wal": "-wal", "shm": "-shm", "journal": "-journal"}[kind]
        path = Path(str(self.database) + suffix)
        try:
            return os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL |
                           os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        except FileExistsError:
            return self.open_role_file(role, kind)

    def create_role_sidecar(self, role: str, kind: str) -> int:
        return self.open_or_create_role_sidecar(role, kind)

    def delete_role_sidecar(self, role: str, kind: str):
        self.record(f"delete:{role}:{kind}")
        suffix = {"wal": "-wal", "shm": "-shm", "journal": "-journal"}[kind]
        try:
            os.unlink(str(self.database) + suffix)
        except FileNotFoundError:
            pass

    def role_file_exists(self, role: str, kind: str) -> bool:
        self.record(f"access:{role}:{kind}")
        path = self.database if kind == "main" else Path(str(self.database) + {
            "wal": "-wal", "shm": "-shm", "journal": "-journal"
        }[kind])
        try:
            info = os.lstat(path)
        except FileNotFoundError:
            return False
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise RuntimeError("test broker refused unsafe role file")
        return True


def main():
    socket_path, database_path, log_path = sys.argv[1:4]
    allowed_uid, allowed_gid = int(sys.argv[4]), int(sys.argv[5])
    Path(database_path).touch(mode=0o600, exist_ok=True)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
    server.bind(socket_path)
    if allowed_uid == os.geteuid():
        os.chmod(socket_path, 0o600)
    else:
        os.chown(socket_path, -1, allowed_gid, follow_symlinks=False)
        os.chmod(socket_path, 0o620)
    server.listen(8)
    store = FakeStore(database_path, log_path)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while not STOP:
            try:
                conn, _ = server.accept()
            except InterruptedError:
                continue
            try:
                handle_connection(conn, allowed_uid, store)
            finally:
                conn.close()
    finally:
        server.close()
        try:
            os.unlink(socket_path)
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    main()
