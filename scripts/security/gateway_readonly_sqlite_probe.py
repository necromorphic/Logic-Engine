import os
import sqlite3
import sys
import time
from pathlib import Path
from urllib.parse import quote

mode, db_arg, ready_arg = sys.argv[1:4]
db = Path(db_arg)
ready = Path(ready_arg)

if mode == "writer":
    con = sqlite3.connect(str(db), timeout=5)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
    con.execute("INSERT INTO probe(value) VALUES ('fixture')")
    con.commit()
    # Force WAL/shm initialization while the writer keeps the connection open.
    con.execute("SELECT * FROM probe").fetchall()
    wal = Path(str(db) + "-wal")
    shm = Path(str(db) + "-shm")
    if not wal.exists() or not shm.exists():
        raise SystemExit(f"fixture did not retain live WAL/SHM: wal={wal.exists()} shm={shm.exists()}")
    ready.write_text("ready", encoding="utf-8")
    time.sleep(90)
    con.close()
    raise SystemExit(0)

if mode == "reader":
    uri = "file:" + quote(str(db).replace("\\", "/"), safe="/:") + "?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=3)
    rows = con.execute("SELECT value FROM probe").fetchall()
    if not rows or rows[0][0] != "fixture":
        raise SystemExit("read-only SQLite query returned unexpected data")
    try:
        con.execute("INSERT INTO probe(value) VALUES ('must-not-write')")
        con.commit()
        raise SystemExit("SECURITY FAILURE: read-only SQLite connection wrote to the database")
    except sqlite3.OperationalError:
        pass
    con.close()

    directory = db.parent
    probe = directory / "gateway-must-not-create.txt"
    try:
        probe.write_text("bad", encoding="utf-8")
        raise SystemExit("SECURITY FAILURE: Gateway created a file in protected store directory")
    except PermissionError:
        pass
    sentinel = directory / "sentinel-do-not-rename.txt"
    if not sentinel.exists():
        raise SystemExit("test fixture sentinel missing")
    try:
        os.replace(sentinel, directory / "sentinel-renamed.txt")
        raise SystemExit("SECURITY FAILURE: Gateway renamed an entry in protected store directory")
    except PermissionError:
        pass
    try:
        sentinel.unlink()
        raise SystemExit("SECURITY FAILURE: Gateway deleted an entry in protected store directory")
    except PermissionError:
        pass
    print("PASS: SQLite mode=ro SELECT succeeded with live WAL/SHM; SQL write denied; directory create/rename/delete denied.")
    raise SystemExit(0)

raise SystemExit("mode must be writer or reader")
