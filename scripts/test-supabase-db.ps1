# Test Postgres connection using SUPABASE_DB_URL from project .env
# Add one line to .env (gitignored):
#   SUPABASE_DB_URL=postgresql://postgres.YOUR_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres

$ErrorActionPreference = "Stop"
$envPath = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path -LiteralPath $envPath)) { Write-Error "Missing .env" }
$uri = $null
Get-Content -LiteralPath $envPath | ForEach-Object {
  $line = $_.Trim()
  if ($line -match '^\s*SUPABASE_DB_URL\s*=\s*(.+)\s*$') {
    $uri = $Matches[1].Trim().Trim('"').Trim("'")
  }
}
if (-not $uri) { Write-Error "Add SUPABASE_DB_URL=... to .env (Session pooler URI from Supabase Connect)." }

$psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
if (-not (Test-Path $psql)) { $psql = "psql.exe" }
& $psql $uri -c "select current_database() as db, current_user as role, version() as pg_version;"
