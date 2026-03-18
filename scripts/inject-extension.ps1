param(
	[Parameter(Mandatory=$false)]
	[string]$DebugPort = "9222",

	[Parameter(Mandatory=$false)]
	[string]$DebugPortStart = "",

	[Parameter(Mandatory=$false)]
	[string]$DebugPortEnd = "",

	[Parameter(Mandatory=$false)]
	[string]$WsUrl = "ws://127.0.0.1:43843",

	[Parameter(Mandatory=$false)]
	[string]$WaitMs = "10000",

	[Parameter(Mandatory=$false)]
	[string]$TimeoutMs = "15000",

	[Parameter(Mandatory=$false)]
	[switch]$Rebuild
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot

# Create a very early log marker so we know the script actually started.
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logDir = Join-Path $projectRoot "logs"
$logPath = Join-Path $logDir ("inject-extension-$timestamp.log")
$transcriptPath = Join-Path $logDir ("inject-extension-$timestamp-transcript.log")

# Extra fallback location that is more likely to be readable from the host even under Sandboxie.
$hostLogDir = Join-Path $env:PUBLIC "MorphoInjectorLogs"
$hostLogPath = Join-Path $hostLogDir ("inject-extension-$timestamp.log")
$hostTranscriptPath = Join-Path $hostLogDir ("inject-extension-$timestamp-transcript.log")

# Create log dir if missing.
if (!(Test-Path -Path $logDir)) {
	New-Item -ItemType Directory -Path $logDir | Out-Null
}
if (!(Test-Path -Path $hostLogDir)) {
	New-Item -ItemType Directory -Path $hostLogDir | Out-Null
}

$marker = @"
[inject-extension] START
timestamp=$timestamp
pid=$PID
args:
  DebugPort=$DebugPort
  DebugPortStart=$DebugPortStart
  DebugPortEnd=$DebugPortEnd
  WsUrl=$WsUrl
  WaitMs=$WaitMs
  TimeoutMs=$TimeoutMs
"@
$marker | Out-File -FilePath $logPath -Encoding UTF8
$marker | Out-File -FilePath $hostLogPath -Encoding UTF8

Write-Host "[inject-extension] Logs:"
Write-Host "  project: $logPath"
Write-Host "  public:  $hostLogPath"

# Capture all console output to the same log file.
# Note: Start-Transcript can fail in locked-down environments; if it fails we still write to $logPath manually.
$transcriptStarted = $false
try {
	Start-Transcript -Path $transcriptPath -Force | Out-Null
	$transcriptStarted = $true
} catch {
	# ignore
}

if ($Rebuild -or !(Test-Path -Path (Join-Path $projectRoot "dist/launcher/injectExtension.js"))) {
	Write-Host "[inject-extension] Building main (tsc) + running injector..."
	npm run build:main | Out-Host
}

try {
	$nodeArgs = @(
		(Join-Path $projectRoot "dist/launcher/injectExtension.js")
	)
	if ($DebugPortStart -and $DebugPortEnd) {
		$nodeArgs += "--debugPortStart=$DebugPortStart"
		$nodeArgs += "--debugPortEnd=$DebugPortEnd"
	} else {
		$nodeArgs += "--debugPort=$DebugPort"
	}
	$nodeArgs += "--wsUrl=$WsUrl"
	$nodeArgs += "--waitMs=$WaitMs"
	$nodeArgs += "--timeoutMs=$TimeoutMs"

	Write-Host "[inject-extension] Running: node $($nodeArgs -join ' ')"

	# Ensure errors are visible and also saved for later inspection.
	# Avoid Tee-Object in restricted PS environments; append output to the log manually.
	$nodeOutput = & node @nodeArgs 2>&1
	$nodeOutput | Out-File -FilePath $logPath -Append -Encoding UTF8
	$nodeOutput | Out-File -FilePath $hostLogPath -Append -Encoding UTF8
	Write-Host ($nodeOutput | Out-String)

	Write-Host "[inject-extension] Finished successfully. Log: $logPath"
} catch {
	# Surface the full error to console AND to log file.
	$err = $_
	$details = "INJECTOR FAILED: $($err.Exception.Message)`n$($err | Out-String)"
	$details | Out-File -FilePath $logPath -Append -Encoding UTF8
	$details | Out-File -FilePath $hostLogPath -Append -Encoding UTF8
	Write-Host $details
	throw
} finally {
	if ($transcriptStarted) {
		try { Stop-Transcript | Out-Null } catch { }
	}
	# Restore the previous working directory no matter what.
	Pop-Location | Out-Null
}

