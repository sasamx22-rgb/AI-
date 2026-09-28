@echo off
chcp 65001 >nul
cd /d "%~dp0app"

if not exist node_modules (
  echo 처음 실행이라 필요한 패키지를 설치합니다. 잠시만 기다려주세요...
  call npm install
  if errorlevel 1 (
    echo.
    echo 패키지 설치에 실패했습니다. Node.js가 설치되어 있는지 확인하세요.
    pause
    exit /b 1
  )
)

echo.
echo AI 비서 채팅창을 시작합니다...
echo 잠시 후 브라우저가 자동으로 열립니다. (안 열리면 http://localhost:4000 을 직접 여세요)
echo 이 창을 닫으면 채팅앱도 종료됩니다.
echo.

start "" http://localhost:4000
node server.js

pause
