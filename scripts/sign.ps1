# Signs one file with the project's code-signing certificate (Azure Artifact Signing). The release build
# hands this to Tauri as its sign command (bundle.windows.signCommand), so Tauri signs the app, the
# uninstaller and the installer at the right moments: each before it is packed into the next, and the
# installer before its update signature is made.
#
# It uses Microsoft's own tools and nothing else: SignTool from the Windows SDK and the Artifact Signing
# client. scripts/signing-setup.ps1 has put them in place and named them in the environment:
#   SIGNTOOL        signtool.exe
#   SIGN_DLIB       Azure.CodeSigning.Dlib.dll
#   SIGN_METADATA   the file that names the signing account and the certificate profile
# The private key never leaves Azure: the file's digest is sent there and the signature comes back.
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = "Stop"
foreach ($name in "SIGNTOOL", "SIGN_DLIB", "SIGN_METADATA") {
  if (-not (Get-Item "env:$name" -ErrorAction SilentlyContinue)) { Write-Error "sign.ps1: $name is not set; run scripts/signing-setup.ps1 first."; exit 1 }
}
# The time stamp is what keeps the signature good after the certificate itself has run out (it is valid for three days).
& $env:SIGNTOOL sign /fd SHA256 /tr "http://timestamp.acs.microsoft.com" /td SHA256 /dlib $env:SIGN_DLIB /dmdf $env:SIGN_METADATA $File
if ($LASTEXITCODE -ne 0) { Write-Error "sign.ps1: signing $File failed (SignTool answered $LASTEXITCODE)."; exit 1 }
