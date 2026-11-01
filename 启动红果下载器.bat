@echo off
rem Phim Ngan Hong Qua 5.3 - Thong tin phien ban: package.json
chcp 65001 >nul
title Khoi dong Trinh tai Phim Ngan Hong Qua
cd /d "%~dp0"
if exist "dist\win-unpacked\Phim Ngắn Hồng Quả.exe" (
  start "" "dist\win-unpacked\Phim Ngắn Hồng Quả.exe"
  exit /b 0
)
if exist "dist\win-unpacked\红果短剧.exe" (
  start "" "dist\win-unpacked\红果短剧.exe"
  exit /b 0
)
for %%F in ("dist\*Portable*.exe" "dist\*-便携版.exe" "dist\*Setup*.exe" "dist\*-win-x64-setup.exe") do (
  start "" "%%~fF"
  exit /b 0
)
echo Khong tim thay chuong trinh da dong goi. Vui long chay npm run build hoac nhap dup chuot vao "KhoiDong_Dev.bat" (hoac 开发模式.bat).
pause
