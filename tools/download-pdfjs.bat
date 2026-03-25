@echo off
chcp 65001 >nul 2>&1
setlocal

:: ============================================================
::  下载 pdf.js 到 lib/ 目录（JobPilot PDF 解析功能依赖）
::  需要网络连接，文件来自 cdnjs.cloudflare.com
:: ============================================================

:: 目标目录：上级目录的 lib 文件夹
set "LIB_DIR=%~dp0..\lib"

:: pdf.js 版本号
set "PDFJS_VER=4.9.155"
set "CDN_BASE=https://cdnjs.cloudflare.com/ajax/libs/pdf.js/%PDFJS_VER%"

echo.
echo 正在下载 pdf.js v%PDFJS_VER%...
echo 目标目录：%LIB_DIR%
echo.

:: 检查 PowerShell 是否可用
where powershell >nul 2>&1
if errorlevel 1 (
    echo 错误：未找到 PowerShell，无法自动下载。
    echo 请手动下载以下两个文件并放入 lib\ 目录：
    echo   %CDN_BASE%/pdf.min.mjs
    echo   %CDN_BASE%/pdf.worker.min.mjs
    pause
    exit /b 1
)

:: 下载主文件
echo [1/2] 下载 pdf.min.mjs ...
powershell -NoProfile -Command ^
  "Invoke-WebRequest '%CDN_BASE%/pdf.min.mjs' -OutFile '%LIB_DIR%\pdf.min.mjs' -UseBasicParsing" 2>nul
if errorlevel 1 (
    echo      失败，尝试备用下载方式...
    powershell -NoProfile -Command ^
      "(New-Object Net.WebClient).DownloadFile('%CDN_BASE%/pdf.min.mjs', '%LIB_DIR%\pdf.min.mjs')"
)

if not exist "%LIB_DIR%\pdf.min.mjs" (
    echo      ERROR: pdf.min.mjs 下载失败
    goto :fail
)
echo      完成

:: 下载 worker 文件
echo [2/2] 下载 pdf.worker.min.mjs ...
powershell -NoProfile -Command ^
  "Invoke-WebRequest '%CDN_BASE%/pdf.worker.min.mjs' -OutFile '%LIB_DIR%\pdf.worker.min.mjs' -UseBasicParsing" 2>nul
if errorlevel 1 (
    powershell -NoProfile -Command ^
      "(New-Object Net.WebClient).DownloadFile('%CDN_BASE%/pdf.worker.min.mjs', '%LIB_DIR%\pdf.worker.min.mjs')"
)

if not exist "%LIB_DIR%\pdf.worker.min.mjs" (
    echo      ERROR: pdf.worker.min.mjs 下载失败
    goto :fail
)
echo      完成

:: 验证文件大小
for %%F in ("%LIB_DIR%\pdf.min.mjs") do (
    if %%~zF LSS 100000 (
        echo 警告：pdf.min.mjs 文件过小（%%~zF 字节），可能下载不完整
    )
)

echo.
echo 下载完成！
echo   pdf.min.mjs        → %LIB_DIR%\pdf.min.mjs
echo   pdf.worker.min.mjs → %LIB_DIR%\pdf.worker.min.mjs
echo.
echo 请在 chrome://extensions 页面刷新 JobPilot 扩展，
echo 然后在「资料」标签中使用「从 PDF 导入」功能。
echo.
pause
exit /b 0

:fail
echo.
echo 下载失败，请检查网络连接后重试。
echo 或手动下载以下文件放入 lib\ 目录：
echo   %CDN_BASE%/pdf.min.mjs
echo   %CDN_BASE%/pdf.worker.min.mjs
echo.
pause
exit /b 1

endlocal
