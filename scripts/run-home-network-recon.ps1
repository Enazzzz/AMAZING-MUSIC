param(
	[Parameter(Mandatory = $false)]
	[string]$DebugPort = "9222",

	[Parameter(Mandatory = $false)]
	[string]$DurationMs = "30000"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
	Write-Host "[home-network-recon] Build + capture starting..."
	npm run build:main | Out-Host
	node dist/launcher/reconHomeNetwork.js --debugPort=$DebugPort --durationMs=$DurationMs
} finally {
	Pop-Location | Out-Null
}
