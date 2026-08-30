@echo off
echo === Trello Float - Build Windows ===
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale Node.js LTS primeiro.
  pause
  exit /b 1
)
npm install
if errorlevel 1 (
  echo Falha no npm install.
  pause
  exit /b 1
)
npm run dist
if errorlevel 1 (
  echo Falha no build.
  pause
  exit /b 1
)
echo.
echo Pronto. O executavel esta na pasta dist.
pause
