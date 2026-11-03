@echo off
rem Dong goi: build React, Electron, Inno Setup. Bo cai nam trong thu muc dist\
cd /d "%~dp0"
node scripts\build-installer.js
pause
