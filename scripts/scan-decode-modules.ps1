<#
.SYNOPSIS
	Scan Amazon Music native binaries for exported symbols that suggest a decode/FFmpeg path.

.DESCRIPTION
	Runs MSVC dumpbin /exports on dmengine.dll, av.dll, and the main executable when possible.
	Filters names for common libav/ffmpeg and audio decode tokens. If dumpbin is missing, prints
	manual steps (install VS Build Tools or add dumpbin to PATH).

	Optional earlier research: libav symbols exported from av.dll. For player-like tempo/pitch,
	prefer AudioPipeline → mix → WASAPI (see amazon-music-reverse-engineering.md §18).

.PARAMETER AmazonInstallPath
	Directory containing Amazon Music.exe (default: %LOCALAPPDATA%\\Amazon Music).
#>
param(
	[Parameter(Mandatory = $false)]
	[string]$AmazonInstallPath = $(Join-Path $env:LOCALAPPDATA "Amazon Music")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Resolves dumpbin.exe from a VS install (preferred) or PATH.
function Resolve-DumpBinExe {
	$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
	if (Test-Path -LiteralPath $vswhere) {
		$installPath = & $vswhere -latest -products * `
			-requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
			-property installationPath 2>$null
		if ($installPath) {
			$globRoot = Join-Path $installPath "VC\Tools\MSVC"
			if (Test-Path -LiteralPath $globRoot) {
				$hit = Get-ChildItem -Path $globRoot -Recurse -Filter "dumpbin.exe" -ErrorAction SilentlyContinue |
					Where-Object { $_.FullName -match '\\bin\\Hostx64\\x64\\' } |
					Select-Object -First 1
				if ($hit) {
					return $hit.FullName
				}
			}
		}
	}
	$fromPath = Get-Command "dumpbin" -ErrorAction SilentlyContinue
	if ($fromPath) {
		return $fromPath.Path
	}
	return $null
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $projectRoot "logs"
if (!(Test-Path -LiteralPath $logDir)) {
	New-Item -ItemType Directory -Path $logDir | Out-Null
}
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outPath = Join-Path $logDir ("decode-module-scan-" + $stamp + ".txt")

$lines = New-Object System.Collections.Generic.List[string]
function Add-Line { param([string]$s) $lines.Add($s) | Out-Null }

Add-Line ("decode-module-scan start: " + (Get-Date -Format o))
Add-Line ("AmazonInstallPath: " + $AmazonInstallPath)
Add-Line ""

if (!(Test-Path -LiteralPath $AmazonInstallPath)) {
	Add-Line "ERROR: Install path not found. Pass -AmazonInstallPath or install Amazon Music."
	$lines | Set-Content -Path $outPath -Encoding UTF8
	Write-Host "[scan-decode-modules] Wrote $outPath"
	exit 1
}

# Harley decode path: libav-style entry points are exported from av.dll on typical installs.
# dmengine.dll often has no public decode exports (static link or private symbols only).
$targets = @(
	"dmengine.dll",
	"av.dll"
)

$dllRipple = Get-ChildItem -LiteralPath $AmazonInstallPath -Filter "*.dll" -File -ErrorAction SilentlyContinue |
	Where-Object {
		$n = $_.Name.ToLowerInvariant()
		$n.Contains("av") -or $n.Contains("ffmpeg") -or $n.Contains("swresample") -or $n.Contains("codec")
	} |
	Select-Object -ExpandProperty Name
if ($dllRipple) {
	Add-Line "=== extra dll hints (name filter) ==="
	foreach ($n in ($dllRipple | Sort-Object -Unique)) {
		Add-Line $n
	}
	Add-Line ""
}

$dumpbin = Resolve-DumpBinExe
if (!$dumpbin) {
	Add-Line "dumpbin.exe not found."
	Add-Line "Install 'Desktop development with C++' (MSVC) or Build Tools, then rerun."
	Add-Line "Manual: dumpbin /exports ""$AmazonInstallPath\dmengine.dll"""
	$lines | Set-Content -Path $outPath -Encoding UTF8
	Write-Host "[scan-decode-modules] Wrote $outPath (dumpbin missing)"
	exit 0
}

Add-Line ("using dumpbin: " + $dumpbin)
Add-Line ""

# Export lines of interest (libav-style public exports or generic decode tokens).
$pattern = "(?i)avcodec|avformat|avutil|swresample|swscale|av_frame|av_packet|ffmpeg|" +
	"decode|encoder|pcm|opus|aac|dolby|eac3|atmos|soundtouch|rubberband|soxr|resample"

foreach ($name in $targets) {
	$full = Join-Path $AmazonInstallPath $name
	Add-Line ("=== " + $name + " ===")
	if (!(Test-Path -LiteralPath $full)) {
		Add-Line ("MISSING: " + $full)
		Add-Line ""
		continue
	}
	Add-Line ("path: " + $full)
	try {
		$raw = & $dumpbin /exports $full 2>&1 | ForEach-Object { "$_" }
		$hits = $raw | Select-String -Pattern $pattern
		if ($hits) {
			Add-Line "--- matching exports / lines ---"
			foreach ($h in $hits) {
				Add-Line $h.Line.TrimEnd()
			}
		} else {
			Add-Line "(no lines matched filter; module may use only private symbols or delay-load)"
		}
	} catch {
		Add-Line ("dumpbin failed: " + $_.Exception.Message)
	}
	Add-Line ""
}

$lines | Set-Content -Path $outPath -Encoding UTF8
Write-Host "[scan-decode-modules] Wrote $outPath"
