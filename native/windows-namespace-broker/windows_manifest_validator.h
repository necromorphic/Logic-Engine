#ifndef LOGIC_ENGINE_WINDOWS_MANIFEST_VALIDATOR_H
#define LOGIC_ENGINE_WINDOWS_MANIFEST_VALIDATOR_H
#ifdef _WIN32
#include <windows.h>
#include "windows_manifest_store.h"
int le_win_validate_manifest(const unsigned char *bytes,DWORD length,void *context);
int le_win_validate_intent(const unsigned char *bytes,DWORD length,void *context);
int le_win_reconcile_manifest_namespace(const unsigned char *bytes,DWORD length,const wchar_t *namespace_root);
int le_win_recover_lifecycle_intent(LE_WIN_MANIFEST_STORE *store,const unsigned char *manifest,DWORD manifest_length,const unsigned char *intent,DWORD intent_length,const wchar_t *namespace_root);
int le_win_access_role_file(LE_WIN_MANIFEST_STORE *store,const wchar_t *namespace_root,const char *role_name,const char *kind_name,BOOL *exists);
int le_win_open_role_file(LE_WIN_MANIFEST_STORE *store,const wchar_t *namespace_root,const char *role_name,const char *kind_name,HANDLE *opened);
int le_win_create_role_sidecar(LE_WIN_MANIFEST_STORE *store,const wchar_t *namespace_root,const char *role_name,const char *kind_name,HANDLE *opened,LogicEngineWinFileIdentity *identity);
int le_win_delete_role_sidecar(LE_WIN_MANIFEST_STORE *store,const wchar_t *namespace_root,const char *role_name,const char *kind_name);
#endif
#endif
