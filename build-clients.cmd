@echo off
rem Build the OVL For Business apps on Windows: double-click this file, or run  build-clients --help
rem It starts build-clients.ps1, which installs Node.js for the builder when it is missing.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-clients.ps1" %*
set OVL_EXIT=%ERRORLEVEL%
rem Keep the window open when the file was double-clicked, so the results stay readable.
echo %CMDCMDLINE% | find /i "%~nx0" >nul && pause
exit /b %OVL_EXIT%
