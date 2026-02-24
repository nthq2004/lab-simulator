@echo off
chcp 65001 >nul
title 网页仿真系统 - 本地服务器
echo ==============================
echo  启动网页仿真本地服务器
echo ==============================

REM === 进入 bat 所在目录（最稳方案）===
pushd "%~dp0" || (
    echo 无法进入程序目录
    pause
    exit /b
)

echo 当前目录：
echo %CD%
echo.

REM 启动 CivetWeb（后台）
echo 正在启动服务器...
start "" civetweb.exe -document_root . -listening_ports 9000

REM 等待 1 秒，确保服务已启动
timeout /t 1 /nobreak >nul

REM 自动打开浏览器
start http://127.0.0.1:9000/index.html

echo.
echo 服务器已启动：
echo http://127.0.0.1:9000
echo.
echo 关闭本窗口不会停止服务器
echo 如需停止，请关闭 civetweb.exe 进程
echo.


