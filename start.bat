@echo off
rem Phim Ngan Hong Qua - Launch app from source (always runs the latest code in src, never a packaged exe)
chcp 65001 >nul
title Phim Ngan Hong Qua
cd /d "%~dp0"

call "%~dp0dev.bat"
