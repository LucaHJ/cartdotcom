param(
    [string]$OutputDirectory = (Join-Path $HOME "Documents\CartdotcomExports")
)

$ErrorActionPreference = "Stop"
$repository = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$workerDirectory = Join-Path $repository "deployment\cloudflare-news-signal-container"
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$output = Join-Path $OutputDirectory "cartdotcom-news-signal-$timestamp.sql"

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
Push-Location $workerDirectory
try {
    # The workstation may carry a deployment-only token without D1 read access.
    Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
    npx wrangler d1 export cartdotcom-news-signal --remote --skip-confirmation --output $output
    if ($LASTEXITCODE -ne 0) {
        throw "Wrangler D1 export failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

$hash = Get-FileHash -Algorithm SHA256 $output
Write-Output "Export: $output"
Write-Output "SHA256: $($hash.Hash)"
