@echo off
title EcoVision - Phone Mode
set ECOVISION_HTTPS=1
echo.
echo EcoVision phone mode is starting...
echo.
echo On the phone, open: https://YOUR-PC-IP:5000
echo Replace YOUR-PC-IP with your PC's IPv4 address.
echo.
python app.py
pause
