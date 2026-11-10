[CmdletBinding()]
param(
    [string]$LogicEngineRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$SkipDeploymentSmoke
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath $LogicEngineRoot).Path
$script:Rows = New-Object System.Collections.Generic.List[object]
$script:Failed = $false
$script:Pending = $false
$script:SavedEnv = @{}
$script:EnvIsolated = $false
$script:StartTime = Get-Date
$script:TempRoot = Join-Path $env:TEMP ("LogicEngine-Phase2-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$script:StRoot = Join-Path $script:TempRoot 'SillyTavern'
$script:StPin = '06bde939fb1e9c4c8d8641d810f0a916b5bce127'

function Add-Result {
    param([string]$Name,[ValidateSet('PASS','FAIL','SKIP','PENDING')][string]$Status,[string]$Detail='')
    $script:Rows.Add([pscustomobject]@{Check=$Name;Result=$Status;Details=$Detail}) | Out-Null
    $color = if($Status -eq 'PASS'){'Green'}elseif($Status -eq 'FAIL'){'Red'}else{'Yellow'}
    Write-Host "[$Status] $Name" -ForegroundColor $color
    if($Detail){Write-Host "       $Detail" -ForegroundColor DarkGray}
    if($Status -eq 'FAIL'){$script:Failed=$true}
    if($Status -in @('SKIP','PENDING')){$script:Pending=$true}
}
function Write-Section {
    param([string]$Name)
    Write-Host ''
    Write-Host ('=' * 70) -ForegroundColor DarkGray
    Write-Host $Name -ForegroundColor Cyan
}
function Invoke-Process {
    param([string]$Name,[string]$Exe,[string[]]$Arguments,[string]$Cwd=$repo,[hashtable]$Environment=@{})
    $old=@{}
    foreach($key in $Environment.Keys){
        $old[$key]=[Environment]::GetEnvironmentVariable($key,'Process')
        [Environment]::SetEnvironmentVariable($key,[string]$Environment[$key],'Process')
    }
    Write-Host ''
    Write-Host ">>> $Name" -ForegroundColor Cyan
    Push-Location -LiteralPath $Cwd
    try {
        & $Exe @Arguments 2>&1 | ForEach-Object { Write-Host ([string]$_) }
        $code=$LASTEXITCODE
        if($null -eq $code){$code=0}
        if($code -eq 0){Add-Result $Name 'PASS';return $true}
        Add-Result $Name 'FAIL' "Exit code: $code";return $false
    } catch {
        Add-Result $Name 'FAIL' $_.Exception.Message;return $false
    } finally {
        Pop-Location
        foreach($key in $Environment.Keys){[Environment]::SetEnvironmentVariable($key,$old[$key],'Process')}
    }
}
function Invoke-Tests {
    param([string]$Name,[string[]]$Files,[switch]$Configure,[hashtable]$Environment=@{},[string[]]$Extra=@())
    $missing=@($Files|Where-Object{-not(Test-Path -LiteralPath (Join-Path $repo $_) -PathType Leaf)})
    if($missing.Count){Add-Result $Name 'FAIL' ('Missing files: '+($missing -join ', '));return $false}
    $argsList=@()
    if($Configure){$argsList+=@('--import','./tests/configure-test-env.js')}
    $argsList+='--test'
    $argsList+=$Extra
    $argsList+=$Files
    return (Invoke-Process $Name $script:Node $argsList $repo $Environment)
}
function Invoke-TestGlob {
    param([string]$Name,[string]$Directory,[string]$Pattern,[switch]$Serial,[hashtable]$Environment=@{})
    $dir=Join-Path $repo $Directory
    if(-not(Test-Path -LiteralPath $dir -PathType Container)){Add-Result $Name 'FAIL' "Missing directory $Directory";return $false}
    $files=@(Get-ChildItem -LiteralPath $dir -Filter $Pattern -File|Sort-Object FullName|ForEach-Object{$_.FullName.Substring($repo.Length+1).Replace('\','/')})
    if(-not $files.Count){Add-Result $Name 'FAIL' "No $Pattern files in $Directory";return $false}
    $a=@('--test')
    if($Serial){$a+='--test-concurrency=1'}
    $a+=$files
    return (Invoke-Process $Name $script:Node $a $repo $Environment)
}
function Save-And-ClearEnvironment {
    $names=@(Get-ChildItem Env:|Where-Object{$_.Name -match '^(ENGINE_|LOGIC_ENGINE_|SILLYTAVERN_|ST_)'}|ForEach-Object{$_.Name})
    foreach($name in $names){
        $script:SavedEnv[$name]=[Environment]::GetEnvironmentVariable($name,'Process')
        [Environment]::SetEnvironmentVariable($name,$null,'Process')
    }
    $script:EnvIsolated=$true
    Add-Result 'Process environment isolation' 'PASS' "$($names.Count) project variables temporarily cleared; User/Machine settings untouched"
}
function Restore-Environment {
    if(-not $script:EnvIsolated){return}
    foreach($name in $script:SavedEnv.Keys){[Environment]::SetEnvironmentVariable($name,$script:SavedEnv[$name],'Process')}
    $script:EnvIsolated=$false
    Write-Host '[INFO] Process environment restored.' -ForegroundColor Cyan
}
function Prepare-PinnedST {
    Write-Section 'PINNED SILLYTAVERN PATCH PREFLIGHT'
    New-Item -ItemType Directory -Path $script:TempRoot -Force | Out-Null
    if(-not(Invoke-Process 'Clone pinned SillyTavern source' $script:Git @('clone','--no-checkout','--filter=blob:none','https://github.com/SillyTavern/SillyTavern.git',$script:StRoot))){return $false}
    if(-not(Invoke-Process 'Fetch pinned SillyTavern commit' $script:Git @('-C',$script:StRoot,'fetch','--depth=1','origin',$script:StPin))){return $false}
    if(-not(Invoke-Process 'Checkout pinned SillyTavern commit' $script:Git @('-C',$script:StRoot,'checkout','--detach','FETCH_HEAD'))){return $false}
    $actual=(& $script:Git -C $script:StRoot rev-parse HEAD 2>&1|Out-String).Trim()
    if($LASTEXITCODE -ne 0 -or $actual -ne $script:StPin){Add-Result 'Pinned ST commit' 'FAIL' "Expected $($script:StPin), found $actual";return $false}
    Add-Result 'Pinned ST commit' 'PASS' $actual
    & $script:Git -C $script:StRoot config core.autocrlf false
    & $script:Git -C $script:StRoot config core.eol lf
    & $script:Git -C $script:StRoot reset --hard HEAD
    & $script:Git -C $script:StRoot checkout-index --force --all
    if($LASTEXITCODE -ne 0){Add-Result 'Pinned ST LF normalization' 'FAIL';return $false}
    Add-Result 'Pinned ST LF normalization' 'PASS'
    $server=Join-Path $script:StRoot 'plugins/logic-engine-extension-gateway'
    $browser=Join-Path $script:StRoot 'public/scripts/extensions/third-party/logic-engine-extension-gateway'
    New-Item -ItemType Directory -Path $server,$browser -Force|Out-Null
    $serverSource=Join-Path $repo 'host-adapter/extension-gateway/server-plugin'
    Get-ChildItem -LiteralPath $serverSource -File|Where-Object{$_.Extension -in @('.mjs','.js') -or $_.Name -eq 'package.json'}|Copy-Item -Destination $server -Force
    foreach($name in @('index.js','gateway-policy.mjs','host-context.mjs','conversation-identity.mjs','manifest.json')){
        $source=Join-Path (Join-Path $repo 'host-adapter/extension-gateway') $name
        if(-not(Test-Path -LiteralPath $source -PathType Leaf)){Add-Result 'Gateway browser artifacts' 'FAIL' "Missing $name";return $false}
        Copy-Item -LiteralPath $source -Destination $browser -Force
    }
    foreach($name in @('sillytavern-1.19.0-lifecycle-hooks.patch','sillytavern-1.19.0-root-mutation-guards.patch')){
        $patch=Join-Path (Join-Path $repo 'host-adapter/prototype/patches') $name
        if(-not(Test-Path -LiteralPath $patch -PathType Leaf)){Add-Result 'Host patch files' 'FAIL' "Missing $name";return $false}
        $prefix=@('-C',$script:StRoot,'-c','core.autocrlf=false','apply','--ignore-space-change','--ignore-whitespace','--unidiff-zero')
        if(-not(Invoke-Process "Patch check: $name" $script:Git ($prefix+@('--check',$patch)))){return $false}
        if(-not(Invoke-Process "Apply patch: $name" $script:Git ($prefix+@($patch)))){return $false}
    }
    if(-not(Invoke-Process 'Pinned ST patch whitespace check' $script:Git @('-C',$script:StRoot,'-c','core.whitespace=cr-at-eol','diff','--check'))){return $false}
    return $true
}

try {
    Write-Section 'LOGIC ENGINE — PHASE 2 PC ACCEPTANCE'
    Write-Host "Repository: $repo"
    Write-Host "Temporary test data: $script:TempRoot"
    $pkg=Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw|ConvertFrom-Json
    if($pkg.name -ne 'logic-engine'){throw 'WRONG_REPOSITORY'}
    Add-Result 'Logic Engine repository' 'PASS' "$($pkg.name) $($pkg.version)"
    $branch=(& git -C $repo branch --show-current 2>&1|Out-String).Trim()
    if($LASTEXITCODE -ne 0 -or $branch -ne 'integration/host-core-v1'){throw "WRONG_BRANCH: $branch"}
    Add-Result 'Target branch' 'PASS' $branch
    $dirty=@(& git -C $repo status --porcelain --untracked-files=no 2>&1)
    if($LASTEXITCODE -ne 0){throw 'GIT_STATUS_FAILED'}
    if($dirty.Count){$dirty|ForEach-Object{Write-Host $_ -ForegroundColor Red};throw 'TRACKED_WORKTREE_CHANGES_PRESENT'}
    Add-Result 'Tracked worktree' 'PASS' 'Clean; untracked user files left untouched'
    $head=(& git -C $repo rev-parse HEAD 2>&1|Out-String).Trim()
    $remote=@(& git -C $repo ls-remote origin refs/heads/integration/host-core-v1 2>&1)
    if($LASTEXITCODE -ne 0 -or -not $remote.Count){throw 'REMOTE_BRANCH_LOOKUP_FAILED'}
    $remoteHead=([string]$remote[0]).Split([char]9)[0]
    if($head -ne $remoteHead){throw "LOCAL_REMOTE_HEAD_MISMATCH local=$head remote=$remoteHead"}
    Add-Result 'Local/GitHub candidate SHA' 'PASS' $head

    $nodeCmd=Get-Command node.exe -ErrorAction SilentlyContinue
    $npmCmd=Get-Command npm.cmd -ErrorAction SilentlyContinue
    $gitCmd=Get-Command git.exe -ErrorAction SilentlyContinue
    if(-not $nodeCmd -or -not $npmCmd -or -not $gitCmd){throw 'NODE_NPM_CMD_OR_GIT_MISSING'}
    $script:Node=$nodeCmd.Source;$script:Npm=$npmCmd.Source;$script:Git=$gitCmd.Source
    $nodeVersion=(& $script:Node --version 2>&1|Out-String).Trim()
    if($nodeVersion -notmatch '^v(\d+)\.(\d+)\.(\d+)'){throw "NODE_VERSION_INVALID $nodeVersion"}
    if([int]$Matches[1] -lt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -lt 13)){throw "NODE_VERSION_UNSUPPORTED $nodeVersion"}
    Add-Result 'Node.js version' 'PASS' $nodeVersion
    Add-Result 'npm.cmd' 'PASS' $script:Npm
    Add-Result 'Git' 'PASS' $script:Git
    Save-And-ClearEnvironment

    Write-Section 'DEPENDENCIES AND ROOT TEST SUITE'
    if(-not(Invoke-Process 'Install Logic Engine dependencies' $script:Npm @('install','--no-package-lock','--no-audit','--no-fund'))){throw 'DEPENDENCY_INSTALL_FAILED'}
    [void](Invoke-Process 'Full npm test suite' $script:Npm @('test'))

    Write-Section 'WINDOWS RUNTIME CI TEST GROUPS'
    [void](Invoke-Tests 'Deployment security contracts' @('tests/deployment-security-contracts.test.js'))
    [void](Invoke-Tests 'NPC Memory boundary' @(
        'tests/npc-memory-candidate-eligibility.test.js','tests/memory-npc-consumer.test.js','tests/trusted-initial-knowledge-source.test.js',
        'tests/npc-epistemic-state.test.js','tests/npc-knowledge-read.test.js','tests/npc-belief-state.test.js','tests/npc-knowledge-snapshot-race.test.js',
        'tests/npc-generation-context.test.js','tests/npc-generation-context-runtime.test.js','tests/npc-generation-context-host-bridge.test.js',
        'tests/npc-belief-state-snapshot-race.test.js','tests/npc-goal-lifecycle.test.js','tests/npc-plan-progress.test.js',
        'tests/npc-autonomous-intention-selector.test.js','tests/npc-internal-conflict-evaluator.test.js','tests/npc-decision-reconsideration-evaluator.test.js'
    ) -Configure)
    [void](Invoke-TestGlob 'Host lifecycle prototype tests (serial)' 'host-adapter/prototype/tests' '*.test.mjs' -Serial)
    [void](Invoke-Tests 'Core trusted acquisition and restore' @(
        'tests/core-trusted-initial-knowledge-ingestion.test.js','tests/trusted-initial-knowledge-api-boundary.test.js',
        'tests/memory-provider-coordinated-restore.characterization.test.js'
    ) -Configure)
    [void](Invoke-Tests 'Windows file identity probe' @('tests/windows-file-identity-probe.test.js'))
    [void](Invoke-Tests 'Windows symlink rejection tests' @(
        'tests/core-trusted-initial-knowledge-ingestion.test.js','tests/sqlite-memory-provider.test.js'
    ) -Configure -Environment @{LOGIC_ENGINE_REQUIRE_SYMLINK_TESTS='1'})
    [void](Invoke-Tests 'Host inventory reconciliation' @('tests/host-version-digest-ledger.test.js','tests/host-version-ledger-api.test.js') -Configure)
    [void](Invoke-Tests 'Process Manager contract' @('tests/process-contract.test.js'))
    [void](Invoke-Tests 'Mechanics policy and authority' @(
        'tests/authorized-read-service.test.js','tests/mechanic-executor.test.js','tests/mechanic-core-integration.test.js','tests/api.test.js'
    ) -Configure)
    [void](Invoke-Tests 'Independent recalculation oracle' @('experiments/recalculation-oracle/harness.test.mjs'))

    if(Prepare-PinnedST){
        Write-Section 'GATEWAY / LIFECYCLE INTEGRATION TESTS'
        [void](Invoke-TestGlob 'Gateway plugin tests' 'host-adapter/extension-gateway/tests' '*.test.mjs' -Environment @{SILLYTAVERN_SOURCE_ROOT=$script:StRoot})
        [void](Invoke-Tests 'Host lifecycle acceptance and source audit' @(
            'host-adapter/prototype/tests/lifecycle-acceptance-scenarios.test.mjs',
            'host-adapter/prototype/tests/pinned-st-source-audit.test.mjs',
            'host-adapter/prototype/tests/st-host-inventory-handler.test.mjs',
            'host-adapter/prototype/tests/st-server-digest-proxy.test.mjs',
            'src/application/host-session-context.test.js'
        ) -Environment @{SILLYTAVERN_SOURCE_ROOT=$script:StRoot})
    } else {
        Add-Result 'Gateway/lifecycle integration tests' 'SKIP' 'Pinned ST patch preflight failed; see earlier failure.'
    }

    if($script:Failed){
        Add-Result 'Isolated deployment smoke' 'SKIP' 'Not launched because automated checks failed.'
    } elseif($SkipDeploymentSmoke){
        Add-Result 'Isolated deployment smoke' 'SKIP' 'Explicitly skipped.'
    } else {
        Write-Section 'ISOLATED HOST / CORE DEPLOYMENT SMOKE'
        Write-Host 'The existing harness creates a disposable ST checkout and temporary Core databases.' -ForegroundColor Yellow
        Write-Host 'It does not use the installed ST profile, identity or ST-VectorService.' -ForegroundColor Yellow
        Write-Host 'The temporary server runs in the foreground; after browser checks press Ctrl+C.' -ForegroundColor Yellow
        $smoke=Join-Path $repo 'scripts/Start-LogicEngine-PR870-Test.ps1'
        $ps=Get-Command powershell.exe -ErrorAction SilentlyContinue
        if(-not $ps){$ps=Get-Command pwsh.exe -ErrorAction SilentlyContinue}
        if(-not $ps){Add-Result 'Isolated deployment smoke' 'FAIL' 'PowerShell executable not found'}
        else {
            & $ps.Source -NoProfile -ExecutionPolicy Bypass -File $smoke -CandidateCommit $head
            $exit=$LASTEXITCODE
            if($null -eq $exit){$exit=0}
            if($exit -eq 0){
                Add-Result 'Isolated deployment smoke process' 'PASS' 'Harness exited cleanly; browser verification is separate.'
                Add-Result 'Temporary ST browser verification' 'PENDING' 'Verify authenticated session, /session, /identity, chat save and ordinary generation.'
            } else {Add-Result 'Isolated deployment smoke process' 'FAIL' "Exit code: $exit"}
        }
    }
    Add-Result 'Linux-only symlink security job' 'SKIP' 'Run on self-hosted Linux; Windows cannot certify it.'
}
catch {
    Add-Result 'Acceptance runner' 'FAIL' $_.Exception.Message
}
finally {
    Restore-Environment
    Write-Section 'ACCEPTANCE SUMMARY'
    $script:Rows|Format-Table -Property Check,Result,Details -AutoSize -Wrap
    $pass=@($script:Rows|Where-Object Result -eq 'PASS').Count
    $fail=@($script:Rows|Where-Object Result -eq 'FAIL').Count
    $pending=@($script:Rows|Where-Object{$_.Result -in @('SKIP','PENDING')}).Count
    Write-Host ''
    Write-Host "PASS: $pass" -ForegroundColor Green
    Write-Host "FAIL: $fail" -ForegroundColor Red
    Write-Host "SKIP/PENDING: $pending" -ForegroundColor Yellow
    Write-Host ("Elapsed: {0:N1} minutes" -f ((Get-Date)-$script:StartTime).TotalMinutes)
    if($fail){Write-Host 'RESULT: FAIL' -ForegroundColor Red}
    elseif($pending){Write-Host 'RESULT: INCOMPLETE' -ForegroundColor Yellow}
    else{Write-Host 'RESULT: AUTOMATED WINDOWS ACCEPTANCE PASS' -ForegroundColor Green}
    Write-Host "Temporary diagnostics retained: $script:TempRoot" -ForegroundColor Cyan
}
if($script:Failed){exit 1}
if($script:Pending){exit 2}
exit 0
