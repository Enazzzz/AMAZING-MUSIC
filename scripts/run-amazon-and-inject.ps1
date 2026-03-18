param(
	# Your Amazon Music executable. Defaults to the path Morpho also uses.
	[Parameter(Mandatory = $false)]
	[string]$AmazonExePath = "$env:USERPROFILE\AppData\Local\Amazon Music\Amazon Music.exe",

	# The CDP debug port passed to Amazon Music.
	# In most Sandboxie setups, you can reuse the same port in different sandboxes.
	[Parameter(Mandatory = $false)]
	[int]$DebugPort = 9222,

	# Group Listening WebSocket endpoint.
	[Parameter(Mandatory = $false)]
	[string]$WsUrl = "ws://127.0.0.1:43843",

	# How long to wait after CDP connects before injecting.
	[Parameter(Mandatory = $false)]
	[int]$WaitMs = 10000,

	# CDP/eval timeout.
	[Parameter(Mandatory = $false)]
	[int]$TimeoutMs = 20000,

	# Set to true if Amazon Music is already running inside this sandbox and you only want injection.
	[Parameter(Mandatory = $false)]
	[switch]$SkipAmazonLaunch
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$injectScript = Join-Path $projectRoot "scripts\inject-extension.ps1"

function getWsHostPort($wsUrl) {
	# ws://HOST:PORT or wss://HOST:PORT
	if ($wsUrl -match "^wss?://([^:/]+):([0-9]+)") {
		return @{ host = $Matches[1]; port = [int]$Matches[2] }
	}
	throw "Invalid WsUrl: $wsUrl"
}

function writeNetTestMarker($wsUrl) {
	try {
		$target = getWsHostPort $wsUrl
		$testResult = Test-NetConnection -ComputerName $target.host -Port $target.port -InformationLevel Detailed
		$netLogDir = Join-Path $env:PUBLIC "MorphoInjectorLogs"
		if (!(Test-Path -Path $netLogDir)) { New-Item -ItemType Directory -Path $netLogDir | Out-Null }
		$ts = Get-Date -Format "yyyyMMdd-HHmmss"
		$path = Join-Path $netLogDir "nettest-$($target.host)-$($target.port)-$ts.txt"
		$testResult | Out-File -FilePath $path -Encoding UTF8
		Write-Host "[run-amazon-and-inject] Net test wrote: $path"
		$tcpOk = $testResult.TcpTestSucceeded
		if (-not $tcpOk) {
			Write-Host "[run-amazon-and-inject] Net test FAILED (TcpTestSucceeded=false). Group listening likely won't connect from inside the sandbox."
		}
		return $tcpOk
	} catch {
		Write-Host "[run-amazon-and-inject] Net test failed to run: $($_.Exception.Message)"
		return $false
	}
}

if (!(Test-Path -Path $AmazonExePath)) {
	throw "Amazon Music exe not found: $AmazonExePath"
}

Write-Host "[run-amazon-and-inject] Starting. DebugPort=$DebugPort WsUrl=$WsUrl"
Write-Host "[run-amazon-and-inject] inject script: $injectScript"

# Early connectivity check so you don't have to paste errors.
writeNetTestMarker -wsUrl $WsUrl | Out-Null

if (-not $SkipAmazonLaunch) {
	# Launch Amazon Music with CDP enabled for this sandbox.
	Write-Host "[run-amazon-and-inject] Launching Amazon Music with --remote-debugging-port=$DebugPort ..."
	$argList = @("--remote-debugging-port=$DebugPort")
	$proc = Start-Process -FilePath $AmazonExePath -ArgumentList $argList -PassThru
	Write-Host "[run-amazon-and-inject] Amazon pid=$($proc.Id)"

	# Give it a moment to start exposing /json.
	Start-Sleep -Seconds 3
} else {
	Write-Host "[run-amazon-and-inject] SkipAmazonLaunch=true; assuming Amazon is already running."
}

# Inject the extension UI by targeting exactly the same debug port we used.
Write-Host "[run-amazon-and-inject] Injecting extension..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $injectScript -DebugPortStart $DebugPort -DebugPortEnd $DebugPort -WsUrl $WsUrl -WaitMs $WaitMs -TimeoutMs $TimeoutMs

Write-Host "[run-amazon-and-inject] Done."

