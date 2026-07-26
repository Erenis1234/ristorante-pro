$ErrorActionPreference = 'Stop'

$desktopPath = [Environment]::GetFolderPath('Desktop')
$targetPath = Join-Path $PSScriptRoot '..\dist\win-unpacked\Ristorante Pro.exe'
$shortcutPath = Join-Path $desktopPath 'Ristorante Pro.lnk'

if (-not (Test-Path $targetPath)) {
    Write-Error "Executable non trovato: $targetPath"
    exit 1
}

$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = Split-Path $targetPath -Parent
$shortcut.IconLocation = "$targetPath,0"
$shortcut.Description = 'Ristorante Pro'
$shortcut.Save()

Write-Host "Shortcut creato su desktop: $shortcutPath"
