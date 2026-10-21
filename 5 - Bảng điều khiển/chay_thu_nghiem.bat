@echo off
chcp 65001 >nul
cd /d "%~dp0"
title BAN THU NGHIEM - Bang dieu khien (khong dung vao ban chinh)
set CHE_DO_THU=1
set PORT=8810
set KHO_DIR=%~dp0KHO_THU
echo Dang chay BAN THU NGHIEM o cong 8810. Kho rieng: %KHO_DIR%
echo Ban chinh (cong 8800) khong bi dung toi.
python server.py
pause
