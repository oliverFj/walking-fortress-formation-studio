@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo Python 3 blev ikke fundet. Installer Python 3 og proev igen.
  pause
  exit /b 1
)
echo Starter Walking Fortress Formationsstudio...
python server.py --open
if errorlevel 1 pause
