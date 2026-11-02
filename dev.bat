@echo off
rem Phim Ngan Hong Qua - Development Mode
chcp 65001 >nul
title Phim Ngan Hong Qua - Dev Mode
cd /d "%~dp0"

echo ============================================
echo  Phim Ngan Hong Qua - Che do phat trien
echo  Dang khoi dong React dev server + Electron...
echo ============================================
echo.

if not exist node_modules (
    echo Phat hien thieu thu vien, dang tu dong cai dat...
    call npm install
)

call npm run dev
