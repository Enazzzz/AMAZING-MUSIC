param(
	[Parameter(Mandatory=$false)]
	[string]$WsUrl = "ws://127.0.0.1:43843",

	[Parameter(Mandatory=$false)]
	[string]$RoomCode = "",

	[Parameter(Mandatory=$false)]
	[string]$Name = "FakeHost",

	[Parameter(Mandatory=$false)]
	[int]$IntervalMs = 250,

	[Parameter(Mandatory=$false)]
	[int]$StepMs = 250,

	[Parameter(Mandatory=$false)]
	[int]$StartTimeMs = 0,

	[Parameter(Mandatory=$false)]
	[bool]$IsPlaying = $true
)

$ErrorActionPreference = "Stop"

$cmd = "npm run fake:host -- --wsUrl=$WsUrl --name=$Name --intervalMs=$IntervalMs --stepMs=$StepMs --startTimeMs=$StartTimeMs --isPlaying=$IsPlaying"
if ($RoomCode) {
	$cmd += " --roomCode=$RoomCode"
}

Write-Host "[fake-host] Running:"
Write-Host $cmd

cmd /c $cmd

