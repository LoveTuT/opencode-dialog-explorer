@echo off
chcp 65001 >nul
pushd "%~dp0.."
if errorlevel 1 (
  echo 无法进入项目目录。
  pause
  exit /b 1
)
node "%CD%\service\service.mjs" restart
if errorlevel 1 (
  echo.
  echo 启动失败，请检查上方信息。
  popd
  echo.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:4570/"
popd
echo.
pause
