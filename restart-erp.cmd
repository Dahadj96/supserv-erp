@echo off
REM Double-click this to restart the ERP.
REM
REM It lives in the root of the repository rather than in scripts\ because the
REM whole point is that it is the first thing you see in the folder. Windows
REM will ask for permission - the task runs as SYSTEM and stopping it needs
REM Administrator, which is the question behind every "Access is denied" this
REM has ever produced.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\server\restart.ps1"
