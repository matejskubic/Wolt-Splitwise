#Requires -Version 7.0
Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Stop'

<#
.SYNOPSIS
Packages the built extension into a ZIP archive.

.DESCRIPTION
Zips the contents of the dist folder into artifacts/wolt-splitwise-<version>.zip,
ready for upload to the Edge Add-ons / Chrome Web Store or for sideloading.

.PARAMETER DistPath
Folder containing the built extension (must contain manifest.json).

.PARAMETER OutputPath
Folder where the ZIP archive is written.

.EXAMPLE
./scripts/package.ps1
#>
function Compress-Extension {
    [CmdletBinding()]
    param(
        # Folder containing the built extension.
        [Parameter()]
        [string]
        $DistPath = (Join-Path $PSScriptRoot '..' 'dist'),

        # Folder where the ZIP archive is written.
        [Parameter()]
        [string]
        $OutputPath = (Join-Path $PSScriptRoot '..' 'artifacts')
    )

    $manifestPath = Join-Path $DistPath 'manifest.json'
    if (-not (Test-Path $manifestPath)) {
        throw "Missing $manifestPath. Run 'pnpm build' first."
    }

    $version = (Get-Content $manifestPath -Raw | ConvertFrom-Json).version
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
    $zipPath = Join-Path $OutputPath "wolt-splitwise-$version.zip"
    Compress-Archive -Path (Join-Path $DistPath '*') -DestinationPath $zipPath -Force
    Write-Output (Resolve-Path $zipPath).Path
}

Compress-Extension @args
