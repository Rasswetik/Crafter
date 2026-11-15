@echo off
chcp 65001 >nul
cd /d %~dp0
if not exist .env copy .env.example .env >nul
python -m pip install -r requirements.txt
echo.
echo Готово. Впиши токен бота в файл .env и запусти start.bat
pause
