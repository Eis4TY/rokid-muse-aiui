@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 goto use_python
set "TASK_PY=py -3"
goto menu
:use_python
set "TASK_PY=python"
:menu
echo Muse 远程测试 0.2.5
 echo 1. 安装修复包（保留授权，修复本机绑定）
 echo 2. 自动对比五种订阅请求（不发送聊天消息）
 echo 3. 收集最终诊断包
 echo 4. 持续记录 120 秒（打开后手动发一次消息）
 echo 5. 打开默认主会话模式
 echo 6. 打开旧 official 对照 模式
set /p TASK_CHOICE=请选择 1 至 6：
if "%TASK_CHOICE%"=="1" goto install
if "%TASK_CHOICE%"=="2" goto matrix
if "%TASK_CHOICE%"=="3" goto collect
if "%TASK_CHOICE%"=="4" goto watch
if "%TASK_CHOICE%"=="5" goto mainchat
if "%TASK_CHOICE%"=="6" goto official
goto end
:install
call %TASK_PY% scripts\setup.py setup --rebind
goto end
:matrix
call %TASK_PY% scripts\remote_test.py matrix
goto end
:collect
call %TASK_PY% scripts\remote_test.py collect
goto end
:watch
call %TASK_PY% scripts\remote_test.py watch --seconds 120
goto end
:mainchat
call %TASK_PY% scripts\remote_test.py open --profile main
goto end
:official
call %TASK_PY% scripts\remote_test.py open --profile official
goto end
:end
pause
