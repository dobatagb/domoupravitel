<#
  Пълно копие на Supabase (PostgreSQL) с pg_dump в тази папка.
  Не пази паролата във файла.

  1) Задай паролата заедно с пускането:
     $env:PGPASSWORD = "твоята-db-парола-от-Settings-Database"
     .\\backup-supabase.ps1

  2) Промени $SupabaseUser / $SupabaseHost при друг проект или direct connection.
#>

param(
  [string] $OutputDir = $PSScriptRoot,
  [string] $SupabaseHost = "aws-0-eu-west-1.pooler.supabase.com",
  [int] $Port = 5432,
  [string] $SupabaseUser = "postgres.byohsuhwlqshbarfwdny",
  [string] $Database = "postgres"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  Write-Error "Не е намерен ""pg_dump"". Инсталирай PostgreSQL client tools и го сложи в PATH."
  exit 1
}

if ([string]::IsNullOrEmpty($env:PGPASSWORD)) {
  Write-Host "Задай паролата за database (Settings → Database), после стартирай пак:" -ForegroundColor Yellow
  Write-Host '  $env:PGPASSWORD = "A!informatika1"' -ForegroundColor Gray
  Write-Host '  .\backup-supabase.ps1' -ForegroundColor Gray
  exit 1
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outFile = Join-Path $OutputDir "supabase-$stamp.dump"

$env:PGSSLMODE = "require"
try {
  & pg_dump -h $SupabaseHost -p $Port -U $SupabaseUser -d $Database -F c -f $outFile -v
} finally {
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
  if ($env:PGPASSWORD) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}

if ($LASTEXITCODE -ne 0) {
  if (Test-Path $outFile) { Remove-Item $outFile -Force -ErrorAction SilentlyContinue }
  exit $LASTEXITCODE
}

Write-Host "Бекъп: $outFile" -ForegroundColor Green
