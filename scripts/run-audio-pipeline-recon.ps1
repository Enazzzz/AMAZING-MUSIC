<#
.SYNOPSIS
	Map which Amazon Music process hosts dmengine + Windows mix/device DLLs (AudioPipeline path).

.DESCRIPTION
	Lists every Amazon Music.exe instance (from WMI), records command line, then resolves loaded
	modules per PID. Highlights dmengine.dll, av.dll, and Core Audio / WASAPI-related modules
	(MMDevAPI, AudioSes, etc.). Use while music is playing so delay-loaded audio DLLs appear.

	Output: logs/audio-pipeline-recon-<timestamp>.txt

.PARAMETER ProcessImageName
	Executable file name as reported by WMI (default: Amazon Music.exe).
#>
param(
	[Parameter(Mandatory = $false)]
	[string]$ProcessImageName = "Amazon Music.exe"
)

# Amazon Music.exe is 32-bit (WOW64). From 64-bit PowerShell, [Process].Modules only lists the
# WOW64 shim (about 7 DLLs). Relaunch this script under 32-bit PowerShell for a real module list.
if ([Environment]::Is64BitProcess) {
	$wowPs = Join-Path $env:SystemRoot "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
	if (Test-Path -LiteralPath $wowPs) {
		Write-Host "[audio-pipeline-recon] Relaunching under 32-bit PowerShell for WOW64 module enumeration."
		& $wowPs -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -ProcessImageName $ProcessImageName
		exit $LASTEXITCODE
	}
}

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Matches module names for mix/device stack + Harley engine (case-insensitive).
function Test-InterestingModuleName {
	param([string]$Name)
	if (-not $Name) {
		return $false
	}
	$n = $Name.ToLowerInvariant()
	$patterns = @(
		"dmengine.dll",
		"av.dll",
		"libcef.dll",
		"mmdevapi.dll",
		"audioses.dll",
		"audiosesclient.dll",
		"audioeng.dll",
		"coreaudio.dll",
		"mfplat.dll",
		"mfreadwrite.dll",
		"msmpeg2adec.dll",
		"wasapi",
		"xaudio2",
		"winmm.dll"
	)
	foreach ($p in $patterns) {
		if ($n.Contains($p.ToLowerInvariant())) {
			return $true
		}
	}
	return $false
}

# Merges DLL names from tasklist output strings into a HashSet (lowercase file names).
function Add-DllNamesFromTasklistText {
	param(
		[System.Collections.Generic.HashSet[string]]$Set,
		[string]$Text
	)
	if (-not $Text -or ($Text -match "(?i)No tasks are running")) {
		return
	}
	$dllFound = [regex]::Matches($Text, "(?i)\b[a-z0-9._-]+\.dll\b")
	foreach ($m in $dllFound) {
		$null = $Set.Add($m.Value.ToLowerInvariant())
	}
}

# Returns DLL module names for a PID. For WOW64 (32-bit Amazon on 64-bit Windows), both System32
# and SysWOW64 tasklist views are merged so dmengine / audio DLLs are visible.
function Get-ModuleNamesForPid {
	param([int]$ProcId)
	$set = New-Object "System.Collections.Generic.HashSet[string]"
	$tasklistPaths = @(
		(Join-Path $env:SystemRoot "System32\tasklist.exe"),
		(Join-Path $env:SystemRoot "SysWOW64\tasklist.exe")
	)
	foreach ($tl in $tasklistPaths) {
		if (!(Test-Path -LiteralPath $tl)) {
			continue
		}
		$quoted = "`"" + $tl + "`" /m /fi `"PID eq $ProcId`""
		$raw = cmd.exe /c $quoted 2>&1 | Out-String
		Add-DllNamesFromTasklistText -Set $set -Text $raw
	}
	try {
		$proc = Get-Process -Id $ProcId -ErrorAction Stop
		foreach ($mod in $proc.Modules) {
			$null = $set.Add([string]$mod.ModuleName.ToLowerInvariant())
		}
	} catch {
	}
	return @($set | Sort-Object)
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $projectRoot "logs"
if (!(Test-Path -LiteralPath $logDir)) {
	New-Item -ItemType Directory -Path $logDir | Out-Null
}
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outPath = Join-Path $logDir ("audio-pipeline-recon-" + $stamp + ".txt")

$buf = New-Object System.Collections.Generic.List[string]
function Add-Line { param([string]$s) $buf.Add($s) | Out-Null }

Add-Line ("audio-pipeline-recon start: " + (Get-Date -Format o))
Add-Line ("ProcessImageName: " + $ProcessImageName)
Add-Line ""
Add-Line "TIP: Start music playback first; audio DLLs may load only after the graph opens."
Add-Line ""

$filterName = $ProcessImageName.Replace("\", "\\")
$procs = Get-CimInstance -ClassName Win32_Process -Filter ("Name = '" + $filterName + "'")

if (-not $procs) {
	Add-Line "No processes found. Launch Amazon Music, then rerun."
	$buf | Set-Content -Path $outPath -Encoding UTF8
	Write-Host "[audio-pipeline-recon] Wrote $outPath"
	exit 1
}

$rows = @()

foreach ($p in $procs) {
	$procId = [int]$p.ProcessId
	Add-Line ("=== PID " + $procId + " ===")
	Add-Line ("ParentProcessId: " + $p.ParentProcessId)
	$cmd = [string]$p.CommandLine
	if ($cmd.Length -gt 500) {
		$cmd = $cmd.Substring(0, 500) + "...(truncated)"
	}
	Add-Line ("CommandLine: " + $cmd)

	$modNames = Get-ModuleNamesForPid -ProcId $procId
	$interesting = @($modNames | Where-Object { Test-InterestingModuleName -Name $_ } | Sort-Object -Unique)

	if ($interesting.Count -gt 0) {
		Add-Line '--- highlighted modules (pipeline / device / engine) ---'
		foreach ($i in $interesting) {
			Add-Line ("  " + $i)
		}
	} else {
		Add-Line '(no highlighted modules yet; try during playback or run elevated if access denied)'
	}

	Add-Line ('--- total modules loaded: ' + $modNames.Count + ' ---')
	Add-Line ""

	$hasDm = ($interesting | Where-Object { $_ -match "(?i)^dmengine\.dll$" }) -ne $null
	$hasAv = ($interesting | Where-Object { $_ -match "(?i)^av\.dll$" }) -ne $null
	$hasMix = ($interesting | Where-Object {
			$_ -match "(?i)mmdevapi|audioses|mfplat|coreaudio"
		}) -ne $null

	$rows += [pscustomobject]@{
		Pid       = $procId
		HasDmEngine = $hasDm
		HasAvDll    = $hasAv
		HasMixDevice = $hasMix
	}
}

Add-Line "=== heuristic: AudioPipeline + mix/device candidates ==="
Add-Line "Prefer PIDs where dmengine.dll AND (MMDevAPI / AudioSes / mfplat) appear in the same process."
foreach ($r in $rows) {
	if ($r.HasDmEngine -and $r.HasMixDevice) {
		Add-Line ("  *** PID " + $r.Pid + " : dmengine + mix/device DLLs ***")
	} elseif ($r.HasDmEngine) {
		Add-Line ("  PID " + $r.Pid + " : dmengine only (mix DLLs may delay-load or another PID)")
	}
}

$buf | Set-Content -Path $outPath -Encoding UTF8
Write-Host "[audio-pipeline-recon] Wrote $outPath"

