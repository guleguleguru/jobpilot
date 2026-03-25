@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

:: ============================================================
::  JobPilot 安装向导
::  双击运行，按照弹出的提示完成扩展安装
:: ============================================================

:: 获取本脚本所在目录（即 JobPilot 项目根目录），去掉末尾反斜杠
set "JP_DIR=%~dp0"
if "%JP_DIR:~-1%"=="\" set "JP_DIR=%JP_DIR:~0,-1%"

:: 把路径复制到剪贴板，方便用户直接粘贴到 Chrome 文件选择框
echo %JP_DIR%| clip

:: ── 查找 Chrome 可执行文件 ──────────────────────────────────
set "CHROME="

:: 常见安装路径，依次检测
for %%P in (
    "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do (
    if exist %%P (
        if not defined CHROME set "CHROME=%%~P"
    )
)

:: 找不到 Chrome 时尝试用系统默认浏览器打开
if not defined CHROME (
    start "" "chrome://extensions" >nul 2>&1
) else (
    start "" "%CHROME%" "chrome://extensions"
)

:: 短暂等待 Chrome 窗口弹出
timeout /t 1 /nobreak >nul

:: ── 弹出操作指引对话框 ──────────────────────────────────────
:: 使用 PowerShell 的 Windows Forms MessageBox，支持中文和 Emoji
powershell -NoProfile -WindowStyle Hidden -Command ^
"Add-Type -AssemblyName System.Windows.Forms; ^
[System.Windows.Forms.MessageBox]::Show( ^
    '扩展目录路径已自动复制到剪贴板！' + [char]13+[char]10 + [char]13+[char]10 + ^
    '请在刚才打开的 Chrome 页面中按以下步骤操作：' + [char]13+[char]10 + [char]13+[char]10 + ^
    '① 开启右上角的「开发者模式」开关' + [char]13+[char]10 + ^
    '② 点击「加载已解压的扩展程序」按钮' + [char]13+[char]10 + ^
    '③ 在弹出的文件夹选择框中，按 Ctrl+V 粘贴路径，然后点「选择文件夹」' + [char]13+[char]10 + ^
    '④ 完成！JobPilot 图标将出现在浏览器右上角工具栏' + [char]13+[char]10 + [char]13+[char]10 + ^
    '提示：以后更新代码后，双击 update.bat 一键刷新扩展。' + [char]13+[char]10 + [char]13+[char]10 + ^
    '路径（备用，可手动复制）：' + [char]13+[char]10 + '%JP_DIR%', ^
    'JobPilot 安装向导', ^
    'OK', ^
    'Information' ^
)" 2>nul

endlocal
