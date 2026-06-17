@echo off
setlocal
cd /d "%~dp0"

echo.
echo NamSmart Server Launcher
echo.

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Node.js is not installed.
    echo Download it from: https://nodejs.org
    pause
    exit /b 1
)

where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo npm is not available.
    pause
    exit /b 1
)

node -e "require.resolve('express');require.resolve('cors');require.resolve('http-proxy-ws');require.resolve('jsonwebtoken');require.resolve('exceljs')" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Installing dependencies...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo Failed to install dependencies.
        pause
        exit /b 1
    )
    echo Dependencies installed.
    echo.
)

netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Server is already running at http://localhost:3000
    echo Close the existing server window before starting a new instance.
    echo.
    pause
    exit /b 0
)

echo Starting server...
echo.
call npm start

pause
