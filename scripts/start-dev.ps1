# This is the advanced/manual native-Postgres workflow (see docs/infrastructure/docker.md) — the
# canonical local workflow is Docker Compose, which already builds and runs api-gateway itself
# (infrastructure/docker/docker-compose.yml). Running `pnpm start:dev` below while that container
# also holds :3000 is exactly the EADDRINUSE incident this repo has already hit once — see
# ../frontend/tools/dev/DEVELOPMENT.md for the full incident writeup. Guard against it explicitly
# rather than relying on every future reader to remember not to run both at once.
$portInUse = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "[ERROR] Port 3000 is already in use (PID $($portInUse[0].OwningProcess))." -ForegroundColor Red
    Write-Host "If that's the Docker Compose api-gateway container, use it instead of this script:" -ForegroundColor Yellow
    Write-Host "  docker compose -f infrastructure/docker/docker-compose.yml ps" -ForegroundColor Yellow
    exit 1
}

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