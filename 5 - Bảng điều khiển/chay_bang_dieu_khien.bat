@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Bang dieu khien - day chuyen tu dong lam video
rem Tat ban cu (neu con chay o cong 8800) de bat lai moi, khong bi bao trung cong
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8800" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
python server.py
pause
