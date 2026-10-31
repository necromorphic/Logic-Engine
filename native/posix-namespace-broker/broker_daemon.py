#!/usr/bin/env python3
"""Manifest-backed POSIX SQLite descriptor broker (Linux prototype).

Requests identify logical database roles and sidecar kinds only. Clients never
supply filesystem paths. Returned descriptors are the exact handles validated
against the persistent role manifest.
"""
from __future__ import annotations

import argparse
import array
import os
import pwd
import re
import signal
import socket
import stat
import struct
import sys
from typing import Any

from manifest_store import ManifestStore, StoreError

MAGIC = 0x4C454256  # LEBV
VERSION = 2
MAX_PACKET = 4096
HEADER = struct.Struct("!IHHIQI")
OP_PING = 1
OP_OPEN_MAIN = 2
OP_OPEN_SIDECAR = 3
OP_DELETE_SIDECAR = 4
OP_CREATE_SIDECAR = 5
OP_OPEN_ROLE_PARENT = 6
OP_OPEN_OR_CREATE_SIDECAR = 7
OP_ACCESS_ROLE_FILE = 8
STATUS_OK = 0
STATUS_BAD_REQUEST = 1
STATUS_UNAUTHORIZED = 2
STATUS_UNSUPPORTED = 3
STATUS_INTERNAL = 4
STATUS_NOT_FOUND = 5
ROLE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SIDECAR_KINDS = frozenset({"wal", "shm", "journal"})
_STOP = False


def _signal_stop(_signum: int, _frame: Any) -> None:
    global _STOP
    _STOP = True


def _close_ancillary_fds(ancillary: list[tuple[int, int, bytes]]) -> bool:
    found = False
    for level, kind, data in ancillary:
        found = True
        if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
            values = array.array("i")
            usable = len(data) - (len(data) % values.itemsize)
            values.frombytes(data[:usable])
            for fd in values:
                try:
                    os.close(fd)
                except OSError:
                    pass
    return found


def _send_response(
    conn: socket.socket, operation: int, status: int, request_id: int,
    descriptor: int | None = None,
) -> None:
    packet = HEADER.pack(MAGIC, VERSION, operation, status, request_id, 0)
    if descriptor is None:
        conn.send(packet)
        return
    rights = array.array("i", [descriptor])
    sent = conn.sendmsg([packet], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, rights)])
    if sent != len(packet):
        raise OSError("short broker response")


def _parse_role_payload(payload: bytes, operation: int) -> tuple[str, str]:
    try:
        decoded = payload.decode("ascii")
    except UnicodeDecodeError as exc:
        raise ValueError("role payload must be ASCII") from exc
    if operation in (OP_OPEN_MAIN, OP_OPEN_ROLE_PARENT):
        role, kind = decoded, "main"
    else:
        parts = decoded.split("\x00")
        if len(parts) != 2:
            raise ValueError("sidecar-open payload must contain role and kind")
        role, kind = parts
    if not ROLE_PATTERN.fullmatch(role) or (kind != "main" and kind not in SIDECAR_KINDS):
        raise ValueError("invalid role or sidecar kind")
    return role, kind


def handle_connection(conn: socket.socket, allowed_uid: int, store: Any) -> None:
    """Handle one bounded request; sequential service avoids shared-flock races."""
    try:
        conn.settimeout(1.0)
        credentials = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
        _pid, peer_uid, _gid = struct.unpack("3i", credentials)
        packet, ancillary, flags, _address = conn.recvmsg(
            MAX_PACKET, socket.CMSG_SPACE(16 * array.array("i").itemsize)
        )
        if _close_ancillary_fds(ancillary) or flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC):
            return
        if len(packet) < HEADER.size:
            return
        magic, version, operation, request_flags, request_id, payload_length = HEADER.unpack_from(packet)
        payload = packet[HEADER.size:]
        if (magic != MAGIC or version != VERSION or request_flags != 0
                or payload_length != len(payload) or len(packet) > MAX_PACKET):
            _send_response(conn, operation, STATUS_BAD_REQUEST, request_id)
            return
        if peer_uid != allowed_uid:
            _send_response(conn, operation, STATUS_UNAUTHORIZED, request_id)
            return
        if operation == OP_PING:
            if payload:
                _send_response(conn, operation, STATUS_BAD_REQUEST, request_id)
            else:
                _send_response(conn, operation, STATUS_OK, request_id)
            return
        if operation not in (OP_OPEN_MAIN, OP_OPEN_SIDECAR, OP_DELETE_SIDECAR, OP_CREATE_SIDECAR, OP_OPEN_ROLE_PARENT, OP_OPEN_OR_CREATE_SIDECAR, OP_ACCESS_ROLE_FILE):
            _send_response(conn, operation, STATUS_UNSUPPORTED, request_id)
            return
        try:
            role, kind = _parse_role_payload(payload, operation)
        except ValueError:
            _send_response(conn, operation, STATUS_BAD_REQUEST, request_id)
            return
        try:
            if operation == OP_DELETE_SIDECAR:
                store.delete_role_sidecar(role, kind)
                _send_response(conn, operation, STATUS_OK, request_id)
                return
            if operation == OP_ACCESS_ROLE_FILE:
                exists = store.role_file_exists(role, kind)
                _send_response(conn, operation, STATUS_OK if exists else STATUS_NOT_FOUND, request_id)
                return
            if operation == OP_CREATE_SIDECAR:
                descriptor = store.create_role_sidecar(role, kind)
            elif operation == OP_OPEN_OR_CREATE_SIDECAR:
                descriptor = store.open_or_create_role_sidecar(role, kind)
            elif operation == OP_OPEN_ROLE_PARENT:
                descriptor = store.open_role_parent_directory(role)
            else:
                descriptor = store.open_role_file(role, kind)
        except StoreError:
            # Do not reveal whether a role is absent or its identity check failed.
            _send_response(conn, operation, STATUS_INTERNAL, request_id)
            return
        try:
            _send_response(conn, operation, STATUS_OK, request_id, descriptor)
        finally:
            os.close(descriptor)
    except (OSError, struct.error, socket.timeout):
        return


def _open_socket_parent(path: str, application_uid: int, application_gid: int) -> tuple[int, str]:
    if not os.path.isabs(path):
        raise ValueError("socket path must be absolute")
    components = path.split("/")[1:]
    if not components or any(part in ("", ".", "..") for part in components):
        raise ValueError("socket path must not contain empty, dot, or parent components")
    basename = components[-1]
    if "/" in basename or "\x00" in basename:
        raise ValueError("socket path must end in a basename")
    directory_components = components[:-1]
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW
    fd = os.open("/", flags)
    try:
        for index, component in enumerate(directory_components):
            next_fd = os.open(component, flags, dir_fd=fd)
            info = os.fstat(next_fd)
            os.close(fd)
            fd = next_fd
            if (not stat.S_ISDIR(info.st_mode)
                    or info.st_uid not in (0, os.geteuid())
                    or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
                    or (info.st_uid == application_uid and info.st_mode & stat.S_IWUSR)):
                raise StoreError("socket path has an untrusted or application-writable ancestor")
            if index == len(directory_components) - 1:
                expected_mode = 0o700 if application_uid == os.geteuid() else 0o710
                if (info.st_uid != os.geteuid()
                        or (application_uid != os.geteuid() and info.st_gid != application_gid)
                        or stat.S_IMODE(info.st_mode) != expected_mode):
                    raise StoreError("socket parent must be broker-owned and traversable only by the application group")
        if not directory_components:
            raise StoreError("socket parent directory is not configured")
        return fd, basename
    except Exception:
        os.close(fd)
        raise


def serve(
    socket_path: str, allowed_uid: int, allowed_gid: int, store: ManifestStore,
) -> None:
    global _STOP
    parent_fd, _basename = _open_socket_parent(socket_path, allowed_uid, allowed_gid)
    server: socket.socket | None = None
    bound_identity: tuple[int, int] | None = None
    try:
        server = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET | socket.SOCK_CLOEXEC)
        try:
            os.lstat(socket_path)
        except FileNotFoundError:
            pass
        else:
            raise RuntimeError("broker socket already exists; refusing to replace it")
        server.bind(socket_path)
        socket_info = os.lstat(socket_path)
        if not stat.S_ISSOCK(socket_info.st_mode):
            raise RuntimeError("bound broker path is not a socket")
        bound_identity = (socket_info.st_dev, socket_info.st_ino)
        if allowed_uid == os.geteuid():
            os.chmod(socket_path, 0o600)
        else:
            os.chown(socket_path, -1, allowed_gid, follow_symlinks=False)
            os.chmod(socket_path, 0o620)
        server.listen(16)
        server.settimeout(0.5)
        signal.signal(signal.SIGINT, _signal_stop)
        signal.signal(signal.SIGTERM, _signal_stop)
        while not _STOP:
            try:
                conn, _ = server.accept()
            except socket.timeout:
                continue
            try:
                handle_connection(conn, allowed_uid, store)
            finally:
                conn.close()
    finally:
        if server is not None:
            server.close()
        try:
            info = os.lstat(socket_path)
            if bound_identity == (info.st_dev, info.st_ino) and stat.S_ISSOCK(info.st_mode):
                os.unlink(socket_path)
        except FileNotFoundError:
            pass
        os.close(parent_fd)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", required=True)
    parser.add_argument("--manifest-root", required=True)
    parser.add_argument("--anchor-root", required=True)
    parser.add_argument("--app-uid", required=True, type=int)
    parser.add_argument("--app-gid", type=int, default=None,
                        help="application primary group; defaults from the UID database")
    args = parser.parse_args()
    try:
        application_gid = args.app_gid if args.app_gid is not None else pwd.getpwuid(args.app_uid).pw_gid
    except KeyError:
        print("sqlite-broker: application UID has no passwd entry; specify --app-gid", file=sys.stderr)
        return 2
    store: ManifestStore | None = None
    try:
        store = ManifestStore(args.manifest_root, args.anchor_root, args.app_uid)
        if store.application_uid != args.app_uid:
            raise StoreError("broker application UID does not match manifest store")
        # Startup is fail-closed: no service until every enrolled role and active
        # sidecar is identity-verified against the protected manifest.
        store.verify_roles()
        serve(args.socket, args.app_uid, application_gid, store)
        return 0
    except (OSError, ValueError, RuntimeError, StoreError) as exc:
        print(f"sqlite-broker: {exc}", file=sys.stderr)
        return 2
    finally:
        if store is not None:
            store.close()


if __name__ == "__main__":
    raise SystemExit(main())
