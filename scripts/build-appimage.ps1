# Builds the Linux AppImage from Windows.
#
# AppImage's internal layout uses Unix symlinks, which Windows refuses to create
# for an unprivileged process — the build fails with:
#
#   EPERM: operation not permitted, symlink '.../chess-trainer.png'
#
# Running elevated grants that permission, so this script exists to be launched
# with `-Verb RunAs`. Everything it does is the ordinary `npm run dist:linux`;
# the elevation is only there for the symlinks.
#
# All output is tee'd to a log so the run can be followed from outside the
# elevated window, which is otherwise opaque to anything that did not spawn it.

$ErrorActionPreference = 'Continue'

$project = 'C:\Users\Greg\Projects\chess-trainer'
$log = Join-Path $env:TEMP 'chess-trainer-appimage.log'

Set-Location $project

"=== AppImage build started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" |
    Out-File -FilePath $log -Encoding utf8

# Confirm elevation actually took effect before spending ten minutes on a build
# that will fail at the last step.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
"elevated=$elevated" | Out-File -FilePath $log -Append -Encoding utf8

if (-not $elevated) {
    "ABORT: not running elevated; symlink creation would fail" |
        Out-File -FilePath $log -Append -Encoding utf8
    "DONE exit=1" | Out-File -FilePath $log -Append -Encoding utf8
    exit 1
}

npm run dist:linux 2>&1 | Tee-Object -FilePath $log -Append

$code = $LASTEXITCODE
"DONE exit=$code $(Get-Date -Format 'HH:mm:ss')" |
    Out-File -FilePath $log -Append -Encoding utf8

exit $code
