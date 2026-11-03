#ifndef LOGIC_ENGINE_WINDOWS_NAMESPACE_ADAPTER_H
#define LOGIC_ENGINE_WINDOWS_NAMESPACE_ADAPTER_H
#ifdef _WIN32
#include <windows.h>
#include "../secure-vfs-probe/windows_relative_open.h"

int le_win_namespace_create_sidecar(
    HANDLE parent, const wchar_t *basename, HANDLE *opened,
    LogicEngineWinFileIdentity *identity);
int le_win_namespace_open_sidecar(
    HANDLE parent, const wchar_t *basename,
    const LogicEngineWinFileIdentity *expected,
    HANDLE *opened, LogicEngineWinFileIdentity *identity);
int le_win_namespace_flush(HANDLE opened);
int le_win_namespace_delete_sidecar(
    HANDLE parent, HANDLE opened,
    const LogicEngineWinFileIdentity *expected);
#endif
#endif
