@echo off
title EcoVision - Remote Arduino Bridge
cd /d "%~dp0"
echo.
echo EcoVision Arduino Bridge
 echo Set ECOVISION_SERVER_URL and ECOVISION_BRIDGE_TOKEN before running.
echo.
python arduino_bridge.py
pause
