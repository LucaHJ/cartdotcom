$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
$nbaSavedCfToken = $env:CLOUDFLARE_API_TOKEN
try {
    # The host's environment token is Pages-scoped. Use the existing encrypted
    # Wrangler OAuth login, which already has Worker and route permissions.
    Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
    npm run deploy
    if ($LASTEXITCODE -ne 0) { throw 'NBA deployment failed.' }
} finally {
    if ($null -ne $nbaSavedCfToken) { $env:CLOUDFLARE_API_TOKEN = $nbaSavedCfToken }
    Pop-Location
}
