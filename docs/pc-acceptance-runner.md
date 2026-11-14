# Windows PC acceptance runner

## Start

Download `scripts/START_TESTS.bat` from this branch and double-click it. The launcher downloads the pinned PowerShell runner from an immutable commit, verifies its Git blob hash, then starts it against the existing checkout at `C:\LogicEngine\Logic-Engine`.

No npm install, patch application, service restart, database migration, or administrator elevation is performed by this preflight.

## Automatic checks

- Logic Engine Node.js/npm availability and Node.js >=22.13.0.
- Full Logic Engine `npm test` suite.
- Host adapter prototype `*.test.mjs` suite when present.
- SillyTavern discovery in common local folders; if no extracted install is found, a matching local `SillyTavern*.zip` is unpacked into the report's isolated evidence folder.
- Host lifecycle patch SHA-256, target-file fingerprints, and read-only `git apply --check`. If the patch is already applied, a reverse-check is used to identify that state.
- ST-VectorService discovery; if no extracted folder is found, a local `ST-VectorService*.zip` is unpacked into an isolated evidence folder. Its declared npm test script is run when present.
- VectorService package/entrypoint fingerprints and SQLite database/sidecar file metadata. Database contents are not read or hashed.

## Output

Each run writes:

- `artifacts/pc-acceptance/<UTC timestamp>/acceptance-report.json`
- `artifacts/pc-acceptance/<UTC timestamp>/console.log`

A non-zero exit code means at least one check failed or the runner could not complete. Warnings mean a component was not found or did not declare an executable test suite; they are not silently reported as passes.

## Safety boundary

This is a read-only acceptance preflight. It does not apply or roll back the SillyTavern patch, modify the live SillyTavern or VectorService installation, change service state, or write to SQLite databases. ZIP archives are extracted only beneath the run's isolated evidence directory. A successful preflight is not equivalent to full runtime acceptance of Host → Core → MemoryNpcConsumer → SQLite Provider → Result Envelope; that requires the live isolated integration harness and its end-to-end tests.
