# Деплой API DE Exchange на Netlify — один скрипт, чтобы токен больше не терялся.
# Токен лежит в C:\KNOT\SITE\_tools\netlify\.token (только токен, UTF-8 без BOM).
# Он же продублирован в переменную окружения пользователя NETLIFY_AUTH_TOKEN.
#
# Использование:
#   pwsh -File C:\KNOT\TOOLS\deploy-api.ps1 -Message "что поменял"

param(
  [string]$Message = "de api deploy",
  [string]$TokenFile = "C:\KNOT\SITE\_tools\netlify\.token",
  [string]$SiteId = "f39e7bc4-2377-4d5e-a166-7656e05e2c68"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $TokenFile)) { throw "нет файла с токеном: $TokenFile" }
$token = (Get-Content $TokenFile -Raw).Trim()
if (-not $token.StartsWith("nfp_")) { throw "в $TokenFile не токен Netlify (ожидается nfp_...)" }
$env:NETLIFY_AUTH_TOKEN = $token

$cli = "C:\KNOT\TOOLS\netlify-cli\node_modules\netlify-cli\bin\run.js"
$root = "C:\KNOT\SITE"

Write-Host "деплою API: $Message"
Push-Location $root
try {
  node $cli deploy --prod --site $SiteId --dir deploy --functions netlify/functions --message $Message 2>&1 |
    Select-String -Pattern "Deploy is live|Production URL|error|Error|Failed" | Select-Object -Last 8
}
finally { Pop-Location; Remove-Item Env:\NETLIFY_AUTH_TOKEN -ErrorAction SilentlyContinue }

Write-Host "проверка ручки:"
try {
  $r = Invoke-RestMethod "https://de-exchange.netlify.app/api/market?t=$(Get-Random)" -TimeoutSec 60
  "  ok=$($r.ok) BTC=$($r.prices.BTC) hist=$($r.hist.BTC.Count) spanH=$($r.changeH.BTC)"
} catch { "  проверка не прошла: $_" }
