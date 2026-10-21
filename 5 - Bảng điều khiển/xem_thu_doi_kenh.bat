@echo off
chcp 65001 >nul
cd /d "%~dp0"
set CHE_DO_THU=1
set KHO_DIR=%~dp0KHO_THU
python server.py --doi-kenh-thu
pause
