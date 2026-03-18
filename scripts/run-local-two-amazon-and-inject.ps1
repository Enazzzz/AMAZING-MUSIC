param(
	[Parameter(Mandatory = $false)]
	[string]$AmazonExePath = "$env:USERPROFILE\AppData\Local\Amazon Music\Amazon Music.exe",

	[Parameter(Mandatory = $false)]
	[int]$DebugPortHost = 9222,

	[Parameter(Mandatory = $false)]
	[int]$DebugPortListener = 9223,

	[Parameter(Mandatory = $false)]
	[string]$WsUrl = "ws://127.0.0.1:43843",

	[Parameter(Mandatory = $false)]
	[int]$WaitMsAfterLaunch = 5000,

	[Parameter(Mandatory = $false)]
	[int]$InjectWaitMs = 10000,

	[Parameter(Mandatory = $false)]
	[int]$InjectTimeoutMs = 20000,

	# If set, attempts to kill Amazon Music before launching test instances.
	[Parameter(Mandatory = $false)]
	[switch]$KillExistingAmazon
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$injectScript = Join-Path $projectRoot "scripts\inject-extension.ps1"

if (!(Test-Path -Path $AmazonExePath)) {
	throw "Amazon Music exe not found: $AmazonExePath"
}

function tryGetCdpTargetsJson($port) {
	try {
		$resp = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json" -Method Get -TimeoutSec 2
		return $resp
	} catch {
		return $null
	}
}

function waitForCdpTargetsJson($port, $timeoutMs) {
	$deadline = (Get-Date).AddMilliseconds($timeoutMs)
	while ((Get-Date) -lt $deadline) {
		$resp = tryGetCdpTargetsJson $port
		if ($null -ne $resp) {
			return $resp
		}
		Start-Sleep -Milliseconds 400
	}
	return $null
}

function startMorphoServerOnly() {
	# Runs the GroupListeningServer embedded in Electron.
	# We detach it so this script can proceed.
	$serverArgs = @(
		"-NoProfile",
		"-ExecutionPolicy",
		"Bypass",
		"-Command",
		"npm run server:only"
	)

	Write-Host "[local-test] Starting Morpho server-only (Group Listening WebSocket) ..."
	Start-Process -FilePath "powershell.exe" -ArgumentList $serverArgs -WorkingDirectory $projectRoot | Out-Null
	Start-Sleep -Seconds 2
}

if ($KillExistingAmazon) {
	Write-Host "[local-test] Killing existing Amazon Music processes ..."
	Get-Process -Name "Amazon Music" -ErrorAction SilentlyContinue | Stop-Process -Force
}

$userDataBase = Join-Path $env:LOCALAPPDATA "MorphoAmazonLocalTest"
$userData1 = Join-Path $userDataBase "instance-host"
$userData2 = Join-Path $userDataBase "instance-listener"

if (!(Test-Path -Path $userDataBase)) {
	New-Item -ItemType Directory -Path $userDataBase | Out-Null
}

$null = New-Item -ItemType Directory -Path $userData1 -Force
$null = New-Item -ItemType Directory -Path $userData2 -Force

startMorphoServerOnly

Write-Host "[local-test] Launching Amazon instance HOST ..."
$p1 = Start-Process -FilePath $AmazonExePath -ArgumentList @(
		"--remote-debugging-port=$DebugPortHost",
		"--user-data-dir=$userData1"
	) -PassThru
Write-Host "[local-test] Host pid=$($p1.Id)"

Write-Host "[local-test] Launching Amazon instance LISTENER ..."
$p2 = Start-Process -FilePath $AmazonExePath -ArgumentList @(
		"--remote-debugging-port=$DebugPortListener",
		"--user-data-dir=$userData2"
	) -PassThru
Write-Host "[local-test] Listener pid=$($p2.Id)"

Write-Host "[local-test] Waiting $WaitMsAfterLaunch ms for CDP endpoints ..."
Start-Sleep -Milliseconds $WaitMsAfterLaunch

Write-Host "[local-test] Checking CDP endpoints ..."
$hostTargets = waitForCdpTargetsJson -port $DebugPortHost -timeoutMs 5000
if ($null -eq $hostTargets) {
	throw "Host debug port $DebugPortHost did not respond at http://127.0.0.1:$DebugPortHost/json. Amazon may not be starting with remote debugging."
}
$listenerTargets = waitForCdpTargetsJson -port $DebugPortListener -timeoutMs 5000
$listenerInjectionEnabled = $true
if ($null -eq $listenerTargets) {
	Write-Host "[local-test] WARNING: Listener debug port $DebugPortListener did not respond."
	Write-Host "[local-test] This usually means Amazon Music enforces a single-instance window, so the second launch reused the first instance."
	Write-Host "[local-test] Fallback: skipping second injection. Use the extension UI in the first instance: click Start Room, then Join Room (room code is auto-filled)."
	$listenerInjectionEnabled = $false
	$listenerInjectionPort = $DebugPortHost
} else {
	$listenerInjectionPort = $DebugPortListener
}

Write-Host "[local-test] Injecting extension into HOST instance ..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $injectScript -DebugPortStart $DebugPortHost -DebugPortEnd $DebugPortHost -WsUrl $WsUrl -WaitMs $InjectWaitMs -TimeoutMs $InjectTimeoutMs

if ($listenerInjectionEnabled) {
	Write-Host "[local-test] Injecting extension into LISTENER instance ..."
	& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $injectScript -DebugPortStart $listenerInjectionPort -DebugPortEnd $listenerInjectionPort -WsUrl $WsUrl -WaitMs $InjectWaitMs -TimeoutMs $InjectTimeoutMs
}

Write-Host "[local-test] Done. Use the extension UI in both instances to create/join a room."

