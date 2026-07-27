# Orbit 0727 Batch Processing Design

## Goal

Process every parameter directory already present under
`C:\Users\刘宗哲\Desktop\Orbit\Output\0727` by running the existing
`FileName-002` generator and `Hodograph-Lambert-0708` solver.

Each leaf parameter directory must receive:

- `orbit_output.txt`: exactly the three data lines printed by
  `FileName-002`, with no labels, units, or extra metadata.
- `result.txt`: every computed orbit formatted as `Solution N` followed by
  `a`, `e`, `i`, `Omega`, and `omega`, matching the existing example format.

## Scope

The script will discover parameter directories instead of hard-coding a
Cartesian product. The current directory tree contains 60 combinations:

- `delta_T/T`: `0.1`, `0.2`, `0.3`, `0.5`, `0.7`
- `Number_rounds`: `0`, `1`, `2`
- `T0/T`: `0.1`, `0.2`, `0.3`, `0.7`

Only directories matching
`delta_T=<value>T\N=<integer>\T0=<value>T` under `Output\0727` are processed.
Other output batches and unrelated files are not modified.

## Components

### Existing generator

The Release/x64 `orbit_test.exe` built from `FileName-002.cpp` accepts:

```text
orbit_test.exe <delta_T/T> <Number_rounds> <T0/T>
```

It must exit successfully and return exactly three lines: the first velocity
vector, the second velocity vector, and the total transfer time.

### Existing IOD solver

The script selects the Debug/x64 `Hodograph.exe` first and falls back to the
Release/x64 executable. The same three captured generator lines are sent to
the solver through standard input.

### New batch script

`C:\Users\刘宗哲\Desktop\Orbit\run_0727.ps1` will:

1. Verify the generator, IOD solver, and `Output\0727` exist.
2. Discover and validate all leaf parameter directories before writing files.
3. Sort work deterministically by delta fraction, round count, and T0 fraction.
4. Run the generator once per directory.
5. Save the captured three lines to `orbit_output.txt` as UTF-8 without BOM.
6. Feed those same three lines to the IOD solver.
7. Save formatted solutions to `result.txt` as UTF-8 without BOM.
8. Print progress and a final solved/zero-solution summary.

## Error Handling

- A malformed parameter directory, missing executable, generator failure, or
  generator output other than three lines stops the batch with a clear error.
- If the IOD solver reports no feasible direct elliptic solution,
  `result.txt` contains exactly:

```text
No feasible direct elliptic hodograph-circle solution was found.
```

  The corresponding `orbit_output.txt` remains saved, and processing continues.
- Any other IOD failure, missing orbital element, or malformed solver output
  stops the batch to prevent silently incomplete results.

## Verification

After execution, verification will confirm:

- 60 discovered parameter directories.
- 60 `orbit_output.txt` files and 60 `result.txt` files.
- Every `orbit_output.txt` has exactly three non-empty numeric data lines.
- Every non-zero result consists only of six-line blocks: one `Solution N`
  header and five numeric orbital elements.
- Every zero-solution result contains the exact approved message.
- Changing `N` does not change the two velocity vectors for the same
  `delta_T` and `T0`.
- Wrapped phases use the expected state at `(T0 + delta_T) mod T`.

