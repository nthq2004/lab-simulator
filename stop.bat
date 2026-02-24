@echo off
chcp 65001 >nul
title 停止网页仿真本地服务器
echo ==============================
echo  停止网页仿真本地服务器
echo ==============================

REM 要停止的端口（必须和 start.bat 一致）
set PORT=9000

echo 正在查找占用端口 %PORT% 的进程...

REM 找到监听该端口的 PID
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
    set PID=%%a
)

REM 如果没找到
if "%PID%"=="" (
    echo 未找到正在运行的服务器（端口 %PORT%）
    pause
    exit
)

echo 找到服务器进程 PID=%PID%
echo 正在安全关闭...

taskkill /pid %PID% >nul 2>&1

if errorlevel 1 (
    echo 关闭失败，请尝试以“管理员身份运行”
) else (
    echo 服务器已成功停止
)

echo.

