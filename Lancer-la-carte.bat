@echo off
chcp 65001 >nul
title Carte du Monde - serveur local
cd /d "%~dp0"

echo ============================================
echo    Carte du Monde - Explorateur de royaumes
echo ============================================
echo.
echo Demarrage du serveur local sur http://localhost:8777
echo Laisse cette fenetre OUVERTE pendant que tu utilises la carte.
echo Ferme-la (ou Ctrl+C) pour arreter.
echo.

REM Ouvre le navigateur sur la carte
start "" "http://localhost:8777/index.html"

REM Lance le serveur (essaie python puis py)
python -m http.server 8777 2>nul || py -m http.server 8777
