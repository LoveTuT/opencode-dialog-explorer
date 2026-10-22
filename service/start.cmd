@echo off
chcp 65001 >nul
pushd "%~dp0.."
if errorlevel 1 (
  echo 无法进入项目目录。
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。请先安装 Node.js 22 或更新版本：https://nodejs.org/
  popd
  echo.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo 未检测到 npm。请重新安装 Node.js 22 或更新版本（npm 随 Node.js 一起安装）。
  popd
  echo.
  pause
  exit /b 1
)
echo 正在检查并安装依赖（首次或依赖变化时较慢，请稍候）…
call npm install --include=dev
if errorlevel 1 (
  echo.
  echo 依赖安装失败。请检查网络、Node.js 与 npm 是否可用后重试。
  popd
  echo.
  pause
  exit /b 1
)
node "%CD%\service\service.mjs" restart
if errorlevel 1 (
  echo.
  echo 启动失败。上方已列出占用端口 4570 的进程或构建错误。
  echo 详细日志：%CD%\data\service.log
  popd
  echo.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:4570/"
popd
echo.
pause
