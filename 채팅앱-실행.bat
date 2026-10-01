@echo off
setlocal
set "ROOT_DIR=%~dp0"
set "APP_DIR=%~dp0app"

if not exist "%APP_DIR%\server.js" (
  echo [ERROR] Cannot find "%APP_DIR%\server.js".
  echo Keep this .bat file in the same folder as the "app" folder.
  pause
  exit /b 1
)

if not exist "%ROOT_DIR%node_modules" (
  echo First run: installing document tools - Word/PPT/Excel. Please wait...
  cd /d "%ROOT_DIR%"
  call npm install
  if errorlevel 1 goto :npm_failed
)

if not exist "%APP_DIR%\node_modules" (
  echo First run: installing chat app packages. Please wait...
  cd /d "%APP_DIR%"
  call npm install
  if errorlevel 1 goto :npm_failed
)

echo.
echo Starting AI assistant chat app...
echo The browser will open shortly. If not, open http://127.0.0.1:4000
echo Closing this window stops the chat app.
echo.

cd /d "%APP_DIR%"
start "" http://127.0.0.1:4000
node "%APP_DIR%\server.js"
pause
exit /b 0

:npm_failed
echo.
echo [ERROR] npm install failed. Check that Node.js is installed.
pause
exit /b 1
