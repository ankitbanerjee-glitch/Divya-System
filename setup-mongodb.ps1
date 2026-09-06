$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

Write-Host ''
Write-Host 'DIVYA SYSTEM - MongoDB Atlas Setup' -ForegroundColor Cyan
Write-Host 'Your passwords stay on this computer and are not displayed.' -ForegroundColor DarkGray
Write-Host ''

$securePassword = Read-Host 'Enter the password you created for divya_app' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$adminUser = Read-Host 'Choose the DIVYA admin username'
$secureAdminPassword = Read-Host 'Choose a strong DIVYA admin password' -AsSecureString
$adminPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureAdminPassword)
$monitorUser = Read-Host 'Choose the DIVYA monitoring-user username'
$secureMonitorPassword = Read-Host 'Choose a strong DIVYA monitoring-user password' -AsSecureString
$monitorPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureMonitorPassword)

try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $plainAdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPasswordPointer)
  $plainMonitorPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($monitorPasswordPointer)
  if ([string]::IsNullOrWhiteSpace($plainPassword) -or
      [string]::IsNullOrWhiteSpace($adminUser) -or
      [string]::IsNullOrWhiteSpace($plainAdminPassword) -or
      [string]::IsNullOrWhiteSpace($monitorUser) -or
      [string]::IsNullOrWhiteSpace($plainMonitorPassword)) {
    throw 'MongoDB and DIVYA login values cannot be empty.'
  }
  $encodedPassword = [Uri]::EscapeDataString($plainPassword)
  $environmentFile = @(
    'PORT=3000'
    "MONGODB_URI=mongodb+srv://divya_app:$encodedPassword@cluster0.06eyh9a.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
    'MONGODB_DB=divya_system'
    "DIVYA_ADMIN_USER=$adminUser"
    "DIVYA_ADMIN_PASSWORD=$plainAdminPassword"
    "DIVYA_USER_USER=$monitorUser"
    "DIVYA_USER_PASSWORD=$plainMonitorPassword"
  )
  Set-Content -Path (Join-Path $projectRoot '.env') -Value $environmentFile -Encoding UTF8
}
finally {
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  if ($adminPasswordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPasswordPointer)
  }
  if ($monitorPasswordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($monitorPasswordPointer)
  }
  $plainPassword = $null
  $plainAdminPassword = $null
  $plainMonitorPassword = $null
  $encodedPassword = $null
}

Write-Host ''
Write-Host 'Private MongoDB configuration created.' -ForegroundColor Green
Write-Host 'Installing required packages and starting DIVYA...' -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
npm start
