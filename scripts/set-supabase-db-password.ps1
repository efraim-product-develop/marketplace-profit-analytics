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

$url = $match.Groups["url"].Value.Trim()
$uri = [Uri]$url
$userInfoParts = $uri.UserInfo -split ":", 2
$username = $userInfoParts[0]

if (!$username) {
  throw "DATABASE_URL does not include a database username."
}

$securePassword = Read-Host "Supabase database password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $encodedPassword = [Uri]::EscapeDataString($plainPassword)
  $port = if ($uri.Port -gt 0) { ":$($uri.Port)" } else { "" }
  $query = if ($uri.Query) { $uri.Query } else { "" }
  $newUrl = "$($uri.Scheme)://$username`:$encodedPassword@$($uri.Host)$port$($uri.AbsolutePath)$query"
  $newContent = [regex]::Replace(
    $content,
    '(?m)^DATABASE_URL=(["'']?).+?\1\s*$',
    "DATABASE_URL=`"$newUrl`""
  )

  Set-Content -Path $EnvPath -Value $newContent -NoNewline
  Write-Host "Updated DATABASE_URL password in $EnvPath without printing it."
} finally {
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}
