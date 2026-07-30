Write-Host "Checking PostgreSQL..."

$postgres = Get-Process postgres -ErrorAction SilentlyContinue

if (-not $postgres) {
    Write-Host "Starting PostgreSQL..."

    & "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" start `
    -D "C:\Program Files\PostgreSQL\18\data"

    Start-Sleep -Seconds 5
}
else {
    Write-Host "PostgreSQL already running."
}

Write-Host "Starting API Gateway..."

Set-Location "$PSScriptRoot\..\apps\api-gateway"

pnpm start:dev