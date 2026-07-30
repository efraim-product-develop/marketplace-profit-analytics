param(
  [string]$EnvPath = ".env"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $EnvPath)) {
  throw "Could not find $EnvPath. Run this from the project folder."
}

$content = Get-Content -Raw $EnvPath
$match = [regex]::Match($content, '(?m)^DATABASE_URL=(["'']?)(?<url>.+?)\1\s*$')

if (!$match.Success) {
  throw "DATABASE_URL was not found in $EnvPath."
}

$databaseUrl = $match.Groups["url"].Value.Trim()
$uri = [Uri]$databaseUrl

if ($uri.Host -notlike "*.pooler.supabase.com") {
  throw "DATABASE_URL does not look like a Supabase pooler URL. Add DIRECT_URL manually from Supabase Database settings."
}

$userInfoParts = $uri.UserInfo -split ":", 2
$pooledUsername = $userInfoParts[0]
$encodedPassword = if ($userInfoParts.Length -gt 1) { $userInfoParts[1] } else { "" }

if (!$pooledUsername -or !$encodedPassword) {
  throw "DATABASE_URL must include a username and password."
}

$projectRef = ""
$directUsername = $pooledUsername

if ($pooledUsername -match "^postgres\.(?<ref>.+)$") {
  $projectRef = $Matches["ref"]
  $directUsername = "postgres"
} elseif ($uri.Host -match "^(?<ref>[a-z0-9]+)\.supabase\.co$") {
  $projectRef = $Matches["ref"]
}

if (!$projectRef) {
  throw "Could not determine the Supabase project reference. Add DIRECT_URL manually from Supabase Database settings."
}

$directUrl = "$($uri.Scheme)://$directUsername`:$encodedPassword@db.$projectRef.supabase.co:5432$($uri.AbsolutePath)?sslmode=require"

if ([regex]::IsMatch($content, '(?m)^DIRECT_URL=')) {
  $newContent = [regex]::Replace(
    $content,
    '(?m)^DIRECT_URL=(["'']?).+?\1\s*$',
    "DIRECT_URL=`"$directUrl`""
  )
} else {
  $newContent = $content.TrimEnd() + "`r`nDIRECT_URL=`"$directUrl`"`r`n"
}

Set-Content -Path $EnvPath -Value $newContent -NoNewline
Write-Host "Updated DIRECT_URL in $EnvPath without printing it."
