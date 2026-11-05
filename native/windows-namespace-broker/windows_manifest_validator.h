#ifndef LOGIC_ENGINE_WINDOWS_MANIFEST_VALIDATOR_H
#define LOGIC_ENGINE_WINDOWS_MANIFEST_VALIDATOR_H
#ifdef _WIN32
#include <windows.h>
int le_win_validate_manifest(const unsigned char *bytes,DWORD length,void *context);
int le_win_validate_intent(const unsigned char *bytes,DWORD length,void *context);
int le_win_reconcile_manifest_namespace(const unsigned char *bytes,DWORD length,const wchar_t *namespace_root);
#endif
#endif
