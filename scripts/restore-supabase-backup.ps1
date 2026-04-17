# Restore plain SQL dump to Supabase Postgres via psql.
# Add SUPABASE_DB_URL to project .env (gitignored) or set $env:SUPABASE_DB_URL.
# URI from Supabase: Database - Connect - Session pooler (use postgres.jbfwlszredlpvryzrtkj user).

param(
  [Parameter(Mandatory = $true)]
  [string] $BackupFile,
  [string] $ConnectionUri = $env:SUPABASE_DB_URL
)

$ErrorActionPreference = "Stop"

if (-not $ConnectionUri) {
  $envPath = Join-Path $PSScriptRoot "..\.env"
  if (Test-Path -LiteralPath $envPath) {
    Get-Content -LiteralPath $envPath | ForEach-Object {
      $line = $_.Trim()
      if ($line -match '^\s*SUPABASE_DB_URL\s*=\s*(.+)\s*$') {
        $val = $Matches[1].Trim().Trim('"').Trim("'")
        if ($val) { $ConnectionUri = $val }
      }
    }
  }
}

if (-not $ConnectionUri) {
  Write-Error "Missing SUPABASE_DB_URL. Add to .env one line: SUPABASE_DB_URL=postgresql://postgres.jbfwlszredlpvryzrtkj:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres (from Supabase Connect, Session pooler)."
}

if (-not (Test-Path -LiteralPath $BackupFile)) {
  Write-Error "Backup file not found: $BackupFile"
}

$psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
if (-not (Test-Path $psql)) {
  $psql = "psql.exe"
}

# ON_ERROR_STOP=0: full dumps may hit existing auth/storage objects
& $psql $ConnectionUri -v ON_ERROR_STOP=0 -f $BackupFile

Write-Host "Done. Check output above for FATAL/ERROR lines."
