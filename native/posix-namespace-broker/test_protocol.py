#!/usr/bin/env python3
import os
import socket
import struct
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAGIC = 0x4C454256
VERSION = 1
REQUEST = struct.Struct("!IHHIQI")
RESPONSE = struct.Struct("!IHHIQI")
OK = 0
BAD_REQUEST = 1
UNAUTHORIZED = 2
UNSUPPORTED = 3


def exchange(path, operation, flags=0, version=VERSION, ancillary=None):
    client = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
    client.settimeout(2)
    client.connect(path)
    packet = REQUEST.pack(MAGIC, version, operation, flags, 0x1020304050607080, 0)
    if ancillary is None:
        client.sendall(packet)
    else:
        client.sendmsg([packet], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                  struct.pack("i", ancillary))])
    try:
        data = client.recv(256)
    except ConnectionResetError:
        data = b""
    client.close()
    if not data:
        return None
    if len(data) != RESPONSE.size:
        raise AssertionError(f"unexpected response length: {len(data)}")
    return RESPONSE.unpack(data)


def main():
    with tempfile.TemporaryDirectory(prefix="le-broker-") as temp:
        os.chmod(temp, 0o700)
        path = str(Path(temp) / "broker.sock")
        proc = subprocess.Popen(
            [str(ROOT / "broker_server"), "--socket", path,
             "--app-uid", str(os.getuid())],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
        )
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    raise AssertionError(f"broker exited early: {proc.stderr.read()}")
                if os.path.exists(path):
                    break
                time.sleep(0.02)
            else:
                raise AssertionError("broker socket did not appear")

            # An idle authorized client must not block the sequential broker.
            idle = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
            idle.connect(path)
            time.sleep(0.1)
            ping = exchange(path, 1)
            idle.close()
            assert ping == (MAGIC, VERSION, 1, OK, 0x1020304050607080, 0), ping

            unsupported = exchange(path, 99)
            assert unsupported == (MAGIC, VERSION, 99, UNSUPPORTED,
                                    0x1020304050607080, 0), unsupported

            bad_flags = exchange(path, 1, flags=1)
            assert bad_flags == (MAGIC, VERSION, 1, BAD_REQUEST,
                                 0x1020304050607080, 0), bad_flags

            bad_version = exchange(path, 1, version=VERSION + 1)
            assert bad_version == (MAGIC, VERSION, 1, BAD_REQUEST,
                                   0x1020304050607080, 0), bad_version

            read_fd, write_fd = os.pipe()
            try:
                ancillary_result = exchange(path, 1, ancillary=read_fd)
                assert ancillary_result is None, ancillary_result
            finally:
                os.close(read_fd)
                os.close(write_fd)

            assert proc.poll() is None, "broker exited after rejected request"

            denied_path = str(Path(temp) / "broker-denied.sock")
            denied_uid = os.getuid() ^ 1
            denied_proc = subprocess.Popen(
                [str(ROOT / "broker_server"), "--socket", denied_path,
                 "--app-uid", str(denied_uid)],
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
            )
            try:
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if denied_proc.poll() is not None:
                        raise AssertionError(
                            f"denial-test broker exited early: {denied_proc.stderr.read()}"
                        )
                    if os.path.exists(denied_path):
                        break
                    time.sleep(0.02)
                else:
                    raise AssertionError("denial-test broker socket did not appear")

                denied = exchange(denied_path, 1)
                assert denied == (
                    MAGIC, VERSION, 0, UNAUTHORIZED, 0, 0
                ), denied
            finally:
                denied_proc.terminate()
                try:
                    denied_proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    denied_proc.kill()
                    denied_proc.wait(timeout=3)
            assert not os.path.exists(denied_path), (
                "denial-test broker did not remove its socket on shutdown"
            )

            print(
                "POSIX broker protocol tests: PASS "
                "(PING, peer UID rejection, unknown op, bad flags/version, "
                "SCM_RIGHTS rejection)"
            )
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=3)
        assert not os.path.exists(path), "broker did not remove its own socket on shutdown"


if __name__ == "__main__":
    main()
