# =============================================================
#  Deploie le site directement sur le serveur, sans passer par GitHub.
#  Le site est servi par nginx depuis /var/www/carte sur la VM
#  Minecraft, et publie en HTTPS via le tunnel Cloudflare
#  (https://mc.ushthepup.fr).
#
#  Usage :
#     .\deployer-sur-le-serveur.ps1            # code seulement (rapide)
#     .\deployer-sur-le-serveur.ps1 -Tuiles    # + les pyramides de tuiles
#
#  Par defaut on n'envoie que les fichiers legers : les dossiers
#  tiles/ et tiles-parchment/ pesent ~220 Mo et ne changent qu'a la
#  regeneration des tuiles.
# =============================================================
param([switch]$Tuiles)

$ErrorActionPreference = 'Stop'

$serveur = 'root@192.168.1.39'
$cible   = '/var/www/carte'
$racine  = $PSScriptRoot

$elements = @('index.html', 'map_meta.json', 'css', 'js', 'vendor', 'data', 'db', 'tools')
if ($Tuiles) { $elements += @('tiles', 'tiles-parchment') }

$presents = $elements | Where-Object { Test-Path (Join-Path $racine $_) }
if (-not $presents) { throw "Rien a deployer depuis $racine" }

Write-Host "Envoi vers $serveur : $($presents -join ', ')"

# On passe par une archive : des milliers de petits fichiers en scp un a
# un seraient beaucoup plus lents que le transfert d'un seul .tgz.
$archive = Join-Path $env:TEMP 'carte-deploy.tgz'
if (Test-Path $archive) { Remove-Item $archive -Force }

Push-Location $racine
try {
    & tar -czf $archive $presents
    if ($LASTEXITCODE -ne 0) { throw "echec de la creation de l'archive" }
} finally { Pop-Location }

$taille = [math]::Round((Get-Item $archive).Length / 1MB, 1)
Write-Host "Archive : $taille Mo"

& scp -q $archive "${serveur}:/tmp/carte-deploy.tgz"
if ($LASTEXITCODE -ne 0) { throw "echec du transfert" }

& ssh $serveur "tar -xzf /tmp/carte-deploy.tgz -C $cible && rm -f /tmp/carte-deploy.tgz && echo OK"
if ($LASTEXITCODE -ne 0) { throw "echec du deploiement sur le serveur" }

Remove-Item $archive -Force
Write-Host "Deploye : https://mc.ushthepup.fr/" -ForegroundColor Green
