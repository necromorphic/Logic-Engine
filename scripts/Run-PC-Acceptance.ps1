[CmdletBinding()]
param(
    [string]$LogicEngineRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$OutputRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Checks = New-Object System.Collections.Generic.List[object]
$script:Warnings = New-Object System.Collections.Generic.List[string]
$patchSha256 = $null
$patchTargetEvidence = @()
$vectorEvidence = @()

function Add-Check {
    param([string]$Name, [string]$Status, [string]$Details, [int]$ExitCode = 0)
    $script:Checks.Add([pscustomobject]@{
        name = $Name; status = $Status; details = $Details; exitCode = $ExitCode
    }) | Out-Null
    $color = if ($Status -eq 'PASS') { 'Green' } elseif ($Status -eq 'WARN') { 'Yellow' } else { 'Red' }
    Write-Host ("[{0}] {1}: {2}" -f $Status, $Name, $Details) -ForegroundColor $color
}

function Get-FileSha256 {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Invoke-ExternalCheck {
    param([string]$Name, [string]$Executable, [string[]]$Arguments, [string]$WorkingDirectory)
    Push-Location -LiteralPath $WorkingDirectory
    try {
        $output = @(& $Executable @Arguments 2>&1 | ForEach-Object { [string]$_ })
        $code = $LASTEXITCODE
        if ($null -eq $code) { $code = 0 }
        $detail = ($output -join [Environment]::NewLine).Trim()
        if ($detail.Length -gt 12000) { $detail = $detail.Substring($detail.Length - 12000) }
        if ($code -eq 0) { Add-Check $Name 'PASS' $detail 0 }
        else { Add-Check $Name 'FAIL' $detail ([int]$code) }
        return [int]$code
    }
    finally { Pop-Location }
}

function Find-CandidateRoots {
    param([string[]]$Roots, [int]$MaxDepth = 5)
    $found = New-Object System.Collections.Generic.List[string]
    $skip = @('node_modules', '.git', 'AppData', 'Windows', 'Program Files', 'Program Files (x86)', '$Recycle.Bin')
    foreach ($root in ($Roots | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        $queue = New-Object System.Collections.Generic.Queue[object]
        $queue.Enqueue([pscustomobject]@{ Path = (Resolve-Path -LiteralPath $root).Path; Depth = 0 })
        while ($queue.Count -gt 0) {
            $item = $queue.Dequeue()
            if (Test-Path -LiteralPath (Join-Path $item.Path 'package.json') -PathType Leaf) {
                $found.Add($item.Path) | Out-Null
            }
            if ($item.Depth -ge $MaxDepth) { continue }
            try {
                foreach ($dir in Get-ChildItem -LiteralPath $item.Path -Directory -Force -ErrorAction Stop) {
                    if (($skip -contains $dir.Name) -or ($dir.Name -match '(?i)backup|archive|old-copy|worktree-backup')) { continue }
                    $queue.Enqueue([pscustomobject]@{ Path = $dir.FullName; Depth = $item.Depth + 1 })
                }
            } catch { }
        }
    }
    return @($found.ToArray() | Select-Object -Unique)
}

function Read-Package {
    param([string]$Root)
    try { return (Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json) }
    catch { return $null }
}

function Find-Archive {
    param([string[]]$Roots, [string]$Pattern)
    foreach ($root in ($Roots | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        try {
            $files = Get-ChildItem -LiteralPath $root -Filter '*.zip' -File -ErrorAction SilentlyContinue
            $match = $files | Where-Object { $_.Name -match $Pattern } | Select-Object -First 1
            if ($match) { return $match.FullName }
        } catch { }
    }
    return $null
}

$started = [datetime]::UtcNow
$repoRoot = (Resolve-Path -LiteralPath $LogicEngineRoot).Path
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repoRoot 'artifacts\pc-acceptance'
}
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
$runId = [datetime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$runRoot = Join-Path $OutputRoot $runId
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
$transcriptPath = Join-Path $runRoot 'console.log'
Start-Transcript -LiteralPath $transcriptPath -Force | Out-Null

try {
    Write-Host 'Logic Engine / SillyTavern PC acceptance run'
    Write-Host "Repository: $repoRoot"
    Write-Host "Evidence:   $runRoot"

    $packagePath = Join-Path $repoRoot 'package.json'
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
        throw "LOGIC_ENGINE_PACKAGE_JSON_NOT_FOUND: $packagePath"
    }
    $enginePackage = Read-Package $repoRoot
    if (-not $enginePackage) { throw 'LOGIC_ENGINE_PACKAGE_JSON_INVALID' }
    Add-Check 'Logic Engine repository' 'PASS' ("{0} {1}" -f $enginePackage.name, $enginePackage.version)

    $node = Get-Command node -ErrorAction SilentlyContinue
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $node) { Add-Check 'Node.js availability' 'FAIL' 'node.exe was not found on PATH.' 1 }
    else {
        $nodeVersion = (& node --version 2>&1 | Out-String).Trim()
        if ($nodeVersion -match '^v(\d+)\.(\d+)\.(\d+)') {
            $major = [int]$Matches[1]; $minor = [int]$Matches[2]
            if ($major -gt 22 -or ($major -eq 22 -and $minor -ge 13)) {
                Add-Check 'Node.js version' 'PASS' $nodeVersion
            } else { Add-Check 'Node.js version' 'FAIL' "Found $nodeVersion; Logic Engine requires >=22.13.0." 1 }
        } else { Add-Check 'Node.js version' 'FAIL' "Could not parse: $nodeVersion" 1 }
    }
    if (-not $npm) { Add-Check 'npm availability' 'FAIL' 'npm was not found on PATH.' 1 }
    else { Add-Check 'npm availability' 'PASS' $npm.Source }
    if (-not $git) { Add-Check 'Git availability' 'FAIL' 'git was not found on PATH; patch applicability cannot be checked.' 1 }
    else { Add-Check 'Git availability' 'PASS' $git.Source }

    $engineTests = 1
    if ($npm -and $node) {
        $engineTests = Invoke-ExternalCheck 'Logic Engine test suite' 'npm' @('test') $repoRoot
    }

    $prototypeTestsPath = Join-Path $repoRoot 'host-adapter\prototype\tests'
    if (Test-Path -LiteralPath $prototypeTestsPath -PathType Container) {
        $prototypeTests = @(Get-ChildItem -LiteralPath $prototypeTestsPath -Filter '*.test.mjs' -File)
        if ($prototypeTests.Count -gt 0 -and $node) {
            $testArgs = @('--test') + @($prototypeTests | ForEach-Object { $_.FullName })
            [void](Invoke-ExternalCheck 'Host adapter prototype tests' 'node' $testArgs $repoRoot)
        } else {
            Add-Check 'Host adapter prototype tests' 'WARN' 'No *.test.mjs files found.'
        }
    } else { Add-Check 'Host adapter prototype tests' 'WARN' 'Prototype test directory not present in this checkout.' }

    $searchRoots = @(
        (Split-Path -Parent $repoRoot),
        'C:\LogicEngine',
        (Join-Path $HOME 'Downloads'),
        (Join-Path $HOME 'Desktop'),
        (Join-Path $HOME 'Documents')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique

    Write-Host 'Discovering local SillyTavern and ST-VectorService installations...'
    $packageRoots = @(Find-CandidateRoots -Roots $searchRoots -MaxDepth 5)
    $stCandidates = New-Object System.Collections.Generic.List[object]
    $vectorCandidates = New-Object System.Collections.Generic.List[object]
    foreach ($candidateRoot in $packageRoots) {
        $pkg = Read-Package $candidateRoot
        if (-not $pkg) { continue }
        $isSt = (($pkg.name -match 'silly.?tavern') -or
            (($pkg.version -eq '1.19.0') -and (Test-Path -LiteralPath (Join-Path $candidateRoot 'src\plugin-loader.js') -PathType Leaf)))
        if ($isSt) {
            $stCandidates.Add([pscustomobject]@{ Root = $candidateRoot; Version = [string]$pkg.version; Name = [string]$pkg.name }) | Out-Null
        }
        $isVector = (($pkg.name -match 'vector') -or
            ((Split-Path -Leaf $candidateRoot) -match 'ST-VectorService|VectorService') -or
            ((Test-Path -LiteralPath (Join-Path $candidateRoot 'vector_storage') -PathType Container) -and
             (Test-Path -LiteralPath (Join-Path $candidateRoot 'server.js') -PathType Leaf)))
        if ($isVector) {
            $vectorCandidates.Add([pscustomobject]@{ Root = $candidateRoot; Version = [string]$pkg.version; Name = [string]$pkg.name }) | Out-Null
        }
    }

    if ($vectorCandidates.Count -eq 0) {
        $vectorZip = Find-Archive -Roots $searchRoots -Pattern '^(ST[-_])?VectorService.*\.zip$'
        if ($vectorZip) {
            $vectorExtract = Join-Path $runRoot 'isolated-vector-service-source'
            New-Item -ItemType Directory -Path $vectorExtract -Force | Out-Null
            Expand-Archive -LiteralPath $vectorZip -DestinationPath $vectorExtract -Force
            $vectorPackageRoots = @(Find-CandidateRoots -Roots @($vectorExtract) -MaxDepth 4)
            foreach ($candidateRoot in $vectorPackageRoots) {
                $pkg = Read-Package $candidateRoot
                if ($pkg -and (($pkg.name -match 'vector') -or ((Split-Path -Leaf $candidateRoot) -match 'ST-VectorService|VectorService'))) {
                    $vectorCandidates.Add([pscustomobject]@{ Root = $candidateRoot; Version = [string]$pkg.version; Name = [string]$pkg.name }) | Out-Null
                }
            }
        }
    }

    $stRoot = $null
    $stSource = 'not found'
    if ($stCandidates.Count -eq 1) {
        $stRoot = $stCandidates[0].Root; $stSource = 'installed folder'
    } elseif ($stCandidates.Count -gt 1) {
        Add-Check 'SillyTavern discovery' 'FAIL' ("Multiple candidates found: " + (($stCandidates | ForEach-Object Root) -join '; ')) 1
    } else {
        $stZip = Find-Archive -Roots $searchRoots -Pattern '^SillyTavern.*\.zip$'
        if ($stZip) {
            $stExtract = Join-Path $runRoot 'isolated-sillytavern-source'
            New-Item -ItemType Directory -Path $stExtract -Force | Out-Null
            Expand-Archive -LiteralPath $stZip -DestinationPath $stExtract -Force
            $stDirs = @(Get-ChildItem -LiteralPath $stExtract -Directory)
            if ($stDirs.Count -eq 1) { $stRoot = $stDirs[0].FullName; $stSource = "isolated copy from $stZip" }
            else { Add-Check 'SillyTavern archive layout' 'FAIL' 'Archive has an ambiguous top-level layout.' 1 }
        }
    }

    if ($stRoot) {
        $stPkg = Read-Package $stRoot
        Add-Check 'SillyTavern discovery' 'PASS' ("{0} {1}; {2}" -f $stPkg.name, $stPkg.version, $stSource)
        $patchPath = Join-Path $repoRoot 'host-adapter\prototype\patches\sillytavern-1.19.0-lifecycle-hooks.patch'
        if (-not (Test-Path -LiteralPath $patchPath -PathType Leaf)) {
            Add-Check 'Host lifecycle patch presence' 'FAIL' "Patch file missing: $patchPath" 1
        } else {
            $patchSha256 = Get-FileSha256 $patchPath
            $patchText = Get-Content -LiteralPath $patchPath -Raw
            $patchTargetEvidence = @(
                foreach ($match in [regex]::Matches($patchText, '(?m)^diff --git a/(.+) b/(.+)$')) {
                    $relative = $match.Groups[2].Value
                    $target = Join-Path $stRoot ($relative -replace '/', '\')
                    [pscustomobject]@{
                        relativePath = $relative
                        exists = (Test-Path -LiteralPath $target -PathType Leaf)
                        sha256 = Get-FileSha256 $target
                    }
                }
            )
            Add-Check 'Host lifecycle patch fingerprint' 'PASS' ("SHA256 {0}; {1} target files fingerprinted." -f $patchSha256, $patchTargetEvidence.Count)
            if ($git) {
                $applyOutput = @(& git -C $stRoot apply --check $patchPath 2>&1 | ForEach-Object { [string]$_ })
                $applyCode = $LASTEXITCODE
                if ($applyCode -eq 0) {
                    Add-Check 'Host lifecycle patch compatibility' 'PASS' 'Patch applies cleanly to the discovered SillyTavern source. Check only; no files changed.'
                } else {
                    $reverseOutput = @(& git -C $stRoot apply --reverse --check $patchPath 2>&1 | ForEach-Object { [string]$_ })
                    $reverseCode = $LASTEXITCODE
                    if ($reverseCode -eq 0) {
                        Add-Check 'Host lifecycle patch compatibility' 'PASS' 'Patch is already applied; reverse-check confirms the exact patch footprint. No files changed.'
                    } else {
                        $detail = (($applyOutput + $reverseOutput) -join ' ').Trim()
                        Add-Check 'Host lifecycle patch compatibility' 'FAIL' ("Patch neither applies cleanly nor matches an already-applied state. " + $detail) 1
                    }
                }
            }
        }
        $stPkgLock = Join-Path $stRoot 'package-lock.json'
        if (Test-Path -LiteralPath $stPkgLock -PathType Leaf) {
            Add-Check 'SillyTavern dependency lockfile' 'PASS' (Get-FileSha256 $stPkgLock)
        } else { Add-Check 'SillyTavern dependency lockfile' 'WARN' 'package-lock.json not present.' }
    } else {
        Add-Check 'SillyTavern discovery' 'WARN' 'No unique SillyTavern folder or matching ZIP found. Patch compatibility was not tested.'
    }

    if ($vectorCandidates.Count -eq 1) {
        $vectorRoot = $vectorCandidates[0].Root
        $vectorPkg = Read-Package $vectorRoot
        $vectorEvidence = @(
            foreach ($relative in @('package.json','package-lock.json','server.js')) {
                $target = Join-Path $vectorRoot $relative
                if (Test-Path -LiteralPath $target -PathType Leaf) {
                    [pscustomobject]@{ relativePath = $relative; sha256 = Get-FileSha256 $target; length = (Get-Item -LiteralPath $target).Length }
                }
            }
            $storage = Join-Path $vectorRoot 'vector_storage'
            if (Test-Path -LiteralPath $storage -PathType Container) {
                foreach ($db in Get-ChildItem -LiteralPath $storage -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '\.(sqlite|sqlite3|db)(-wal|-shm)?$' }) {
                    [pscustomobject]@{
                        relativePath = $db.FullName.Substring($vectorRoot.Length).TrimStart('\','/')
                        sha256 = $null
                        length = $db.Length
                        modifiedUtc = $db.LastWriteTimeUtc.ToString('o')
                        note = 'Database content not read or hashed.'
                    }
                }
            }
        )
        Add-Check 'ST-VectorService discovery' 'PASS' ("{0} {1} at {2}" -f $vectorPkg.name, $vectorPkg.version, $vectorRoot)
        if ($vectorPkg.scripts -and $vectorPkg.scripts.test -and $npm) {
            [void](Invoke-ExternalCheck 'ST-VectorService test suite' 'npm' @('test','--if-present') $vectorRoot)
        } else {
            Add-Check 'ST-VectorService tests' 'WARN' 'No npm test script declared; service was inventoried but not executed.'
        }
        $vectorServer = Join-Path $vectorRoot 'server.js'
        if (Test-Path -LiteralPath $vectorServer -PathType Leaf) {
            Add-Check 'ST-VectorService entrypoint' 'PASS' (Get-FileSha256 $vectorServer)
        } else { Add-Check 'ST-VectorService entrypoint' 'WARN' 'server.js not found at service root.' }
    } elseif ($vectorCandidates.Count -gt 1) {
        Add-Check 'ST-VectorService discovery' 'FAIL' ("Multiple candidates found: " + (($vectorCandidates | ForEach-Object Root) -join '; ')) 1
    } else {
        Add-Check 'ST-VectorService discovery' 'WARN' 'No local VectorService folder found. It was not modified.'
    }

    $criticalFailures = @($script:Checks | Where-Object { $_.status -eq 'FAIL' }).Count
    $warnings = @($script:Checks | Where-Object { $_.status -eq 'WARN' }).Count
    $report = [ordered]@{
        schemaVersion = 1
        reportType = 'Logic Engine PC acceptance preflight'
        generatedUtc = [datetime]::UtcNow.ToString('o')
        durationSeconds = [math]::Round(([datetime]::UtcNow - $started).TotalSeconds, 2)
        machine = $env:COMPUTERNAME
        user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        repository = $repoRoot
        repositoryVersion = [string]$enginePackage.version
        nodeVersion = if ($node) { (& node --version 2>&1 | Out-String).Trim() } else { $null }
        gitVersion = if ($git) { (& git --version 2>&1 | Out-String).Trim() } else { $null }
        discoveredSillyTavern = $stRoot
        hostLifecyclePatchSha256 = $patchSha256
        hostLifecyclePatchTargets = @($patchTargetEvidence)
        vectorServiceFingerprint = @($vectorEvidence)
        discoveredVectorService = if ($vectorCandidates.Count -eq 1) { $vectorCandidates[0].Root } else { $null }
        counts = [ordered]@{ passed = @($script:Checks | Where-Object status -eq 'PASS').Count; failed = $criticalFailures; warnings = $warnings }
        checks = @($script:Checks.ToArray())
        safety = [ordered]@{
            liveSillyTavernModified = $false
            vectorServiceModified = $false
            sqliteDatabasesModified = $false
            patchApplied = $false
            note = 'This runner performs discovery, test execution and git apply --check only. It does not install or apply patches.'
        }
    }
    $reportPath = Join-Path $runRoot 'acceptance-report.json'
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    Write-Host ''
    Write-Host ("RESULT: {0} passed / {1} failed / {2} warnings" -f $report.counts.passed, $report.counts.failed, $report.counts.warnings)
    Write-Host "REPORT: $reportPath"
    if ($criticalFailures -gt 0) { exit 1 }
}
catch {
    Add-Check 'Runner execution' 'FAIL' $_.Exception.Message 1
    $fatal = [ordered]@{
        schemaVersion = 1; reportType = 'Logic Engine PC acceptance preflight'
        generatedUtc = [datetime]::UtcNow.ToString('o')
        repository = $repoRoot; fatalError = $_.Exception.Message
        checks = @($script:Checks.ToArray())
        safety = @{ liveSillyTavernModified = $false; vectorServiceModified = $false; sqliteDatabasesModified = $false; patchApplied = $false }
    }
    $fatal | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $runRoot 'acceptance-report.json') -Encoding UTF8
    Write-Host "REPORT: $(Join-Path $runRoot 'acceptance-report.json')"
    exit 1
}
finally {
    Stop-Transcript | Out-Null
})) {
                    $relative = $match.Groups[1].Value
                    $target = Join-Path $stRoot ($relative -replace '/', '\\')
                    [pscustomobject]@{
                        relativePath = $relative
                        exists = (Test-Path -LiteralPath $target -PathType Leaf)
                        sha256 = Get-FileSha256 $target
                    }
                }
            )
            Add-Check 'Host lifecycle patch fingerprint' 'PASS' ("SHA256 {0}; {1} target files fingerprinted." -f $patchSha256, $patchTargetEvidence.Count)
        }
        if ((Test-Path -LiteralPath $patchPath -PathType Leaf) -and $git) {
            $applyOutput = @(& git -C $stRoot apply --check $patchPath 2>&1 | ForEach-Object { [string]$_ })
            $applyCode = $LASTEXITCODE
            if ($applyCode -eq 0) {
                Add-Check 'Host lifecycle patch compatibility' 'PASS' 'Patch applies cleanly to the discovered SillyTavern source. Check only; no files changed.'
            } else {
                $reverseOutput = @(& git -C $stRoot apply --reverse --check $patchPath 2>&1 | ForEach-Object { [string]$_ })
                $reverseCode = $LASTEXITCODE
                if ($reverseCode -eq 0) {
                    Add-Check 'Host lifecycle patch compatibility' 'PASS' 'Patch is already applied; reverse-check confirms the exact patch footprint. No files changed.'
                } else {
                    $detail = (($applyOutput + $reverseOutput) -join ' ').Trim()
                    Add-Check 'Host lifecycle patch compatibility' 'FAIL' ("Patch neither applies cleanly nor matches an already-applied state. " + $detail) 1
                }
            }
        }
        $stPkgLock = Join-Path $stRoot 'package-lock.json'
        if (Test-Path -LiteralPath $stPkgLock -PathType Leaf) {
            Add-Check 'SillyTavern dependency lockfile' 'PASS' (Get-FileSha256 $stPkgLock)
        } else { Add-Check 'SillyTavern dependency lockfile' 'WARN' 'package-lock.json not present.' }
    } else {
        Add-Check 'SillyTavern discovery' 'WARN' 'No unique SillyTavern folder or matching ZIP found. Patch compatibility was not tested.'
    }

    if ($vectorCandidates.Count -eq 1) {
        $vectorRoot = $vectorCandidates[0].Root
        $vectorPkg = Read-Package $vectorRoot
        Add-Check 'ST-VectorService discovery' 'PASS' ("{0} {1} at {2}" -f $vectorPkg.name, $vectorPkg.version, $vectorRoot)
        if ($vectorPkg.scripts -and $vectorPkg.scripts.test -and $npm) {
            [void](Invoke-ExternalCheck 'ST-VectorService test suite' 'npm' @('test','--if-present') $vectorRoot)
        } else {
            Add-Check 'ST-VectorService tests' 'WARN' 'No npm test script declared; service was inventoried but not executed.'
        }
        $vectorServer = Join-Path $vectorRoot 'server.js'
        if (Test-Path -LiteralPath $vectorServer -PathType Leaf) {
            Add-Check 'ST-VectorService entrypoint' 'PASS' (Get-FileSha256 $vectorServer)
        } else { Add-Check 'ST-VectorService entrypoint' 'WARN' 'server.js not found at service root.' }
    } elseif ($vectorCandidates.Count -gt 1) {
        Add-Check 'ST-VectorService discovery' 'FAIL' ("Multiple candidates found: " + (($vectorCandidates | ForEach-Object Root) -join '; ')) 1
    } else {
        Add-Check 'ST-VectorService discovery' 'WARN' 'No local VectorService folder found. It was not modified.'
    }

    $criticalFailures = @($script:Checks | Where-Object { $_.status -eq 'FAIL' }).Count
    $warnings = @($script:Checks | Where-Object { $_.status -eq 'WARN' }).Count
    $report = [ordered]@{
        schemaVersion = 1
        reportType = 'Logic Engine PC acceptance preflight'
        generatedUtc = [datetime]::UtcNow.ToString('o')
        durationSeconds = [math]::Round(([datetime]::UtcNow - $started).TotalSeconds, 2)
        machine = $env:COMPUTERNAME
        user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        repository = $repoRoot
        repositoryVersion = [string]$enginePackage.version
        nodeVersion = if ($node) { (& node --version 2>&1 | Out-String).Trim() } else { $null }
        gitVersion = if ($git) { (& git --version 2>&1 | Out-String).Trim() } else { $null }
        discoveredSillyTavern = $stRoot
        discoveredVectorService = if ($vectorCandidates.Count -eq 1) { $vectorCandidates[0].Root } else { $null }
        counts = [ordered]@{ passed = @($script:Checks | Where-Object status -eq 'PASS').Count; failed = $criticalFailures; warnings = $warnings }
        checks = @($script:Checks.ToArray())
        safety = [ordered]@{
            liveSillyTavernModified = $false
            vectorServiceModified = $false
            sqliteDatabasesModified = $false
            patchApplied = $false
            note = 'This runner performs discovery, test execution and git apply --check only. It does not install or apply patches.'
        }
    }
    $reportPath = Join-Path $runRoot 'acceptance-report.json'
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    Write-Host ''
    Write-Host ("RESULT: {0} passed / {1} failed / {2} warnings" -f $report.counts.passed, $report.counts.failed, $report.counts.warnings)
    Write-Host "REPORT: $reportPath"
    if ($criticalFailures -gt 0) { exit 1 }
}
catch {
    Add-Check 'Runner execution' 'FAIL' $_.Exception.Message 1
    $fatal = [ordered]@{
        schemaVersion = 1; reportType = 'Logic Engine PC acceptance preflight'
        generatedUtc = [datetime]::UtcNow.ToString('o')
        repository = $repoRoot; fatalError = $_.Exception.Message
        checks = @($script:Checks.ToArray())
        safety = @{ liveSillyTavernModified = $false; vectorServiceModified = $false; sqliteDatabasesModified = $false; patchApplied = $false }
    }
    $fatal | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $runRoot 'acceptance-report.json') -Encoding UTF8
    Write-Host "REPORT: $(Join-Path $runRoot 'acceptance-report.json')"
    exit 1
}
finally {
    Stop-Transcript | Out-Null
} }) {
                    [pscustomobject]@{ relativePath = $db.FullName.Substring($vectorRoot.Length).TrimStart('\','/'); sha256 = $null; length = $db.Length; modifiedUtc = $db.LastWriteTimeUtc.ToString('o'); note = 'Database content not read or hashed.' }
                }
            }
        )
        Add-Check 'ST-VectorService discovery' 'PASS' ("{0} {1} at {2}" -f $vectorPkg.name, $vectorPkg.version, $vectorRoot)
        if ($vectorPkg.scripts -and $vectorPkg.scripts.test -and $npm) {
            [void](Invoke-ExternalCheck 'ST-VectorService test suite' 'npm' @('test','--if-present') $vectorRoot)
        } else {
            Add-Check 'ST-VectorService tests' 'WARN' 'No npm test script declared; service was inventoried but not executed.'
        }
        $vectorServer = Join-Path $vectorRoot 'server.js'
        if (Test-Path -LiteralPath $vectorServer -PathType Leaf) {
            Add-Check 'ST-VectorService entrypoint' 'PASS' (Get-FileSha256 $vectorServer)
        } else { Add-Check 'ST-VectorService entrypoint' 'WARN' 'server.js not found at service root.' }
    } elseif ($vectorCandidates.Count -gt 1) {
        Add-Check 'ST-VectorService discovery' 'FAIL' ("Multiple candidates found: " + (($vectorCandidates | ForEach-Object Root) -join '; ')) 1
    } else {
        Add-Check 'ST-VectorService discovery' 'WARN' 'No local VectorService folder found. It was not modified.'
    }

    $criticalFailures = @($script:Checks | Where-Object { $_.status -eq 'FAIL' }).Count
    $warnings = @($script:Checks | Where-Object { $_.status -eq 'WARN' }).Count
    $report = [ordered]@{
        schemaVersion = 1
        reportType = 'Logic Engine PC acceptance preflight'
        generatedUtc = [datetime]::UtcNow.ToString('o')
        durationSeconds = [math]::Round(([datetime]::UtcNow - $started).TotalSeconds, 2)
        machine = $env:COMPUTERNAME
        user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        repository = $repoRoot
        repositoryVersion = [string]$enginePackage.version
        nodeVersion = if ($node) { (& node --version 2>&1 | Out-String).Trim() } else { $null }
        gitVersion = if ($git) { (& git --version 2>&1 | Out-String).Trim() } else { $null }
        discoveredSillyTavern = $stRoot
        discoveredVectorService = if ($vectorCandidates.Count -eq 1) { $vectorCandidates[0].Root } else { $null }
        counts = [ordered]@{ passed = @($script:Checks | Where-Object status -eq 'PASS').Count; failed = $criticalFailures; warnings = $warnings }
        checks = @($script:Checks.ToArray())
        safety = [ordered]@{
            liveSillyTavernModified = $false
            vectorServiceModified = $false
            sqliteDatabasesModified = $false
            patchApplied = $false
            note = 'This runner performs discovery, test execution and git apply --check only. It does not install or apply patches.'
        }
    }
    $reportPath = Join-Path $runRoot 'acceptance-report.json'
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    Write-Host ''
    Write-Host ("RESULT: {0} passed / {1} failed / {2} warnings" -f $report.counts.passed, $report.counts.failed, $report.counts.warnings)
    Write-Host "REPORT: $reportPath"
    if ($criticalFailures -gt 0) { exit 1 }
}
catch {
    Add-Check 'Runner execution' 'FAIL' $_.Exception.Message 1
    $fatal = [ordered]@{
        schemaVersion = 1; reportType = 'Logic Engine PC acceptance preflight'
        generatedUtc = [datetime]::UtcNow.ToString('o')
        repository = $repoRoot; fatalError = $_.Exception.Message
        checks = @($script:Checks.ToArray())
        safety = @{ liveSillyTavernModified = $false; vectorServiceModified = $false; sqliteDatabasesModified = $false; patchApplied = $false }
    }
    $fatal | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $runRoot 'acceptance-report.json') -Encoding UTF8
    Write-Host "REPORT: $(Join-Path $runRoot 'acceptance-report.json')"
    exit 1
}
finally {
    Stop-Transcript | Out-Null
})) {
                    $relative = $match.Groups[1].Value
                    $target = Join-Path $stRoot ($relative -replace '/', '\\')
                    [pscustomobject]@{
                        relativePath = $relative
                        exists = (Test-Path -LiteralPath $target -PathType Leaf)
                        sha256 = Get-FileSha256 $target
                    }
                }
            )
            Add-Check 'Host lifecycle patch fingerprint' 'PASS' ("SHA256 {0}; {1} target files fingerprinted." -f $patchSha256, $patchTargetEvidence.Count)
        }
        if ((Test-Path -LiteralPath $patchPath -PathType Leaf) -and $git) {
            $applyOutput = @(& git -C $stRoot apply --check $patchPath 2>&1 | ForEach-Object { [string]$_ })
            $applyCode = $LASTEXITCODE
            if ($applyCode -eq 0) {
                Add-Check 'Host lifecycle patch compatibility' 'PASS' 'Patch applies cleanly to the discovered SillyTavern source. Check only; no files changed.'
            } else {
                $reverseOutput = @(& git -C $stRoot apply --reverse --check $patchPath 2>&1 | ForEach-Object { [string]$_ })
                $reverseCode = $LASTEXITCODE
                if ($reverseCode -eq 0) {
                    Add-Check 'Host lifecycle patch compatibility' 'PASS' 'Patch is already applied; reverse-check confirms the exact patch footprint. No files changed.'
                } else {
                    $detail = (($applyOutput + $reverseOutput) -join ' ').Trim()
                    Add-Check 'Host lifecycle patch compatibility' 'FAIL' ("Patch neither applies cleanly nor matches an already-applied state. " + $detail) 1
                }
            }
        }
        $stPkgLock = Join-Path $stRoot 'package-lock.json'
        if (Test-Path -LiteralPath $stPkgLock -PathType Leaf) {
            Add-Check 'SillyTavern dependency lockfile' 'PASS' (Get-FileSha256 $stPkgLock)
        } else { Add-Check 'SillyTavern dependency lockfile' 'WARN' 'package-lock.json not present.' }
    } else {
        Add-Check 'SillyTavern discovery' 'WARN' 'No unique SillyTavern folder or matching ZIP found. Patch compatibility was not tested.'
    }

    if ($vectorCandidates.Count -eq 1) {
        $vectorRoot = $vectorCandidates[0].Root
        $vectorPkg = Read-Package $vectorRoot
        Add-Check 'ST-VectorService discovery' 'PASS' ("{0} {1} at {2}" -f $vectorPkg.name, $vectorPkg.version, $vectorRoot)
        if ($vectorPkg.scripts -and $vectorPkg.scripts.test -and $npm) {
            [void](Invoke-ExternalCheck 'ST-VectorService test suite' 'npm' @('test','--if-present') $vectorRoot)
        } else {
            Add-Check 'ST-VectorService tests' 'WARN' 'No npm test script declared; service was inventoried but not executed.'
        }
        $vectorServer = Join-Path $vectorRoot 'server.js'
        if (Test-Path -LiteralPath $vectorServer -PathType Leaf) {
            Add-Check 'ST-VectorService entrypoint' 'PASS' (Get-FileSha256 $vectorServer)
        } else { Add-Check 'ST-VectorService entrypoint' 'WARN' 'server.js not found at service root.' }
    } elseif ($vectorCandidates.Count -gt 1) {
        Add-Check 'ST-VectorService discovery' 'FAIL' ("Multiple candidates found: " + (($vectorCandidates | ForEach-Object Root) -join '; ')) 1
    } else {
        Add-Check 'ST-VectorService discovery' 'WARN' 'No local VectorService folder found. It was not modified.'
    }

    $criticalFailures = @($script:Checks | Where-Object { $_.status -eq 'FAIL' }).Count
    $warnings = @($script:Checks | Where-Object { $_.status -eq 'WARN' }).Count
    $report = [ordered]@{
        schemaVersion = 1
        reportType = 'Logic Engine PC acceptance preflight'
        generatedUtc = [datetime]::UtcNow.ToString('o')
        durationSeconds = [math]::Round(([datetime]::UtcNow - $started).TotalSeconds, 2)
        machine = $env:COMPUTERNAME
        user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        repository = $repoRoot
        repositoryVersion = [string]$enginePackage.version
        nodeVersion = if ($node) { (& node --version 2>&1 | Out-String).Trim() } else { $null }
        gitVersion = if ($git) { (& git --version 2>&1 | Out-String).Trim() } else { $null }
        discoveredSillyTavern = $stRoot
        discoveredVectorService = if ($vectorCandidates.Count -eq 1) { $vectorCandidates[0].Root } else { $null }
        counts = [ordered]@{ passed = @($script:Checks | Where-Object status -eq 'PASS').Count; failed = $criticalFailures; warnings = $warnings }
        checks = @($script:Checks.ToArray())
        safety = [ordered]@{
            liveSillyTavernModified = $false
            vectorServiceModified = $false
            sqliteDatabasesModified = $false
            patchApplied = $false
            note = 'This runner performs discovery, test execution and git apply --check only. It does not install or apply patches.'
        }
    }
    $reportPath = Join-Path $runRoot 'acceptance-report.json'
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    Write-Host ''
    Write-Host ("RESULT: {0} passed / {1} failed / {2} warnings" -f $report.counts.passed, $report.counts.failed, $report.counts.warnings)
    Write-Host "REPORT: $reportPath"
    if ($criticalFailures -gt 0) { exit 1 }
}
catch {
    Add-Check 'Runner execution' 'FAIL' $_.Exception.Message 1
    $fatal = [ordered]@{
        schemaVersion = 1; reportType = 'Logic Engine PC acceptance preflight'
        generatedUtc = [datetime]::UtcNow.ToString('o')
        repository = $repoRoot; fatalError = $_.Exception.Message
        checks = @($script:Checks.ToArray())
        safety = @{ liveSillyTavernModified = $false; vectorServiceModified = $false; sqliteDatabasesModified = $false; patchApplied = $false }
    }
    $fatal | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $runRoot 'acceptance-report.json') -Encoding UTF8
    Write-Host "REPORT: $(Join-Path $runRoot 'acceptance-report.json')"
    exit 1
}
finally {
    Stop-Transcript | Out-Null
}