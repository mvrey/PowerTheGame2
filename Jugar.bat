@echo off
rem Abre el juego en el navegador predeterminado.
if not exist "%~dp0dist\index.html" (
  echo No se encuentra dist\index.html. Ejecuta "npm install" y "npm run build".
  pause
  exit /b 1
)
start "" "%~dp0dist\index.html"
