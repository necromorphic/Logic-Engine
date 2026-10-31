#!/usr/bin/env python3
import array
import os
import socket
import struct
import stat
import tempfile
import threading
import unittest
from pathlib import Path

from broker_daemon import (
    HEADER, MAGIC, VERSION, OP_PING, OP_OPEN_MAIN, OP_OPEN_SIDECAR, OP_DELETE_SIDECAR, OP_CREATE_SIDECAR, OP_OPEN_ROLE_PARENT, OP_OPEN_OR_CREATE_SIDECAR, OP_ACCESS_ROLE_FILE,
    STATUS_OK, STATUS_BAD_REQUEST, STATUS_UNAUTHORIZED,
    STATUS_UNSUPPORTED, STATUS_NOT_FOUND, handle_connection,
)

RESPONSE = HEADER


class FakeManifestStore:
    def __init__(self, path):
        self.path = path
        self.calls = []

    def open_role_file(self, role, kind):
        self.calls.append((role, kind))
        return os.open(self.path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)

    def delete_role_sidecar(self, role, kind):
        self.calls.append(("delete", role, kind))

    def create_role_sidecar(self, role, kind):
        self.calls.append(("create", role, kind))
        return os.open(self.path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)

    def open_role_parent_directory(self, role):
        self.calls.append(("parent", role))
        return os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)

    def open_or_create_role_sidecar(self, role, kind):
        self.calls.append(("open-or-create", role, kind))
        return os.open(self.path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)

    def role_file_exists(self, role, kind):
        self.calls.append(("access", role, kind))
        return kind == "main"


class BrokerDaemonTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "database.sqlite"
        self.path.write_bytes(b"manifest-verified-db")
        self.store = FakeManifestStore(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def exchange(self, operation, payload=b"", *, allowed_uid=None, flags=0,
                 ancillary_fd=None):
        server, client = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        client.settimeout(2)
        request_id = 0x1020304050607080
        packet = HEADER.pack(
            MAGIC, VERSION, operation, flags, request_id, len(payload)
        ) + payload
        def run_handler():
            try:
                handle_connection(
                    server,
                    os.getuid() if allowed_uid is None else allowed_uid,
                    self.store,
                )
            finally:
                server.close()

        thread = threading.Thread(target=run_handler)
        thread.start()
        try:
            if ancillary_fd is None:
                client.sendall(packet)
            else:
                client.sendmsg(
                    [packet],
                    [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                      array.array("i", [ancillary_fd]))],
                )
            data, ancillary, message_flags, _ = client.recvmsg(
                RESPONSE.size, socket.CMSG_SPACE(4 * array.array("i").itemsize)
            )
            thread.join(timeout=2)
            self.assertFalse(thread.is_alive(), "broker handler did not finish")
            if not data:
                return None, []
            self.assertEqual(len(data), RESPONSE.size)
            response = RESPONSE.unpack(data)
            received_fds = []
            for level, kind, raw in ancillary:
                if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                    values = array.array("i")
                    values.frombytes(raw[:len(raw) - len(raw) % values.itemsize])
                    received_fds.extend(values)
            self.assertEqual(message_flags & socket.MSG_CTRUNC, 0)
            return response, received_fds
        finally:
            client.close()
            server.close()
            if thread.is_alive():
                thread.join(timeout=2)

    def test_ping(self):
        response, fds = self.exchange(OP_PING)
        self.assertEqual(response, (MAGIC, VERSION, OP_PING, STATUS_OK,
                                    0x1020304050607080, 0))
        self.assertEqual(fds, [])

    def test_open_main_returns_the_verified_descriptor(self):
        response, fds = self.exchange(OP_OPEN_MAIN, b"core")
        try:
            self.assertEqual(response[3], STATUS_OK)
            self.assertEqual(len(fds), 1)
            self.assertEqual(os.read(fds[0], 64), b"manifest-verified-db")
            self.assertEqual(self.store.calls[-1], ("core", "main"))
        finally:
            for fd in fds:
                os.close(fd)

    def test_open_sidecar_uses_role_and_kind_not_a_path(self):
        response, fds = self.exchange(OP_OPEN_SIDECAR, b"core\x00wal")
        try:
            self.assertEqual(response[3], STATUS_OK)
            self.assertEqual(len(fds), 1)
            self.assertEqual(self.store.calls[-1], ("core", "wal"))
        finally:
            for fd in fds:
                os.close(fd)

    def test_delete_sidecar_uses_quarantine_store_operation(self):
        response, fds = self.exchange(OP_DELETE_SIDECAR, b"core\x00wal")
        self.assertEqual(response[3], STATUS_OK)
        self.assertEqual(fds, [])
        self.assertEqual(self.store.calls[-1], ("delete", "core", "wal"))

    def test_create_sidecar_returns_broker_created_descriptor(self):
        response, fds = self.exchange(OP_CREATE_SIDECAR, b"core\x00wal")
        try:
            self.assertEqual(response[3], STATUS_OK)
            self.assertEqual(len(fds), 1)
            self.assertEqual(os.read(fds[0], 64), b"manifest-verified-db")
            self.assertEqual(self.store.calls[-1], ("create", "core", "wal"))
        finally:
            for fd in fds:
                os.close(fd)

    def test_access_role_file_reports_identity_checked_presence(self):
        response, fds = self.exchange(OP_ACCESS_ROLE_FILE, b"core\x00main")
        self.assertEqual(response[3], STATUS_OK)
        self.assertEqual(fds, [])
        self.assertEqual(self.store.calls[-1], ("access", "core", "main"))

    def test_access_role_file_reports_absent_sidecar_without_descriptor(self):
        response, fds = self.exchange(OP_ACCESS_ROLE_FILE, b"core\x00wal")
        self.assertEqual(response[3], STATUS_NOT_FOUND)
        self.assertEqual(fds, [])

    def test_open_or_create_sidecar_returns_manifest_backed_descriptor(self):
        response, fds = self.exchange(OP_OPEN_OR_CREATE_SIDECAR, b"core\x00wal")
        try:
            self.assertEqual(response[3], STATUS_OK)
            self.assertEqual(len(fds), 1)
            self.assertEqual(os.read(fds[0], 64), b"manifest-verified-db")
            self.assertEqual(self.store.calls[-1], ("open-or-create", "core", "wal"))
        finally:
            for fd in fds:
                os.close(fd)

    def test_open_role_parent_returns_verified_directory_descriptor(self):
        response, fds = self.exchange(OP_OPEN_ROLE_PARENT, b"core")
        try:
            self.assertEqual(response[3], STATUS_OK)
            self.assertEqual(len(fds), 1)
            self.assertTrue(stat.S_ISDIR(os.fstat(fds[0]).st_mode))
            self.assertEqual(self.store.calls[-1], ("parent", "core"))
        finally:
            for fd in fds:
                os.close(fd)

    def test_invalid_role_payload_fails_closed(self):
        response, fds = self.exchange(OP_OPEN_MAIN, b"../escape")
        self.assertEqual(response[3], STATUS_BAD_REQUEST)
        self.assertEqual(fds, [])

    def test_peer_uid_mismatch_is_rejected(self):
        response, fds = self.exchange(OP_PING, allowed_uid=os.getuid() ^ 1)
        self.assertEqual(response[3], STATUS_UNAUTHORIZED)
        self.assertEqual(fds, [])

    def test_unknown_operation_is_rejected(self):
        response, fds = self.exchange(99)
        self.assertEqual(response[3], STATUS_UNSUPPORTED)
        self.assertEqual(fds, [])

    def test_nonzero_flags_are_rejected(self):
        response, fds = self.exchange(OP_PING, flags=1)
        self.assertEqual(response[3], STATUS_BAD_REQUEST)
        self.assertEqual(fds, [])

    def test_client_cannot_inject_file_descriptors(self):
        read_fd, write_fd = os.pipe()
        try:
            response, fds = self.exchange(OP_PING, ancillary_fd=read_fd)
            self.assertIsNone(response)
            self.assertEqual(fds, [])
        finally:
            os.close(read_fd)
            os.close(write_fd)


if __name__ == "__main__":
    unittest.main(verbosity=2)
