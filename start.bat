@echo off
rem Phim Ngan Hong Qua - Launch app
chcp 65001 >nul
title Phim Ngan Hong Qua
cd /d "%~dp0"

if exist "dist\win-unpacked\Phim Ngắn Hồng Quả.exe" (
    start "" "dist\win-unpacked\Phim Ngắn Hồng Quả.exe"
    exit /b 0
)
if exist "dist\win-unpacked\红果短剧.exe" (
    start "" "dist\win-unpacked\红果短剧.exe"
    exit /b 0
)

if exist "dist" (
    for %%F in ("dist\*Portable*.exe" "dist\*-便携版.exe" "dist\*Setup*.exe" "dist\*-win-x64-setup.exe") do (
        if exist "%%~fF" (
            start "" "%%~fF"
            exit /b 0
        )
    )
)

echo ========================================================
echo  Phim Ngan Hong Qua
echo ========================================================
echo  Chua tim thay ban dong goi trong thu muc dist.
echo  Dang tu dong chuyen sang khoi dong che do phat trien...
echo ========================================================
echo.

call "%~dp0dev.bat"
