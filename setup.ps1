# deepseek-base installer (Windows PowerShell 5.1 compatible, ASCII only).
#
#   pwsh -File setup.ps1 -Target <target-repo-dir> [-DryRun]
#
# Copies the managed surface into the target repository. A project-owned file that
# already exists is never overwritten; a managed file that differs is written beside
# the original as <file>.deepseek-base-new, so the change is reviewed rather than
# applied silently.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$src = (Resolve-Path -LiteralPath $PSScriptRoot).Path
if (-not (Test-Path -LiteralPath $Target)) {
  Write-Error "setup: target directory does not exist: $Target"
  exit 2
}
$dst = (Resolve-Path -LiteralPath $Target).Path
if ($src -eq $dst) {
  Write-Error 'setup: refusing to install into the scaffold itself'
  exit 2
}

$copied = 0; $unchanged = 0; $staged = 0; $kept = 0

function Copy-Managed([string]$rel) {
  $from = Join-Path $src $rel
  $to = Join-Path $dst $rel
  if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { return }
  $dir = Split-Path -Parent $to
  if (-not (Test-Path -LiteralPath $dir)) {
    if (-not $DryRun) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  }
  if (-not (Test-Path -LiteralPath $to)) {
    if (-not $DryRun) { Copy-Item -LiteralPath $from -Destination $to -Force }
    $script:copied++
    return
  }
  $a = (Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash
  $b = (Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash
  if ($a -eq $b) { $script:unchanged++; return }
  if (-not $DryRun) { Copy-Item -LiteralPath $from -Destination ($to + '.deepseek-base-new') -Force }
  Write-Host ('  differs, staged for review: ' + $rel + '.deepseek-base-new')
  $script:staged++
}

function Copy-Once([string]$rel) {
  if (Test-Path -LiteralPath (Join-Path $dst $rel)) {
    Write-Host ('  kept project file: ' + $rel)
    $script:kept++
    return
  }
  Copy-Managed $rel
}

Write-Host ('deepseek-base: installing into ' + $dst)

$skip = @('.dsh/base/state/', '.dsh/base/evidence/', '.dsh/base/receipts/', '.dsh/base/waivers/')
foreach ($rootDir in @('.dsh', 'docs', 'scripts')) {
  $full = Join-Path $src $rootDir
  if (-not (Test-Path -LiteralPath $full)) { continue }
  Get-ChildItem -LiteralPath $full -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($src.Length + 1).Replace('\', '/')
    if ($rel -eq '.dsh/base/catalog.json') { return }
    foreach ($s in $skip) { if ($rel.StartsWith($s)) { return } }
    Copy-Managed $rel
  }
}

foreach ($rel in @('AGENTS.md', 'progress.md', '.editorconfig', '.gitattributes', 'cordis.patch.yml')) {
  Copy-Once $rel
}

if (-not (Test-Path -LiteralPath (Join-Path $dst '.dsh/base/catalog.json'))) {
  Write-Host '  governance stays OFF until you copy catalog.example.json to catalog.json'
}

Write-Host ''
$verb = if ($DryRun) { 'would copy' } else { 'copied' }
Write-Host ($verb + ' ' + $copied + ', unchanged ' + $unchanged + ', staged for review ' + $staged + ', kept ' + $kept)
if ($DryRun) { Write-Host 'DRY RUN: nothing was written.' }
Write-Host ''
Write-Host 'Next:'
Write-Host ('  cd ' + $dst)
Write-Host '  git config core.hooksPath .dsh/base/githooks'
Write-Host '  cp .dsh/base/catalog.example.json .dsh/base/catalog.json    # then edit it'
Write-Host '  node .dsh/base/dsb.mjs doctor'
Write-Host '  node .dsh/base/dsb.mjs catalog-lint'
