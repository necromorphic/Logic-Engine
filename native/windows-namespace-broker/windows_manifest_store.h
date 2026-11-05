#ifndef LOGIC_ENGINE_WINDOWS_MANIFEST_STORE_H
#define LOGIC_ENGINE_WINDOWS_MANIFEST_STORE_H

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include "../secure-vfs-probe/windows_relative_open.h"

#define LE_STORE_MAX_BYTES (1024u * 1024u)

typedef int (*LE_STORE_VALIDATE)(const unsigned char *bytes, DWORD length, void *context);\n/* Called with the store lock held, after strict manifest/intent validation.\n * Return 1 only after physical namespace reconciliation and any required\n * manifest transition have completed durably. A present intent is removed\n * by the store only after this callback succeeds. */\ntypedef int (*LE_STORE_RECOVER)(\n    LE_WIN_MANIFEST_STORE *store,\n    const unsigned char *manifest, DWORD manifest_length,\n    const unsigned char *intent, DWORD intent_length,\n    void *context);

typedef struct LE_WIN_MANIFEST_STORE {
  HANDLE directory;
  HANDLE lock;
  LogicEngineWinFileIdentity directory_identity;
  LE_STORE_VALIDATE validate_manifest;
  LE_STORE_VALIDATE validate_intent;
  void *validator_context;
  BOOL locked;
} LE_WIN_MANIFEST_STORE;

int le_win_store_open(
    LE_WIN_MANIFEST_STORE *store,
    const wchar_t *configured_directory,
    LE_STORE_VALIDATE validate_manifest,
    LE_STORE_VALIDATE validate_intent,
    void *validator_context);
int le_win_store_lock(LE_WIN_MANIFEST_STORE *store);
void le_win_store_unlock(LE_WIN_MANIFEST_STORE *store);
int le_win_store_read_manifest(
    LE_WIN_MANIFEST_STORE *store, unsigned char **bytes, DWORD *length);
int le_win_store_read_intent(
    LE_WIN_MANIFEST_STORE *store, unsigned char **bytes, DWORD *length);
int le_win_store_write_manifest(
    LE_WIN_MANIFEST_STORE *store, const unsigned char *bytes, DWORD length);
int le_win_store_write_intent(
    LE_WIN_MANIFEST_STORE *store, const unsigned char *bytes, DWORD length);
int le_win_store_remove_intent(LE_WIN_MANIFEST_STORE *store);\nint le_win_store_startup_recover(\n    LE_WIN_MANIFEST_STORE *store,\n    LE_STORE_RECOVER recover,\n    void *recovery_context);
void le_win_store_close(LE_WIN_MANIFEST_STORE *store);
#endif /* _WIN32 */

#endif /* LOGIC_ENGINE_WINDOWS_MANIFEST_STORE_H */
