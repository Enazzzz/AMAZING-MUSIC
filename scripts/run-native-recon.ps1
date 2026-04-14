param(
	[Parameter(Mandatory=$false)]
	[string]$ProcessName = "Amazon Music.exe",

	[Parameter(Mandatory=$false)]
	[int]$DurationSeconds = 20
)

$ErrorActionPreference = "Stop"

function Get-ProcessByNameLoose {
	param([string]$Name)
	$needle = $Name.ToLowerInvariant()
	$candidates = Get-CimInstance Win32_Process | Where-Object {
		$procName = [string]$_.Name
		$cmd = [string]$_.CommandLine
		$procName.ToLowerInvariant() -eq $needle -or $cmd.ToLowerInvariant().Contains($needle.Replace(".exe", ""))
	}
	return $candidates
}

function Get-ProcessChildren {
	param(
		[int]$ParentPid,
		[array]$All
	)
	return $All | Where-Object { [int]$_.ParentProcessId -eq $ParentPid }
}

function Write-Section {
	param(
		[string]$Path,
		[string]$Title,
		[string]$Content
	)
	Add-Content -Path $Path -Value ""
	Add-Content -Path $Path -Value ("=== " + $Title + " ===")
	Add-Content -Path $Path -Value $Content
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $projectRoot "logs"
if (!(Test-Path -Path $logDir)) {
	New-Item -ItemType Directory -Path $logDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outPath = Join-Path $logDir ("native-recon-" + $timestamp + ".txt")

"Native recon start: $(Get-Date -Format o)" | Out-File -FilePath $outPath -Encoding UTF8
"Target process name: $ProcessName" | Add-Content -Path $outPath
"DurationSeconds: $DurationSeconds" | Add-Content -Path $outPath

$all = Get-CimInstance Win32_Process
$targets = Get-ProcessByNameLoose -Name $ProcessName

if (!$targets -or $targets.Count -eq 0) {
	Write-Section -Path $outPath -Title "status" -Content "No matching process found. Start Amazon Music first, then rerun."
	Write-Host "[native-recon] No matching process found."
	Write-Host "[native-recon] Wrote $outPath"
	exit 1
}

$targetList = $targets | Select-Object ProcessId, ParentProcessId, Name, CommandLine, ExecutablePath
Write-Section -Path $outPath -Title "targets" -Content ($targetList | Format-List | Out-String)

# Build one-level and two-level process tree snapshots from initial capture.
$treeLines = New-Object System.Collections.Generic.List[string]
foreach ($t in $targets) {
	$procId = [int]$t.ProcessId
	$treeLines.Add(("PID {0} {1}" -f $procId, $t.Name))
	$children = Get-ProcessChildren -ParentPid $procId -All $all
	foreach ($c in $children) {
		$treeLines.Add(("  -> PID {0} {1}" -f $c.ProcessId, $c.Name))
		$grand = Get-ProcessChildren -ParentPid ([int]$c.ProcessId) -All $all
		foreach ($g in $grand) {
			$treeLines.Add(("      -> PID {0} {1}" -f $g.ProcessId, $g.Name))
		}
	}
}
Write-Section -Path $outPath -Title "process-tree-initial" -Content ($treeLines -join "`n")

# Capture loaded modules for each target PID using tasklist (works cross-privilege more reliably).
foreach ($t in $targets) {
	$procId = [int]$t.ProcessId
	$mods = cmd /c "tasklist /m /fi ""PID eq $procId"""
	Write-Section -Path $outPath -Title ("modules-pid-" + $procId) -Content ($mods | Out-String)
}

# Timed snapshots to catch CEF subprocess churn while playback runs.
$snapStart = Get-Date
for ($i = 0; $i -lt $DurationSeconds; $i += 2) {
	Start-Sleep -Seconds 2
	$snapAll = Get-CimInstance Win32_Process
	$snapTargets = Get-ProcessByNameLoose -Name $ProcessName
	$stamp = (Get-Date -Format o)
	$content = @()
	$content += ("ts: " + $stamp)
	$content += ("count: " + ($snapTargets | Measure-Object).Count)
	foreach ($p in $snapTargets) {
		$content += ("  pid={0} ppid={1} name={2}" -f $p.ProcessId, $p.ParentProcessId, $p.Name)
		$cmd = [string]$p.CommandLine
		if ($cmd.Length -gt 300) {
			$cmd = $cmd.Substring(0, 300) + "...(truncated)"
		}
		$content += ("    cmd=" + $cmd)
		$kids = Get-ProcessChildren -ParentPid ([int]$p.ProcessId) -All $snapAll
		foreach ($k in $kids) {
			$content += ("    child pid={0} name={1}" -f $k.ProcessId, $k.Name)
		}
	}
	Write-Section -Path $outPath -Title ("timed-snapshot-" + $i + "s") -Content ($content -join "`n")
}

# Audio-related module grep from captured module sections.
$fullText = Get-Content -Path $outPath -Raw
$audioPattern = "(?im)\b(audio|wasapi|xaudio|mmdevapi|audioses|mediafoundation|mfplat|mfcore|avcodec|avformat|widevine|cef)\S*\.dll\b"
$audioMatches = [regex]::Matches($fullText, $audioPattern) | ForEach-Object { $_.Value.ToLowerInvariant() } | Sort-Object -Unique
Write-Section -Path $outPath -Title "audio-related-dll-hints" -Content (($audioMatches -join "`n"))

Write-Host "[native-recon] Completed."
Write-Host "[native-recon] Wrote $outPath"
