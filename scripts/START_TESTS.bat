@echo off
setlocal EnableExtensions
set "PS_SCRIPT=%TEMP%\LogicEngine-Run-PC-Acceptance.ps1"
set "ROOT=C:\LogicEngine\Logic-Engine"
set "PINNED_COMMIT=8a2a082e81713aab59aa02ad634b9f71a3a9aa59"
set "EXPECTED_BLOB=6dd36acc5e16cce3bfafcc813ea653c9dc47abf7"

echo [INFO] Downloading the pinned acceptance runner...
where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/necromorphic/Logic-Engine/%PINNED_COMMIT%/scripts/Run-PC-Acceptance.ps1' -OutFile '%PS_SCRIPT%'"
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/necromorphic/Logic-Engine/%PINNED_COMMIT%/scripts/Run-PC-Acceptance.ps1' -OutFile '%PS_SCRIPT%'"
)
if errorlevel 1 (
  echo [ERROR] Could not download the pinned runner. No project files were changed.
  pause
  exit /b 2
)
where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git is required to verify the downloaded runner.
  pause
  exit /b 2
)
for /f %%H in ('git hash-object "%PS_SCRIPT%"') do set "ACTUAL_BLOB=%%H"
if /I not "%ACTUAL_BLOB%"=="%EXPECTED_BLOB%" (
  echo [ERROR] Runner integrity check failed. The downloaded file will not be executed.
  del "%PS_SCRIPT%" >nul 2>nul
  pause
  exit /b 3
)
echo [PASS] Runner integrity verified.

if not exist "%ROOT%\package.json" (
  echo [ERROR] Logic Engine checkout not found at "%ROOT%".
  echo No project files were changed.
  pause
  exit /b 4
)

where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -LogicEngineRoot "%ROOT%"
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -LogicEngineRoot "%ROOT%"
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
