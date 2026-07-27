# Orbit 0727 Batch Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Process all 60 existing `Output\0727` parameter directories, preserving the generator's exact three data lines in `orbit_output.txt` and saving formatted IOD results in `result.txt`.

**Architecture:** A single PowerShell runner discovers jobs from directory names, validates and sorts them, invokes the existing generator once per job, saves the captured input, and feeds that same captured input to the existing IOD executable. Small pure functions handle directory parsing and IOD formatting so they can be tested before any production output is written.

**Tech Stack:** PowerShell 7, existing Visual C++ Release/x64 generator, existing Hodograph Debug/x64 solver, UTF-8 text files without BOM.

---

## File Map

- Create: `C:\Users\刘宗哲\Documents\轨迹演示\orbit_0727_work\run_0727.ps1`
  - Testable source of the production batch runner.
- Create: `C:\Users\刘宗哲\Documents\轨迹演示\orbit_0727_work\test_run_0727.ps1`
  - Dependency-free PowerShell tests for discovery, sorting, raw-line persistence, and IOD formatting.
- Create: `C:\Users\刘宗哲\Desktop\Orbit\run_0727.ps1`
  - Deployed copy used for the real 60-job run.
- Create during execution: `C:\Users\刘宗哲\Desktop\Orbit\Output\0727\...\orbit_output.txt`
- Create during execution: `C:\Users\刘宗哲\Desktop\Orbit\Output\0727\...\result.txt`

### Task 1: Add Failing Discovery Tests

**Files:**
- Create: `C:\Users\刘宗哲\Documents\轨迹演示\orbit_0727_work\test_run_0727.ps1`
- Test: `C:\Users\刘宗哲\Documents\轨迹演示\orbit_0727_work\test_run_0727.ps1`

- [ ] **Step 1: Write the discovery and sorting test**

Create the test file with this content:

```powershell
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'run_0727.ps1'
. $scriptPath

function Assert-Equal($actual, $expected, [string]$message) {
    if ($actual -ne $expected) {
        throw "$message. Expected: $expected; Actual: $actual"
    }
}

$fixture = Join-Path $PSScriptRoot 'fixture'
if (Test-Path -LiteralPath $fixture) {
    Remove-Item -LiteralPath $fixture -Recurse -Force
}

$outputRoot = Join-Path $fixture 'Output\0727'
New-Item -ItemType Directory -Path (Join-Path $outputRoot 'delta_T=0.5T\N=2\T0=0.7T') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputRoot 'delta_T=0.1T\N=0\T0=0.2T') -Force | Out-Null

$jobs = @(Get-OrbitJobs -OutputRoot $outputRoot)
Assert-Equal $jobs.Count 2 'Discovery count mismatch'
Assert-Equal $jobs[0].DeltaText '0.1' 'Jobs are not sorted by delta_T'
Assert-Equal $jobs[0].Rounds 0 'N parsing failed'
Assert-Equal $jobs[0].T0Text '0.2' 'T0 parsing failed'
Assert-Equal $jobs[1].DeltaText '0.5' 'Second delta_T mismatch'

Write-Output 'DISCOVERY_TEST=PASS'
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
& 'C:\Users\刘宗哲\Documents\轨迹演示\orbit_0727_work\test_run_0727.ps1'
```

Expected: failure because `run_0727.ps1` or `Get-OrbitJobs` does not exist.

### Task 2: Implement Directory Discovery

**Files:**
- Create: `C:\Users\刘宗哲\Documents\轨迹演示\orbit_0727_work\run_0727.ps1`
- Test: `C:\Users\刘宗哲\Documents\轨迹演示\orbit_0727_work\test_run_0727.ps1`

- [ ] **Step 1: Implement invariant parsing and job discovery**

Create `run_0727.ps1` with these functions and the dot-source guard:

```powershell
param(
    [string]$OrbitRoot = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$script:InvariantCulture = [System.Globalization.CultureInfo]::InvariantCulture

function ConvertTo-OrbitDouble([string]$Text, [string]$Name) {
    $value = 0.0
    if (-not [double]::TryParse(
        $Text,
        [System.Globalization.NumberStyles]::Float,
        $script:InvariantCulture,
        [ref]$value)) {
        throw "Invalid $Name value: $Text"
    }
    return $value
}

function Get-OrbitJobs([string]$OutputRoot) {
    $jobs = [System.Collections.Generic.List[object]]::new()

    foreach ($deltaDirectory in Get-ChildItem -LiteralPath $OutputRoot -Directory) {
        if ($deltaDirectory.Name -notmatch '^delta_T=([0-9]+(?:\.[0-9]+)?)T$') {
            throw "Malformed delta_T directory: $($deltaDirectory.FullName)"
        }
        $deltaText = $Matches[1]
        $deltaValue = ConvertTo-OrbitDouble $deltaText 'delta_T/T'

        foreach ($roundDirectory in Get-ChildItem -LiteralPath $deltaDirectory.FullName -Directory) {
            if ($roundDirectory.Name -notmatch '^N=([0-9]+)$') {
                throw "Malformed N directory: $($roundDirectory.FullName)"
            }
            $rounds = [int]$Matches[1]

            foreach ($t0Directory in Get-ChildItem -LiteralPath $roundDirectory.FullName -Directory) {
                if ($t0Directory.Name -notmatch '^T0=([0-9]+(?:\.[0-9]+)?)T$') {
                    throw "Malformed T0 directory: $($t0Directory.FullName)"
                }
                $t0Text = $Matches[1]
                $t0Value = ConvertTo-OrbitDouble $t0Text 'T0/T'
                $jobs.Add([pscustomobject]@{
                    DeltaText = $deltaText
                    DeltaValue = $deltaValue
                    Rounds = $rounds
                    T0Text = $t0Text
                    T0Value = $t0Value
                    TargetDirectory = $t0Directory.FullName
                })
            }
        }
    }

    return $jobs | Sort-Object DeltaValue, Rounds, T0Value
}

if ($MyInvocation.InvocationName -ne '.') {
    Write-Output 'DISCOVERY_FUNCTIONS_READY'
}
```

- [ ] **Step 2: Run the discovery test**

Run the Task 1 test again.

Expected:

```text
DISCOVERY_TEST=PASS
```

- [ ] **Step 3: Commit the discovery unit**

```powershell
git add -- orbit_0727_work/run_0727.ps1 orbit_0727_work/test_run_0727.ps1
git commit -m "test: cover Orbit 0727 directory discovery"
```

### Task 3: Add Failing Persistence and Formatting Tests

**Files:**
- Modify: `C:\Users\刘宗哲\Documents\轨迹演示\orbit_0727_work\test_run_0727.ps1`
- Test: `C:\Users\刘宗哲\Documents\轨迹演示\orbit_0727_work\test_run_0727.ps1`

- [ ] **Step 1: Append exact raw-line and IOD-format assertions**

Append this content before the final `DISCOVERY_TEST=PASS` output, then rename that final output to `ALL_UNIT_TESTS=PASS`:

```powershell
$textDirectory = Join-Path $fixture 'text-output'
New-Item -ItemType Directory -Path $textDirectory -Force | Out-Null
$rawLines = @(
    '1.0 2.0 3.0',
    '4.0 5.0 6.0',
    '12345.0'
)
$rawPath = Join-Path $textDirectory 'orbit_output.txt'
Write-Utf8NoBomLines -Path $rawPath -Lines $rawLines
$savedRaw = @(Get-Content -LiteralPath $rawPath)
Assert-Equal $savedRaw.Count 3 'orbit_output line count mismatch'
Assert-Equal $savedRaw[0] $rawLines[0] 'First generator line changed'
Assert-Equal $savedRaw[1] $rawLines[1] 'Second generator line changed'
Assert-Equal $savedRaw[2] $rawLines[2] 'Transfer time line changed'

$iodLines = @(
    'Solution 1',
    'a     = 26600.0000000000 km',
    'e     = 0.7400000000',
    'i     = 63.4000000000 deg',
    'Omega = 250.0000000000 deg',
    'omega = 270.0000000000 deg'
)
$formatted = @(Convert-IodOutput -IodOutput $iodLines)
Assert-Equal $formatted.Count 6 'Formatted solution line count mismatch'
Assert-Equal $formatted[4] '250.0000000000' 'Omega was not preserved'
Assert-Equal $formatted[5] '270.0000000000' 'omega was not preserved'

$noSolution = @(Convert-IodOutput -IodOutput @(
    'No feasible direct elliptic hodograph-circle solution was found.'
))
Assert-Equal $noSolution.Count 1 'Zero-solution output line count mismatch'
Assert-Equal $noSolution[0] 'No feasible direct elliptic hodograph-circle solution was found.' 'Zero-solution message changed'
```

- [ ] **Step 2: Run the test and verify it fails**

Expected: failure because `Write-Utf8NoBomLines` and `Convert-IodOutput` are undefined.

### Task 4: Implement Persistence, Formatting, and the Batch Runner

**Files:**
- Modify: `C:\Users\刘宗哲\Documents\轨迹演示\orbit_0727_work\run_0727.ps1`
- Test: `C:\Users\刘宗哲\Documents\轨迹演示\orbit_0727_work\test_run_0727.ps1`

- [ ] **Step 1: Add raw output persistence**

Add:

```powershell
function Write-Utf8NoBomLines([string]$Path, [string[]]$Lines) {
    [System.IO.File]::WriteAllLines(
        $Path,
        $Lines,
        [System.Text.UTF8Encoding]::new($false))
}
```

- [ ] **Step 2: Add IOD output conversion**

Add the complete conversion function:

```powershell
function Convert-IodOutput([object[]]$IodOutput) {
    $cleanNoSolution = 'No feasible direct elliptic hodograph-circle solution was found.'
    if ($IodOutput | Where-Object { [string]$_ -match [regex]::Escape($cleanNoSolution) }) {
        return @($cleanNoSolution)
    }

    $solutions = [System.Collections.Generic.List[hashtable]]::new()
    $current = $null
    foreach ($lineObject in $IodOutput) {
        $line = [string]$lineObject
        if ($line -match '^\s*Solution\s+(\d+)\s*$') {
            $current = @{ Number = $Matches[1] }
            $solutions.Add($current)
        }
        elseif ($null -ne $current -and $line -cmatch '^\s*a\s*=\s*([^\s]+)') {
            $current.a = $Matches[1]
        }
        elseif ($null -ne $current -and $line -cmatch '^\s*e\s*=\s*([^\s]+)') {
            $current.e = $Matches[1]
        }
        elseif ($null -ne $current -and $line -cmatch '^\s*i\s*=\s*([^\s]+)') {
            $current.i = $Matches[1]
        }
        elseif ($null -ne $current -and $line -cmatch '^\s*Omega\s*=\s*([^\s]+)') {
            $current.Raan = $Matches[1]
        }
        elseif ($null -ne $current -and $line -cmatch '^\s*omega\s*=\s*([^\s]+)') {
            $current.ArgPerigee = $Matches[1]
        }
    }

    if ($solutions.Count -eq 0) {
        throw 'No formatted IOD solutions were found.'
    }

    $resultLines = [System.Collections.Generic.List[string]]::new()
    for ($index = 0; $index -lt $solutions.Count; ++$index) {
        $solution = $solutions[$index]
        foreach ($field in @('a', 'e', 'i', 'Raan', 'ArgPerigee')) {
            if (-not $solution.ContainsKey($field)) {
                throw "Missing field $field in Solution $($solution.Number)"
            }
        }

        $resultLines.Add("Solution $($solution.Number)")
        $resultLines.Add($solution.a)
        $resultLines.Add($solution.e)
        $resultLines.Add($solution.i)
        $resultLines.Add($solution.Raan)
        $resultLines.Add($solution.ArgPerigee)
        if ($index + 1 -lt $solutions.Count) {
            $resultLines.Add('')
        }
    }
    return $resultLines.ToArray()
}
```

- [ ] **Step 3: Replace the temporary execution guard with the production main function**

Add this function and final guard:

```powershell
function Invoke-Orbit0727Batch([string]$Root) {
    $generatorExe = Join-Path $Root 'orbit_test\orbit_test\x64\Release\orbit_test.exe'
    $iodCandidates = @(
        (Join-Path $Root 'Hodograph\Hodograph\x64\Debug\Hodograph.exe'),
        (Join-Path $Root 'Hodograph\Hodograph\x64\Release\Hodograph.exe')
    )
    $iodExe = $iodCandidates |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
    $outputRoot = Join-Path $Root 'Output\0727'

    foreach ($requiredPath in @($generatorExe, $outputRoot)) {
        if (-not (Test-Path -LiteralPath $requiredPath)) {
            throw "Required path does not exist: $requiredPath"
        }
    }
    if ($null -eq $iodExe) {
        throw "No Hodograph executable was found in: $($iodCandidates -join ', ')"
    }

    $jobs = @(Get-OrbitJobs -OutputRoot $outputRoot)
    if ($jobs.Count -eq 0) {
        throw "No parameter directories were found under $outputRoot"
    }

    $completed = 0
    $zeroSolutions = 0
    foreach ($job in $jobs) {
        $generatedInput = @(& $generatorExe $job.DeltaText $job.Rounds $job.T0Text)
        if ($LASTEXITCODE -ne 0) {
            throw "Generator failed for $($job.TargetDirectory)"
        }
        if ($generatedInput.Count -ne 3) {
            throw "Generator returned $($generatedInput.Count) lines instead of 3 for $($job.TargetDirectory)"
        }

        Write-Utf8NoBomLines `
            -Path (Join-Path $job.TargetDirectory 'orbit_output.txt') `
            -Lines $generatedInput

        $iodOutput = @($generatedInput | & $iodExe 2>&1)
        $iodExitCode = $LASTEXITCODE
        $noSolutionMessage = 'No feasible direct elliptic hodograph-circle solution was found.'
        $isZeroSolution = $null -ne ($iodOutput | Where-Object {
            [string]$_ -match [regex]::Escape($noSolutionMessage)
        } | Select-Object -First 1)
        if ($iodExitCode -ne 0 -and -not $isZeroSolution) {
            throw "IOD solver failed for $($job.TargetDirectory)`n$($iodOutput -join [Environment]::NewLine)"
        }
        $resultLines = @(Convert-IodOutput -IodOutput $iodOutput)
        if ($isZeroSolution) {
            ++$zeroSolutions
        }

        Write-Utf8NoBomLines `
            -Path (Join-Path $job.TargetDirectory 'result.txt') `
            -Lines $resultLines

        ++$completed
        Write-Output "[$completed/$($jobs.Count)] $($job.TargetDirectory)"
    }

    Write-Output "Completed $completed result files; zero-solution files: $zeroSolutions."
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-Orbit0727Batch -Root $OrbitRoot
}
```

- [ ] **Step 4: Run all unit tests**

Expected:

```text
ALL_UNIT_TESTS=PASS
```

- [ ] **Step 5: Commit the completed runner and tests**

```powershell
git add -- orbit_0727_work/run_0727.ps1 orbit_0727_work/test_run_0727.ps1
git commit -m "feat: add Orbit 0727 batch runner"
```

### Task 5: Deploy and Run the Production Batch

**Files:**
- Copy: `C:\Users\刘宗哲\Documents\轨迹演示\orbit_0727_work\run_0727.ps1`
- Create: `C:\Users\刘宗哲\Desktop\Orbit\run_0727.ps1`
- Create: 120 output text files under `C:\Users\刘宗哲\Desktop\Orbit\Output\0727`

- [ ] **Step 1: Confirm the existing executables are present**

Run:

```powershell
Get-Item -LiteralPath `
    'C:\Users\刘宗哲\Desktop\Orbit\orbit_test\orbit_test\x64\Release\orbit_test.exe', `
    'C:\Users\刘宗哲\Desktop\Orbit\Hodograph\Hodograph\x64\Debug\Hodograph.exe'
```

Expected: both files exist.

- [ ] **Step 2: Copy the tested runner to Desktop Orbit**

```powershell
Copy-Item -LiteralPath `
    'C:\Users\刘宗哲\Documents\轨迹演示\orbit_0727_work\run_0727.ps1' `
    -Destination 'C:\Users\刘宗哲\Desktop\Orbit\run_0727.ps1' `
    -Force
```

- [ ] **Step 3: Execute all discovered jobs**

```powershell
& 'C:\Users\刘宗哲\Desktop\Orbit\run_0727.ps1'
```

Expected: progress reaches `[60/60]` and the final message reports 60 completed files. The zero-solution count may be nonzero and must be reported rather than treated as a failure.

### Task 6: Verify All Production Outputs

**Files:**
- Verify: `C:\Users\刘宗哲\Desktop\Orbit\Output\0727\...\orbit_output.txt`
- Verify: `C:\Users\刘宗哲\Desktop\Orbit\Output\0727\...\result.txt`

- [ ] **Step 1: Run the complete verification script**

Run a PowerShell validation that:

```powershell
$root = 'C:\Users\刘宗哲\Desktop\Orbit\Output\0727'
$generator = 'C:\Users\刘宗哲\Desktop\Orbit\orbit_test\orbit_test\x64\Release\orbit_test.exe'
$runner = 'C:\Users\刘宗哲\Desktop\Orbit\run_0727.ps1'
. $runner

$jobs = @(Get-OrbitJobs -OutputRoot $root)
$errors = [System.Collections.Generic.List[string]]::new()
$zeroSolutions = 0

foreach ($job in $jobs) {
    $orbitPath = Join-Path $job.TargetDirectory 'orbit_output.txt'
    $resultPath = Join-Path $job.TargetDirectory 'result.txt'
    if (-not (Test-Path -LiteralPath $orbitPath)) {
        $errors.Add("Missing orbit_output.txt: $($job.TargetDirectory)")
        continue
    }
    if (-not (Test-Path -LiteralPath $resultPath)) {
        $errors.Add("Missing result.txt: $($job.TargetDirectory)")
        continue
    }

    $savedInput = @(Get-Content -LiteralPath $orbitPath)
    $freshInput = @(& $generator $job.DeltaText $job.Rounds $job.T0Text)
    if ($savedInput.Count -ne 3) {
        $errors.Add("orbit_output.txt does not contain 3 lines: $orbitPath")
    }
    elseif (($savedInput -join "`n") -cne ($freshInput -join "`n")) {
        $errors.Add("Saved generator data changed: $orbitPath")
    }

    $resultLines = @(Get-Content -LiteralPath $resultPath)
    if ($resultLines.Count -eq 1 -and
        $resultLines[0] -eq 'No feasible direct elliptic hodograph-circle solution was found.') {
        ++$zeroSolutions
        continue
    }

    $nonempty = @($resultLines | Where-Object { $_ -ne '' })
    if ($nonempty.Count -eq 0 -or $nonempty.Count % 6 -ne 0) {
        $errors.Add("Invalid result block size: $resultPath")
        continue
    }
    for ($index = 0; $index -lt $nonempty.Count; ++$index) {
        if ($index % 6 -eq 0) {
            if ($nonempty[$index] -notmatch '^Solution \d+$') {
                $errors.Add("Invalid solution header: $resultPath")
            }
        }
        else {
            $value = 0.0
            if (-not [double]::TryParse(
                $nonempty[$index],
                [System.Globalization.NumberStyles]::Float,
                [System.Globalization.CultureInfo]::InvariantCulture,
                [ref]$value)) {
                $errors.Add("Invalid numeric result: $resultPath")
            }
        }
    }
}

Write-Output "DISCOVERED_JOBS=$($jobs.Count)"
Write-Output "ORBIT_OUTPUT_FILES=$(@(Get-ChildItem -LiteralPath $root -Filter orbit_output.txt -File -Recurse).Count)"
Write-Output "RESULT_FILES=$(@(Get-ChildItem -LiteralPath $root -Filter result.txt -File -Recurse).Count)"
Write-Output "ZERO_SOLUTION_FILES=$zeroSolutions"
Write-Output "VALIDATION_ERRORS=$($errors.Count)"
$errors | Select-Object -First 20
```

Expected:

```text
DISCOVERED_JOBS=60
ORBIT_OUTPUT_FILES=60
RESULT_FILES=60
VALIDATION_ERRORS=0
```

- [ ] **Step 2: Verify N changes only transfer time**

For every equal `delta_T/T` and `T0/T`, compare the first two lines of all three `N` files. Expected: the two velocity-vector lines are identical for `N=0`, `N=1`, and `N=2`; only line 3 changes.

- [ ] **Step 3: Report zero-solution directories explicitly**

List every `result.txt` containing the approved no-solution message so the final response distinguishes successful zero-solution calculations from execution failures.
