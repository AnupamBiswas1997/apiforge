@echo off
REM ============================================================
REM  APIForge — Windows setup and launcher
REM  Run this file to install dependencies and start the app.
REM  Usage: double-click start.bat  OR  run from a terminal
REM ============================================================

setlocal

REM ── Check Node.js is installed ────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo         Download it from: https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER% found.

REM ── Install server dependencies ───────────────────────────────
echo.
echo [1/4] Installing server dependencies...
cd /d "%~dp0server"
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Server npm install failed.
    pause
    exit /b 1
)
echo [OK] Server dependencies installed.

REM ── Install client dependencies ───────────────────────────────
echo.
echo [2/4] Installing client dependencies...
cd /d "%~dp0client"
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Client npm install failed.
    pause
    exit /b 1
)
echo [OK] Client dependencies installed.

REM ── Create data directory ─────────────────────────────────────
if not exist "%~dp0data\runs" (
    mkdir "%~dp0data\runs"
    echo [OK] Created data\runs directory.
)

REM ── Copy .env if missing ──────────────────────────────────────
if not exist "%~dp0.env" (
    if exist "%~dp0.env.example" (
        copy "%~dp0.env.example" "%~dp0.env" >nul
        echo [OK] Created .env from .env.example.
        echo      ^> Open .env and set your LLM provider + API key before running tests.
        echo      ^> Or use the /connect page in the browser to configure at runtime.
    )
)

REM ── Start backend in a new window ─────────────────────────────
echo.
echo [3/4] Starting backend server (new window)...
start "APIForge Backend" cmd /k "cd /d "%~dp0server" && echo Starting APIForge server... && node index.js"

REM ── Give the server a moment to bind its port ─────────────────
timeout /t 2 /nobreak >nul

REM ── Start frontend dev server in a new window ─────────────────
echo [4/4] Starting frontend dev server (new window)...
start "APIForge Frontend" cmd /k "cd /d "%~dp0client" && echo Starting Vite dev server... && npm run dev"

REM ── Done ──────────────────────────────────────────────────────
echo.
echo ============================================================
echo  APIForge is starting up!
echo.
echo  Backend:  http://localhost:3001
echo  Frontend: http://localhost:3000
echo.
echo  Open http://localhost:3000 in your browser.
echo  Both server windows will open separately.
echo ============================================================
echo.
pause
