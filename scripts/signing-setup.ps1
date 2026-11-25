# Puts in place what scripts/sign.ps1 needs, on the build machine, and proves it works before the long
# build starts: Microsoft's Artifact Signing client (a fixed version, checked against its checksum),
# SignTool from the Windows SDK, and the small file that names the signing account. Then it signs a
# throwaway copy of a Windows program, so a wrong name or a missing permission shows in the first minute.
#
# Signing in to Azure has happened before this (the azure/login step): the client uses that sign-in.
# From the environment:
#   SIGNING_ENDPOINT   the region's address, e.g. https://eus.codesigning.azure.net
#   SIGNING_ACCOUNT    the Artifact Signing account's name
#   SIGNING_PROFILE    the certificate profile's name
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
foreach ($name in "SIGNING_ENDPOINT", "SIGNING_ACCOUNT", "SIGNING_PROFILE") {
  if (-not (Get-Item "env:$name" -ErrorAction SilentlyContinue).Value) { throw "signing-setup: $name is not set (a variable of the release environment)." }
}
$work = Join-Path $env:RUNNER_TEMP "signing"
New-Item -ItemType Directory -Force $work | Out-Null

# Microsoft's client, by exact version. To move to a newer one: change both lines (the checksum is the
# SHA-256 of the .nupkg file as nuget.org serves it).
$version = "1.0.151"
$sha256 = "35375a4bc4e1102da729fc3d8d9925f774c3baae6b8b7ff6398d948ca9ab0d8a"
$pkg = Join-Path $work "client.zip"
Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.artifactsigning.client/$version/microsoft.artifactsigning.client.$version.nupkg" -OutFile $pkg
$got = (Get-FileHash $pkg -Algorithm SHA256).Hash.ToLower()
if ($got -ne $sha256) { throw "signing-setup: the Artifact Signing client $version has the checksum $got, not the one this script expects." }
Expand-Archive $pkg -DestinationPath (Join-Path $work "client") -Force
$dlib = Join-Path $work "client\bin\x64\Azure.CodeSigning.Dlib.dll"
if (-not (Test-Path $dlib)) { throw "signing-setup: the client package holds no bin\x64\Azure.CodeSigning.Dlib.dll." }

# SignTool: the newest in the Windows SDK. The client needs 10.0.22621.755 or later.
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object { [version]$_.Directory.Parent.Name } -Descending | Select-Object -First 1
if (-not $signtool) { throw "signing-setup: no SignTool was found in the Windows SDK." }
if ([version]$signtool.Directory.Parent.Name -lt [version]"10.0.22621.755") { throw "signing-setup: SignTool $($signtool.Directory.Parent.Name) is older than the client needs (10.0.22621.755)." }
# The client runs on .NET 8.
if (-not ((dotnet --list-runtimes) -match "^Microsoft\.NETCore\.App 8\.")) { throw "signing-setup: the .NET 8 runtime is not on this machine." }

# Which account and certificate to sign with, and how to sign in: only with the Azure sign-in this run has made.
$metadata = Join-Path $work "metadata.json"
@{
  Endpoint = $env:SIGNING_ENDPOINT.TrimEnd("/")
  CodeSigningAccountName = $env:SIGNING_ACCOUNT
  CertificateProfileName = $env:SIGNING_PROFILE
  ExcludeCredentials = @("ManagedIdentityCredential", "WorkloadIdentityCredential", "SharedTokenCacheCredential", "VisualStudioCredential", "VisualStudioCodeCredential", "AzurePowerShellCredential", "AzureDeveloperCliCredential", "InteractiveBrowserCredential")
} | ConvertTo-Json | Set-Content $metadata -Encoding ascii

$env:SIGNTOOL = $signtool.FullName
$env:SIGN_DLIB = $dlib
$env:SIGN_METADATA = $metadata

# The proof: a copy of a small Windows program, signed and checked.
$probe = Join-Path $work "probe.exe"
Copy-Item "$env:SystemRoot\System32\where.exe" $probe
& "$PSScriptRoot\sign.ps1" $probe
if ($LASTEXITCODE -ne 0) { throw "signing-setup: the trial signature failed. Check the three SIGNING_ variables, that the endpoint is the region the account and the profile were made in, and that the app registration has the role 'Artifact Signing Certificate Profile Signer' on the certificate profile." }
# Asked of SignTool, which reads the signature in the file itself (Windows' own check would answer with the
# catalogue signature Microsoft gives its programs, whatever was added to the copy).
$verify = & $env:SIGNTOOL verify /pa /v $probe 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "signing-setup: the trial signature does not verify:`n$verify" }
$publisher = ([regex]::Match($verify, "Issued to:\s*(.+)")).Groups[1].Value.Trim()
Write-Host "Signing works. Publisher on the certificate: $publisher"

# For the build: where the tools are, and the piece of Tauri configuration that makes it sign.
$sign = (Join-Path $PSScriptRoot "sign.ps1")
if ($sign -match "\s") { throw "signing-setup: the path of sign.ps1 has a space in it, which Tauri's sign command cannot carry: $sign" }
$config = Join-Path $work "tauri.sign.json"
@{ bundle = @{ windows = @{ signCommand = "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $sign %1" } } } | ConvertTo-Json -Depth 5 | Set-Content $config -Encoding ascii
"SIGNTOOL=$($signtool.FullName)", "SIGN_DLIB=$dlib", "SIGN_METADATA=$metadata", "SIGN_CONFIG=$config" | Add-Content $env:GITHUB_ENV
