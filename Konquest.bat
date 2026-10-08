@echo off
rem Opens Konquest in the default browser.
if not exist "%~dp0dist\konquest.html" (
  echo dist\konquest.html not found. Run "npm install" and "npm run build".
  pause
  exit /b 1
)
start "" "%~dp0dist\konquest.html"
