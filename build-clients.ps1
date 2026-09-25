# Build the OVL For Business apps on Windows: the web client and admin panel (static files), and the
# Windows and Android apps.
#
#   build-clients.cmd                    double-click, or run it in a terminal (asks what to build)
#   .\build-clients.ps1 --help           options for unattended builds
#
# Needs Node.js 22.12 or newer; without it, Node.js is downloaded into %USERPROFILE%\.ovl\node first
# (nothing is installed system-wide). The builder itself is scripts\build-clients.mjs.
$ErrorActionPreference = 'Stop'
# Invoke-WebRequest is many times faster without its progress bar.
$ProgressPreference = 'SilentlyContinue'

function Test-Node([string]$exe) {
  if (-not $exe -or -not (Test-Path $exe)) { return $false }
  $version = & $exe -p 'process.versions.node' 2>$null
  if (-not $version) { return $false }
  $parts = $version.Trim().Split('.')
  return ([int]$parts[0] -gt 22) -or ([int]$parts[0] -eq 22 -and [int]$parts[1] -ge 12)
}

$ownNode = Join-Path $env:USERPROFILE '.ovl\node'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source

if (-not (Test-Node $node)) {
  $node = Join-Path $ownNode 'node.exe'
  if (-not (Test-Node $node)) {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $base = 'https://nodejs.org/dist/latest-v22.x'
    Write-Host "Node.js 22 or newer is needed; downloading it into $ownNode (only for this builder)..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $sums = [Text.Encoding]::UTF8.GetString((Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").RawContentStream.ToArray())
    $line = $sums -split "`n" | Where-Object { $_ -match "node-v[\d.]+-win-$arch\.zip\s*$" } | Select-Object -First 1
    if (-not $line) { throw "No Node.js download was found for win-$arch." }
    $sum, $file = $line.Trim() -split '\s+'
    $tmp = Join-Path $env:TEMP "ovl-node-$([guid]::NewGuid())"
    New-Item -ItemType Directory $tmp | Out-Null
    try {
      $zip = Join-Path $tmp $file
      Invoke-WebRequest -UseBasicParsing "$base/$file" -OutFile $zip
      if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $sum) { throw 'The Node.js download is damaged; please run this again.' }
      Expand-Archive $zip -DestinationPath $tmp
      if (Test-Path $ownNode) { Remove-Item $ownNode -Recurse -Force }
      New-Item -ItemType Directory -Force (Split-Path $ownNode) | Out-Null
      Move-Item (Join-Path $tmp ($file -replace '\.zip$', '')) $ownNode
    } finally {
      Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  # pnpm (through corepack) and npx come with this Node.js.
  $env:PATH = "$ownNode;$env:PATH"
}

& $node (Join-Path $PSScriptRoot 'scripts\build-clients.mjs') @args
exit $LASTEXITCODE
