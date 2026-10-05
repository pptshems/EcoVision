@echo off
title EcoVision - PC + Arduino Bridge
start "EcoVision Arduino Bridge" cmd /k python arduino_bridge.py
timeout /t 2 /nobreak >nul
start "EcoVision Website" https://ecovision-0z28.onrender.com
echo.
echo EcoVision PC mode started.
echo Arduino is handled by the Arduino Bridge window.
echo Keep that bridge window open.
echo.
