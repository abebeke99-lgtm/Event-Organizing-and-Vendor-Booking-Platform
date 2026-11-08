param(
  [string]$RenderUrl = 'https://event-organizing-and-vendor-booking.onrender.com',
  [string]$NetlifyUrl = 'https://infobekele.netlify.app'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$expectedCommit = (git -C $repositoryRoot rev-parse HEAD).Trim()
$renderOrigin = $RenderUrl.TrimEnd('/')
$netlifyOrigin = $NetlifyUrl.TrimEnd('/')
$checks = @(
  @{ Name = 'Render /'; Url = "$renderOrigin/" },
  @{ Name = 'Render /api/health'; Url = "$renderOrigin/api/health"; Origin = $netlifyOrigin },
  @{ Name = 'Render /api/version'; Url = "$renderOrigin/api/version" },
  @{ Name = 'Render /api/platform/me'; Url = "$renderOrigin/api/platform/me"; Origin = $netlifyOrigin },
  @{ Name = 'Netlify /'; Url = "$netlifyOrigin/" },
  @{ Name = 'Netlify /register'; Url = "$netlifyOrigin/register" },
  @{ Name = 'Netlify /login'; Url = "$netlifyOrigin/login" },
  @{ Name = 'Netlify /dashboard'; Url = "$netlifyOrigin/dashboard" }
)
$results = @{}
$versionBody = $null
$databaseReady = $false
$corsReady = $false

foreach ($check in $checks) {
  $response = $null
  try {
    $requestHeaders = @{}
    if ($check.Origin) { $requestHeaders.Origin = $check.Origin }
    $response = Invoke-WebRequest -Uri $check.Url -Method Get -Headers $requestHeaders -TimeoutSec 30 -UseBasicParsing
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
  if ($check.Name -eq 'Render /api/health' -and $body) {
    try {
      $health = ConvertFrom-Json $body
      $databaseReady = $health.db -eq $true
      $corsReady = $response.Headers['Access-Control-Allow-Origin'] -eq $check.Origin `
        -and $response.Headers['Access-Control-Allow-Credentials'] -eq 'true'
      Write-Output ("Render database: {0}" -f $(if ($databaseReady) { 'connected' } else { "unavailable ($($health.reason))" }))
      Write-Output ("Render credentialed CORS for Netlify: {0}" -f $(if ($corsReady) { 'enabled' } else { 'not verified' }))
    } catch {
      Write-Output ("Render health response: unavailable or invalid JSON (HTTP {0})" -f $statusCode)
    }
  }
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
if (!$databaseReady -or !$corsReady) { $failed = $true }
if ($failed) { exit 1 }
