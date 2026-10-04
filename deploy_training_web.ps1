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
$VersionMetadataPath = Join-Path $ProjectDir ".deployment-version.json"
$VersionMetadataCreated = $false

try {
    if (-not (Test-Path (Join-Path $ProjectDir "app.py"))) {
        throw "Run this script from the training-web repository root."
    }

    Write-Host ""
    Write-Host "Packaging training-web..." -ForegroundColor Cyan

    Push-Location $ProjectDir
    try {
        $workingTree = @(git.exe status --porcelain)
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to inspect Git working tree."
        }
        if ($workingTree.Count -gt 0) {
            throw "Deployment requires a clean Git working tree."
        }

        $assetVersion = (git.exe rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0 -or $assetVersion -notmatch '^[0-9a-f]{40}$') {
            throw "Unable to determine the deployed Git revision."
        }
        $upstreamVersion = (git.exe rev-parse --verify '@{u}').Trim()
        if ($LASTEXITCODE -ne 0 -or $upstreamVersion -ne $assetVersion) {
            throw "Deployment requires HEAD to equal its configured upstream revision."
        }
        if (Test-Path $VersionMetadataPath) {
            throw "Deployment metadata path already exists: $VersionMetadataPath"
        }

        $metadata = @{ asset_version = $assetVersion } | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText(
            $VersionMetadataPath,
            $metadata,
            [System.Text.UTF8Encoding]::new($false)
        )
        $VersionMetadataCreated = $true
        Write-Host "Deploying asset version $assetVersion" -ForegroundColor DarkCyan
    }
    finally {
        Pop-Location
    }

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
            --exclude="*.db" `
            --exclude="*.sqlite" `
            --exclude="*.sqlite3" `
            --exclude="*.tar" `
            --exclude="*.tar.gz" `
            --exclude="*.zip" `
            --exclude="tmp" `
            --exclude="tests" `
            --exclude="AI_DEV_GUIDE.md" `
            --exclude="README.md" `
            --exclude="deploy_to_server_from_mac.sh" `
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
    if ($VersionMetadataCreated -and (Test-Path $VersionMetadataPath)) {
        Remove-Item $VersionMetadataPath -Force
    }
}