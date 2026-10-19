# Array visualizer v1 — implementation interview

Status: Interview complete. The user approved implementation. The first working version is built and tested. Implementation choices are recorded in `002-execution-and-replay.md`, with evidence in `../reviews/001-first-implementation.md`.

## Problem and constraints

Build an interactive Python algorithm visualizer using the supplied screenshot as the starting reference. Users must be able to paste their own code, not merely change the input to a built-in algorithm. The repository was empty when the interview began.

## Accepted decisions

1. Initially visualize array-based Python algorithms, not trees, graphs, or linked lists.
2. Accept a pasted function with inputs supplied separately, rather than requiring a complete script with a call site.
3. Support one array argument plus simple scalar arguments, such as a number or boolean.
4. Let the user choose which variables appear as array-index arrows. Suggest conventional names such as `left`, `right`, `mid`, `i`, and `j`; allow correction without editing Python. Other variables remain visible in the variables panel.
5. Step at executed source-line granularity, not whole-loop granularity. The highlighted line is about to execute; variables and arrows represent the state before that line runs.
6. Execute Python locally in the browser using Pyodide in a Web Worker. Code and inputs are not sent to an execution server. The runtime's initial download is an accepted tradeoff.
7. Record execution states once and replay them for forward/backward stepping and timeline navigation, rather than maintaining a live paused interpreter. Changes to code or input require a new run. Editing runtime variables mid-execution is out of scope.
8. Support algorithms that modify the array, including sorting and reversing. Display updated values and highlight changed cells after an executed line. Recorded states must preserve historical array contents so backward navigation restores the earlier values.
9. Support changes to array length, including `append`, `pop`, and `insert`. Reflect the actual array length in each recorded state. Keep out-of-range pointer positions visible rather than hiding or clamping them; the implementation uses labeled boundary lanes and preserves literal index values.
10. Support pasted helper functions and recursion. Show the active function's variables and a small call-stack view to distinguish local variables belonging to separate calls.
11. Default the diagram to the active function's array argument, not always the original input. Clearly label the selected array and provide a selector for other available arrays. Show one expanded array at a time.
12. Omit the explanation panel and explanation generation from v1. The user explicitly excluded this feature; neither trace-derived prose nor AI reasoning is required.
13. Support flat arrays of integers and decimal numbers. Permit negatives, duplicates, and empty arrays; do not enforce inferred algorithm-specific preconditions. Strings and nested arrays/matrices are out of scope for v1 visualization.
14. No third-party Python packages in v1. Support built-ins and common algorithm-related standard-library modules such as `math`, `bisect`, `heapq`, `collections`, and `typing`. Package installation is out of scope; supported imports and runtime restrictions are documented in `README.md`.
15. Use Nix and direnv for a project-local development environment, following `/Users/samueljoli/development/uc_berkeley_dsa`. Implemented `flake.nix`, `flake.lock`, `.envrc`, and `.gitignore`. Reuse that project's pinned nixpkgs revision and four-system dev-shell pattern. The shell supplies Node.js 24/npm, git, and direnv rather than copying Python/uv dependencies that the browser app does not currently need. `.envrc` uses `use flake`; it does not install application packages automatically. The frontend stack is specified in decision 20.
16. Preserve available recorded steps when execution fails or reaches a limit. Allow replay of the captured trace, clearly mark the run as incomplete, and show the error and failing line when available. Hard termination preserves the prefix already delivered by the worker; the implementation documents the possible loss of an undelivered batch.
17. Optimize v1 for small learning/debugging examples rather than large inputs or long-running algorithms. Initial run limits are 10,000 recorded steps or 5 seconds of execution, whichever is reached first; Python runtime startup time does not count toward execution time. Preserve captured steps on a limit stop. Treat these as provisional defaults to validate and adjust through performance testing; the implementation also limits serialized snapshots to 20 MiB.
18. Editing source code or inputs stops playback and immediately clears the current recording. Require a new Run before displaying execution states for the edited code/inputs. Previous-run history and comparison are out of scope for v1.
19. Build v1 as a local-first, single-user web app launched from the Nix/direnv environment. No accounts or backend. Preserve compatibility with static hosting, but defer public deployment until the visualizer works correctly.
20. Use Svelte + TypeScript + Vite. The user explicitly selected Svelte instead of the proposed React stack. The implementation uses a client-side Vite build without a full-stack framework.
21. Use CodeMirror 6 for a focused Python editor with syntax highlighting, line numbers, indentation, and execution-line highlighting. Autocomplete and live type checking are deferred; execution errors remain visible when running code.
22. Offer a dropdown of functions defined in the pasted source so the user can select the entry function. Generate input fields from the selected function's parameters. Automatically select the function when there is only one; do not require special names such as `main` or `solve`.

## Complexity to manage

- Cognitive load: users should not have to rewrite Python or understand instrumentation to get a visualization.
- Unknown unknowns: a numeric variable is not necessarily an index; inference must remain correctable.
- Change amplification: runtime tracing details must not be duplicated across code highlighting, variable rendering, and playback.
- Temporal consistency: all panels must show the same execution point, with an explicit before-line convention.
- Recording introduces resource limits and snapshot correctness requirements. The implementation centralizes execution policy in `src/lib/limits.json`.

## Information ownership

- The Python execution/recording boundary owns interpreter integration and conversion into replayable states.
- A recorded run owns the code and inputs that produced it.
- Playback selects an execution state; visual panels consume that same state rather than independently reconstructing execution.
- Pointer bindings own the user's interpretation of variables as array indices.

`002-execution-and-replay.md` maps these responsibilities to implementation files. The review records concrete evidence separately from long-term outcomes.

## Material alternatives considered

### Scope

- Fixed algorithm with editable input: simpler, but fails the user's need to paste code.
- Pasted Python with array-focused visualization: selected.
- General-purpose automatic visualization of arbitrary data structures: deferred to avoid requiring universal structure inference.

### Execution location

- Browser Pyodide worker: selected; avoids an execution backend and keeps code local, at the cost of runtime download and browser resource constraints.
- Server Python: offers broader package support, but adds deployment and untrusted-code isolation responsibilities.

### Execution control

- Record then replay: selected; makes backward navigation a state-selection operation. Requires bounded recording and accurate snapshots.
- Live debugger: enables mid-execution inspection and modification, but adds pause/resume coordination and makes backward navigation substantially harder.

### Pointer identification

- Fully automatic inference: convenient but risks treating values as indices.
- User-controlled bindings with suggestions: selected; introduces a small configuration task rather than presenting guesses as facts.

### Frontend stack

- React + TypeScript + Vite: proposed for coordinating the editor, playback, and visualization panels without a backend framework.
- Svelte + TypeScript + Vite: selected at the user's request, preserving TypeScript and the Vite-based local/static build. No comparative maintainability or performance outcome has been measured.

## Principle rationale

These statuses concern the accepted decisions and their current implementation. Long-term outcomes remain separate.

| Principle | Status | Evidence / rationale |
| --- | --- | --- |
| Design it twice | APPLIED | Browser/server and recorded/live approaches were compared explicitly before selection. |
| Make essential complexity explicit | APPLIED | Pointer interpretation remains user-correctable; before-line timing is explicit. |
| General-purpose within reason | APPLIED | Pasted functions and scalar parameters support more than the screenshot's algorithm while limiting visualization to arrays. |
| Information hiding | APPLIED | `python.worker.ts` owns Pyodide integration. Views receive recordings through `runner.ts`, not interpreter handles. |
| Deep modules | APPLIED | The runner exposes analysis, recording, and stopping while hiding startup, partial batches, stale messages, and hard timeouts. |

## Expected outcomes and evidence plan

Immediate verification: 24 Python/view tests and 10 production-build browser tests passed. Type checks reported zero errors or warnings. Long-term maintainability outcomes remain PENDING.

**Environment verification:** `nix flake check --no-build` passed for the host (`aarch64-darwin`); other systems were not checked. `direnv allow .` and `direnv exec .` successfully loaded the shell. Verified Node.js `v24.21.0`, npm `11.19.0`, git, and direnv resolve from the Nix store.

- A function such as `binary_search(array, target)` should run without being rewritten into a special visualization API.
- Selecting an earlier recorded step should restore exactly its values without rerunning Python.
- Code highlighting, variables, and arrows should agree on the same before-line execution state.
- Changing pointer bindings should not require modifying source code.
- Runtime tracing changes should remain inside the execution/recording boundary rather than require changes in every visual panel.

Tests cover the immediate behavior of representative functions. Future change containment and interface stability still need real usage evidence.

## Implementation defaults and remaining limits

The implementation resolves frame selection, argument discovery, pointer bindings, memory limits, playback, and draft storage as recorded in decision 002.
The dark two-column layout follows the screenshot without its explanation panel. Narrow screens use stacked panels.

Chromium browser tests cover execution and responsive layout. Safari, Firefox, and complete accessibility compliance remain unverified.
The supported Python subset and resource limits are documented in README. The user later approved a GitHub Pages workflow in decision 003. Actual remote deployment remains pending.

## Revisit triggers

Revisit the scope or runtime if actual examples require non-array visualizations, unsupported packages, large traces, or interactive variable editing. Revisit pointer suggestions if correcting them becomes a recurring burden.

## Design accountability

1. **What complexity was removed?** The chosen scope avoids an execution server, live debugger coordination, and universal data-structure visualization.
2. **What remains, and who pays for it?** The implementation must handle tracing, snapshots, cancellation, and resource limits. Users confirm pointer interpretations and rerun after edits.
3. **What knowledge should be hidden?** Interpreter integration and trace mechanics should stay behind the execution/recording boundary; this remains an implementation goal.
4. **What would disprove the expected benefit?** Repeated source rewrites, incorrect replay states, pervasive runtime knowledge in UI components, or frequent unsupported everyday array algorithms would show the design needs revision.
