$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$expectedCommit = (git -C $repositoryRoot rev-parse HEAD).Trim()
$checks = @(
  @{ Name = 'Render /'; Url = 'https://event-organizing-and-vendor-booking.onrender.com/' },
  @{ Name = 'Render /api/health'; Url = 'https://event-organizing-and-vendor-booking.onrender.com/api/health' },
  @{ Name = 'Render /api/version'; Url = 'https://event-organizing-and-vendor-booking.onrender.com/api/version' },
  @{ Name = 'Netlify /'; Url = 'https://infobekele.netlify.app/' },
  @{ Name = 'Netlify /register'; Url = 'https://infobekele.netlify.app/register' },
  @{ Name = 'Netlify /login'; Url = 'https://infobekele.netlify.app/login' },
  @{ Name = 'Netlify /dashboard'; Url = 'https://infobekele.netlify.app/dashboard' }
)
$results = @{}
$versionBody = $null

foreach ($check in $checks) {
  try {
    $response = Invoke-WebRequest -Uri $check.Url -Method Get -TimeoutSec 30 -UseBasicParsing
    $statusCode = [int]$response.StatusCode
    $body = $response.Content
  } catch {
    $statusCode = 0
    $body = ''
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
    }
  }

  $results[$check.Name] = $statusCode
  Write-Output ("{0}: HTTP {1}" -f $check.Name, $statusCode)
  if ($check.Name -eq 'Render /api/version') {
    $versionBody = $body
  }
}

$deployedCommit = $null
if ($versionBody) {
  try {
    $deployedCommit = (ConvertFrom-Json $versionBody).commit
  } catch {
    Write-Output 'Render deployed commit: response was not valid version JSON'
  }
}
Write-Output ("Local commit: {0}" -f $expectedCommit)
Write-Output ("Render commit: {0}" -f $(if ($deployedCommit) { $deployedCommit } else { 'unavailable' }))

$failed = $false
foreach ($checkName in $results.Keys) {
  if ($results[$checkName] -ne 200) { $failed = $true }
}
if (!$deployedCommit -or $deployedCommit -ne $expectedCommit) { $failed = $true }
if ($failed) { exit 1 }
