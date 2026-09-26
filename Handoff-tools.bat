@echo off
title Handoff tools
set SCRIPT=%~dp0ops\handoff.ps1

:menu
echo.
echo  ==== Handoff tools ====
echo   1  Start Handoff      (app server + tunnel + watchdog)
echo   2  Stop Handoff
echo   3  Restart Handoff
echo   4  Check status       (is everything running?)
echo   5  View data          (companies, logins, applications)
echo   6  Open database      (SQL prompt)
echo   7  Exit
echo.
set /p CHOICE=Type a number and press Enter:
if "%CHOICE%"=="1" powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" start
if "%CHOICE%"=="2" powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" stop
if "%CHOICE%"=="3" powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" restart
if "%CHOICE%"=="4" powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" status
if "%CHOICE%"=="5" powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" data
if "%CHOICE%"=="6" powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" sql
if "%CHOICE%"=="7" exit /b
goto menu
