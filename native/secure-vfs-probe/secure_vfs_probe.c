/*
 * Logic-Engine SQLite VFS registration probe.
 *
 * This is deliberately NOT a secure VFS. It delegates all file operations to
 * SQLite's default VFS and only counts successful main-database xOpen calls.
 * Its sole purpose is to prove that Node 22.13.0's built-in node:sqlite can
 * load a persistent extension, register a process-default VFS, and route later
 * DatabaseSync opens through that VFS. Never use this probe for production DBs.
 */
#include <string.h>
#include "sqlite3ext.h"
SQLITE_EXTENSION_INIT1

static sqlite3_vfs g_probe_vfs;
static sqlite3_vfs *g_parent_vfs = 0;
static int g_main_db_open_count = 0;
static int g_registered = 0;

static int probe_xOpen(sqlite3_vfs *vfs, const char *name, sqlite3_file *file,
                       int flags, int *out_flags) {
  sqlite3_vfs *parent = (sqlite3_vfs *)vfs->pAppData;
  int rc = parent->xOpen(parent, name, file, flags, out_flags);
  if (rc == SQLITE_OK && (flags & SQLITE_OPEN_MAIN_DB) != 0) {
    g_main_db_open_count += 1;
  }
  return rc;
}

static int probe_xDelete(sqlite3_vfs *vfs, const char *name, int sync_dir) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xDelete(p, name, sync_dir);
}
static int probe_xAccess(sqlite3_vfs *vfs, const char *name, int flags, int *result) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xAccess(p, name, flags, result);
}
static int probe_xFullPathname(sqlite3_vfs *vfs, const char *name, int n, char *out) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xFullPathname(p, name, n, out);
}
static void *probe_xDlOpen(sqlite3_vfs *vfs, const char *name) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xDlOpen ? p->xDlOpen(p, name) : 0;
}
static void probe_xDlError(sqlite3_vfs *vfs, int n, char *out) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  if (p->xDlError) p->xDlError(p, n, out);
  else if (n > 0) out[0] = '\0';
}
static void (*probe_xDlSym(sqlite3_vfs *vfs, void *handle, const char *symbol))(void) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xDlSym ? p->xDlSym(p, handle, symbol) : 0;
}
static void probe_xDlClose(sqlite3_vfs *vfs, void *handle) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  if (p->xDlClose) p->xDlClose(p, handle);
}
static int probe_xRandomness(sqlite3_vfs *vfs, int n, char *out) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xRandomness(p, n, out);
}
static int probe_xSleep(sqlite3_vfs *vfs, int microseconds) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xSleep(p, microseconds);
}
static int probe_xCurrentTime(sqlite3_vfs *vfs, double *time_value) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xCurrentTime(p, time_value);
}
static int probe_xGetLastError(sqlite3_vfs *vfs, int n, char *out) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xGetLastError ? p->xGetLastError(p, n, out) : 0;
}
static int probe_xCurrentTimeInt64(sqlite3_vfs *vfs, sqlite3_int64 *time_value) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xCurrentTimeInt64
    ? p->xCurrentTimeInt64(p, time_value)
    : SQLITE_NOTFOUND;
}
static int probe_xSetSystemCall(sqlite3_vfs *vfs, const char *name, sqlite3_syscall_ptr call) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xSetSystemCall ? p->xSetSystemCall(p, name, call) : SQLITE_NOTFOUND;
}
static sqlite3_syscall_ptr probe_xGetSystemCall(sqlite3_vfs *vfs, const char *name) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xGetSystemCall ? p->xGetSystemCall(p, name) : 0;
}
static const char *probe_xNextSystemCall(sqlite3_vfs *vfs, const char *name) {
  sqlite3_vfs *p = (sqlite3_vfs *)vfs->pAppData;
  return p->xNextSystemCall ? p->xNextSystemCall(p, name) : 0;
}

static void probe_open_count(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_int(context, g_main_db_open_count);
}

static int probe_auto_extension(sqlite3 *db, char **error, const sqlite3_api_routines *api) {
  (void)error;
  SQLITE_EXTENSION_INIT2(api);
  return sqlite3_create_function(
    db,
    "logic_engine_vfs_probe_open_count",
    0,
    SQLITE_UTF8 | SQLITE_DETERMINISTIC,
    0,
    probe_open_count,
    0,
    0
  );
}

#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_secure_vfs_probe_init(
  sqlite3 *db,
  char **error,
  const sqlite3_api_routines *api
) {
  int rc;
  (void)db;
  (void)error;
  SQLITE_EXTENSION_INIT2(api);

  if (g_registered) return SQLITE_OK_LOAD_PERMANENTLY;
  g_parent_vfs = sqlite3_vfs_find(0);
  if (!g_parent_vfs) return SQLITE_ERROR;

  memset(&g_probe_vfs, 0, sizeof(g_probe_vfs));
  g_probe_vfs.iVersion = g_parent_vfs->iVersion;
  g_probe_vfs.szOsFile = g_parent_vfs->szOsFile;
  g_probe_vfs.mxPathname = g_parent_vfs->mxPathname;
  g_probe_vfs.zName = "logic-engine-vfs-registration-probe";
  g_probe_vfs.pAppData = g_parent_vfs;
  g_probe_vfs.xOpen = probe_xOpen;
  g_probe_vfs.xDelete = probe_xDelete;
  g_probe_vfs.xAccess = probe_xAccess;
  g_probe_vfs.xFullPathname = probe_xFullPathname;
  g_probe_vfs.xDlOpen = probe_xDlOpen;
  g_probe_vfs.xDlError = probe_xDlError;
  g_probe_vfs.xDlSym = probe_xDlSym;
  g_probe_vfs.xDlClose = probe_xDlClose;
  g_probe_vfs.xRandomness = probe_xRandomness;
  g_probe_vfs.xSleep = probe_xSleep;
  g_probe_vfs.xCurrentTime = probe_xCurrentTime;
  g_probe_vfs.xGetLastError = probe_xGetLastError;
  if (g_parent_vfs->iVersion >= 2) {
    g_probe_vfs.xCurrentTimeInt64 = probe_xCurrentTimeInt64;
  }
  if (g_parent_vfs->iVersion >= 3) {
    g_probe_vfs.xSetSystemCall = probe_xSetSystemCall;
    g_probe_vfs.xGetSystemCall = probe_xGetSystemCall;
    g_probe_vfs.xNextSystemCall = probe_xNextSystemCall;
  }

  rc = sqlite3_vfs_register(&g_probe_vfs, 1);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_auto_extension((void (*)(void))probe_auto_extension);
  if (rc != SQLITE_OK) {
    sqlite3_vfs_unregister(&g_probe_vfs);
    return rc;
  }

  g_registered = 1;
  return SQLITE_OK_LOAD_PERMANENTLY;
}
