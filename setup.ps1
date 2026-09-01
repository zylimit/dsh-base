# deepseek-base installer (Windows wrapper, PowerShell 5.1 compatible, ASCII only).
#
#   pwsh -File setup.ps1 -Target <dir> [-DryRun] [-Enable] [-Hooks] [-Verify]
#   pwsh -File setup.ps1 <dir> <dir> ... -Verify
#
# The installation logic lives in scripts/install.mjs so there is exactly one
# implementation to maintain. This wrapper only locates it and checks for node.

[CmdletBinding()]
param(
  [string]$Target,
  [switch]$DryRun,
  [switch]$Enable,
  [switch]$Hooks,
  [switch]$Verify,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error 'setup: node 20 or later is required and was not found on PATH'
  exit 2
}

$argv = New-Object System.Collections.Generic.List[string]
if ($Target) { $argv.Add($Target) }
if ($Rest) { foreach ($r in $Rest) { $argv.Add($r) } }
if ($DryRun) { $argv.Add('--dry-run') }
if ($Enable) { $argv.Add('--enable') }
if ($Hooks)  { $argv.Add('--hooks') }
if ($Verify) { $argv.Add('--verify') }

$installer = Join-Path $PSScriptRoot 'scripts/install.mjs'
& node $installer @argv
exit $LASTEXITCODE
