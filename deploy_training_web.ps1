param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$Server = "harrisserver"
$ServerWebDir = "/opt/training/web"
$ProjectDir = $PSScriptRoot
$ArchiveName = "training-web-deploy.tar.gz"
$LocalArchive = Join-Path $env:TEMP $ArchiveName
$RemoteArchive = "/tmp/$ArchiveName"

try {
    if (-not (Test-Path (Join-Path $ProjectDir "app.py"))) {
        throw "Run this script from the training-web repository root."
    }

    Write-Host ""
    Write-Host "Packaging training-web..." -ForegroundColor Cyan
    Write-Host "Uncommitted changes are included." -ForegroundColor Yellow

    if (Test-Path $LocalArchive) {
        Remove-Item $LocalArchive -Force
    }

    Push-Location $ProjectDir

    try {
        tar.exe -czf $LocalArchive `
            --exclude=".git" `
            --exclude=".gitignore" `
            --exclude=".github" `
            --exclude=".vscode" `
            --exclude=".env" `
            --exclude=".env.*" `
            --exclude=".venv" `
            --exclude="venv" `
            --exclude="env" `
            --exclude="__pycache__" `
            --exclude="*.pyc" `
            --exclude=".DS_Store" `
            --exclude="tests" `
            --exclude="AI_DEV_GUIDE.md" `
            --exclude="FRONTEND_REFACTOR_HANDOFF.md" `
            --exclude="README.md" `
            --exclude="deploy_to_nas_from_mac.sh" `
            --exclude="deploy_to_server_from_mac.sh" `
            --exclude="deploy_to_server.sh" `
            --exclude="deploy_to_server.ps1" `
            --exclude="deploy_training_web.ps1" `
            .
        if ($LASTEXITCODE -ne 0) {
            throw "Archive creation failed."
        }
    }
    finally {
        Pop-Location
    }

    if ($DryRun) {
        Write-Host ""
        Write-Host "Dry run complete. Archive contents:" -ForegroundColor Green
        tar.exe -tzf $LocalArchive
        Write-Host ""
        Write-Host "No files were uploaded or changed."
        exit 0
    }

    Write-Host "Uploading archive..."

    scp.exe -o BatchMode=yes `
        $LocalArchive `
        "${Server}:${RemoteArchive}"

    if ($LASTEXITCODE -ne 0) {
        throw "Archive upload failed."
    }

    Write-Host "Extracting files on harrisserver..."

    ssh.exe -o BatchMode=yes $Server `
        "set -e; test -d '$ServerWebDir'; tar -xzf '$RemoteArchive' -C '$ServerWebDir'; rm -f '$RemoteArchive'; test -f '$ServerWebDir/app.py'; echo 'Deployment complete.'"

    if ($LASTEXITCODE -ne 0) {
        throw "Server deployment failed."
    }

    Write-Host ""
    Write-Host "Training-web deployed successfully." -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "Deployment failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    if (Test-Path $LocalArchive) {
        Remove-Item $LocalArchive -Force
    }
}