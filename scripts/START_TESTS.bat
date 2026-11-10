@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%Run-PC-Acceptance.ps1"
if not exist "%PS_SCRIPT%" (
  echo [ERROR] Missing "%PS_SCRIPT%"
  echo Place this file in the Logic-Engine\scripts folder.
  pause
  exit /b 2
)
where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
)
set "RESULT=%errorlevel%"
echo.
if not "%RESULT%"=="0" (
  echo Acceptance checks finished with errors. Open the report path printed above.
) else (
  echo Acceptance checks passed. Open the report path printed above.
)
pause
exit /b %RESULT%
