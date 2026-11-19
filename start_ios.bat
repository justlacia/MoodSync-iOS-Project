@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title MoodSync iOS (Expo Go + YOLOv8)
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" start_ios.py %*
) else (
    where python >nul 2>nul
    if %errorlevel% equ 0 (
        python start_ios.py %*
    ) else (
        py -3 start_ios.py %*
    )
)
pause

