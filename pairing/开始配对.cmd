@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 goto use_python
set "TASK_PY=py -3"
goto install
:use_python
set "TASK_PY=python"
:install
call %TASK_PY% scripts\setup.py setup
if errorlevel 1 goto end
echo 首次配对前：手机设置 → 蓝牙 → 忽略眼镜原有连接，再用 Muse Add Device 配对。
echo 配对后：关闭手机 VPN，用 Rokid App 回连眼镜。非美国地区回连成功后再开启并保持手机 VPN。
echo 已有配对无需重新配对。准备好后按任意键打开 AIUI。
pause >nul
call %TASK_PY% scripts\setup.py open
:end
pause
