@echo off
rem Dong goi Phim Ngan Hong Qua. Menu va moi thong bao tieng Viet nam trong scripts\build-menu.js.
rem Tep .bat nay chi dung ASCII: cmd.exe doc sai tep .bat chua chu UTF-8 nhieu byte.
chcp 65001 >nul
title Phim Ngan Hong Qua - Dong goi
cd /d "%~dp0"
rem Bien nay (neu co) lam Electron chay nhu Node thuong va thoat ngay
set ELECTRON_RUN_AS_NODE=

node scripts\build-menu.js
if errorlevel 1 pause
