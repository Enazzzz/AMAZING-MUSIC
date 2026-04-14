param(
	[Parameter(Mandatory=$false)]
	[int]$DebugPort = 9222,

	[Parameter(Mandatory=$false)]
	[int]$DurationMs = 15000
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot

try {
	Write-Host "[audio-probe] Running in $projectRoot"
	Write-Host "[audio-probe] Start playing a normal MUSIC track before this command."
	& npm run probe:audio-path -- --debugPort=$DebugPort --durationMs=$DurationMs --outputDir=logs
} finally {
	Pop-Location | Out-Null
}

