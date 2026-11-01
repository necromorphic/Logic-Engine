#!/usr/bin/env python3
"""Create the first empty POSIX role manifest for a dedicated broker identity."""
from __future__ import annotations

import argparse
import os
import sys

from manifest_store import ManifestStore, StoreError, SUPPORTED_ROLE_FILESYSTEMS, _canonical_json


def build_empty_manifest(store: ManifestStore, application_uid: int, filesystem: str) -> bytes:
    if filesystem not in SUPPORTED_ROLE_FILESYSTEMS:
        raise StoreError(
            "unsupported filesystem; choose one of: "
            + ", ".join(sorted(SUPPORTED_ROLE_FILESYSTEMS))
        )
    if application_uid <= 0 or application_uid == os.geteuid():
        raise StoreError("application UID must be non-root and distinct from broker UID")
    return _canonical_json({
        "schemaVersion": 1,
        "generation": 1,
        "platform": "linux",
        "metadataRootIdentity": store.metadata_identity(),
        "filesystemPolicy": {
            "filesystem": filesystem,
            "identitySource": "opened-handle",
            "directoryMutationBoundary": "dedicated-service-identity",
            "applicationUid": application_uid,
        },
        "roles": [],
    })


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest-root", required=True)
    parser.add_argument("--anchor-root", required=True)
    parser.add_argument("--app-uid", required=True, type=int)
    parser.add_argument("--filesystem", required=True, choices=sorted(SUPPORTED_ROLE_FILESYSTEMS))
    args = parser.parse_args()
    store: ManifestStore | None = None
    try:
        store = ManifestStore(args.manifest_root, args.anchor_root, args.app_uid)
        store.initialize(build_empty_manifest(store, args.app_uid, args.filesystem))
        print("initialized empty broker manifest at generation 1")
        return 0
    except (OSError, ValueError, RuntimeError, StoreError) as exc:
        print(f"manifest-bootstrap: {exc}", file=sys.stderr)
        return 2
    finally:
        if store is not None:
            store.close()


if __name__ == "__main__":
    raise SystemExit(main())
