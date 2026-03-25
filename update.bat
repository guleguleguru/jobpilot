@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

:: ============================================================
::  JobPilot 扩展更新脚本
::  修改代码后双击运行，让 Chrome 重新加载最新版本
:: ============================================================

:: ── 查找 Chrome 可执行文件 ──────────────────────────────────
set "CHROME="

for %%P in (
    "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do (
    if exist %%P (
        if not defined CHROME set "CHROME=%%~P"
    )
)

:: ── 尝试通过 Chrome 远程调试接口自动 reload（需要 Chrome 已开启远程调试） ──
:: Chrome 安全机制通常不允许外部程序直接 reload 扩展，
:: 所以主流程是打开 extensions 页面 + 弹出提示，由用户点一下刷新按钮。

:: 检查 Chrome 是否以远程调试模式运行（端口 9222）
set "AUTO_RELOAD=0"
powershell -NoProfile -WindowStyle Hidden -Command ^
"try { ^
    $r = Invoke-WebRequest 'http://127.0.0.1:9222/json' -TimeoutSec 2 -ErrorAction Stop; ^
    exit 0 ^
} catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 set "AUTO_RELOAD=1"

if "%AUTO_RELOAD%"=="1" (
    :: 远程调试可用：通过 DevTools Protocol 触发扩展重载
    :: 先找到 background service worker 的 ID，然后 reload
    powershell -NoProfile -WindowStyle Hidden -Command ^
    "try { ^
        $tabs = (Invoke-WebRequest 'http://127.0.0.1:9222/json' -TimeoutSec 3).Content | ConvertFrom-Json; ^
        $sw = $tabs | Where-Object { $_.type -eq 'service_worker' -and $_.url -like '*jobpilot*' } | Select-Object -First 1; ^
        if ($sw) { ^
            $ws = New-Object System.Net.WebSockets.ClientWebSocket; ^
            $ct = [System.Threading.CancellationToken]::None; ^
            $uri = [System.Uri]$sw.webSocketDebuggerUrl; ^
            $ws.ConnectAsync($uri, $ct).Wait(3000) | Out-Null; ^
            $msg = '{\"id\":1,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"chrome.runtime.reload()\"}}'; ^
            $buf = [System.Text.Encoding]::UTF8.GetBytes($msg); ^
            $seg = [System.ArraySegment[byte]]::new($buf); ^
            $ws.SendAsync($seg, 'Text', $true, $ct).Wait(3000) | Out-Null; ^
            Start-Sleep -Milliseconds 500; ^
            $ws.CloseAsync('NormalClosure','done',$ct).Wait(2000) | Out-Null; ^
        } ^
    } catch {}" >nul 2>&1

    timeout /t 2 /nobreak >nul

    powershell -NoProfile -WindowStyle Hidden -Command ^
    "Add-Type -AssemblyName System.Windows.Forms; ^
    [System.Windows.Forms.MessageBox]::Show( ^
        '已通过远程调试接口发送重载指令。' + [char]13+[char]10 + [char]13+[char]10 + ^
        '如果扩展未自动更新，请手动点击 chrome://extensions 中' + [char]13+[char]10 + ^
        'JobPilot 卡片右下角的刷新按钮。', ^
        'JobPilot 更新', 'OK', 'Information' ^
    )" 2>nul

    goto :done
)

:: ── 常规方式：打开 chrome://extensions + 弹出提示 ────────────
if not defined CHROME (
    start "" "chrome://extensions" >nul 2>&1
) else (
    start "" "%CHROME%" "chrome://extensions"
)

timeout /t 1 /nobreak >nul

powershell -NoProfile -WindowStyle Hidden -Command ^
"Add-Type -AssemblyName System.Windows.Forms; ^
[System.Windows.Forms.MessageBox]::Show( ^
    '请在已打开的 Chrome 扩展页面中：' + [char]13+[char]10 + [char]13+[char]10 + ^
    '找到 JobPilot 卡片，点击卡片右下角的' + [char]13+[char]10 + ^
    '刷新按钮（圆形箭头图标）即可完成更新。' + [char]13+[char]10 + [char]13+[char]10 + ^
    '如果看不到刷新按钮，请确认已开启「开发者模式」。' + [char]13+[char]10 + [char]13+[char]10 + ^
    '提示：若希望实现自动重载，可用以下命令启动 Chrome：' + [char]13+[char]10 + ^
    'chrome.exe --remote-debugging-port=9222', ^
    'JobPilot 更新', ^
    'OK', ^
    'Information' ^
)" 2>nul

:done
endlocal
