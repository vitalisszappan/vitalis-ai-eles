@echo off
cd /d "%~dp0"
if exist chatbot.pid node stop.cjs >nul 2>&1
start "Kérdezd a készítőt - Expert Rules 1.7" cmd /k node server.cjs
ping 127.0.0.1 -n 3 >nul
start "" http://localhost:3217/demo
