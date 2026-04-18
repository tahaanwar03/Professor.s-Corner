$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add('http://127.0.0.1:8020/')
$listener.Start()

Write-Host "Serving $root on http://127.0.0.1:8020/"

function Get-ContentType([string]$path) {
  switch ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
    '.html' { 'text/html; charset=utf-8' }
    '.css'  { 'text/css; charset=utf-8' }
    '.js'   { 'text/javascript; charset=utf-8' }
    '.png'  { 'image/png' }
    '.jpg'  { 'image/jpeg' }
    '.jpeg' { 'image/jpeg' }
    '.webp' { 'image/webp' }
    '.gif'  { 'image/gif' }
    '.svg'  { 'image/svg+xml' }
    default { 'application/octet-stream' }
  }
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $p = $ctx.Request.Url.LocalPath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($p)) { $p = "Prof_s_Corner_P5.html" }

    $file = Join-Path $root $p
    if (Test-Path $file) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ctx.Response.StatusCode = 200
      $ctx.Response.ContentType = (Get-ContentType $file)
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
  } catch {
    $ctx.Response.StatusCode = 500
  } finally {
    $ctx.Response.Close()
  }
}
