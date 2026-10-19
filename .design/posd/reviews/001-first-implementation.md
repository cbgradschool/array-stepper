# First implementation review

## Intended abstraction

Users paste functions and inspect recorded states. They do not instrument their code or manage Python workers.
`PythonRunner.analyze`, `record`, and `stop` hide startup, message identities, interpreter disposal, cancellation, and timeouts.
The interface selects a snapshot. It does not reconstruct execution from Python source.

## Findings and limits

### Serialized limits are not browser-memory isolation

The recorder limits serialized snapshots to 20 MiB in `tracer.py`.
Parsed JavaScript objects, live Python objects, and a snapshot under construction can use more memory.
This is a medium-impact constraint, not a security boundary.
The worker watchdog handles blocking calls, but it cannot guarantee a hard process-memory limit.
The interface and README restrict the tool to trusted local code.
Revisit isolation before public use with untrusted programs.

### Supported source is intentionally narrower than Python

`_parse` rejects classes, generators, asynchronous functions, decorators, and variadic signatures.
Those restrictions keep synchronous call frames and before-line stepping explicit.
Users whose examples need those features pay the limitation.
The errors name unsupported constructs, and README documents the supported subset.
Whether this scope covers the user's everyday examples remains unobserved.

### Full snapshots trade simplicity for recording size

`record` serializes all visible user frames at each event.
Nested calls repeat caller arrays, so large recursive examples can reach the trace budget before 10,000 events.
Tests show that earlier snapshots survive mutations and that limit stops retain a prefix.
They do not establish throughput for every 1,000-element algorithm.
Keep the current design for small examples. Consider deltas only if real usage repeatedly reaches the budget.

### Resolved red flag: repeated limit policy

An early implementation repeated the execution timeout in Python and the worker controller.
`src/lib/limits.json` now supplies both cooperative and hard limits, along with interface labels.
This removes one source of change amplification when tuning the timeout.
The hard-watchdog browser test exercises the configured five-second limit.

## Principle adherence

These statuses describe concrete implementation evidence, not a forecast of long-term success.

| Principle | Status | Evidence |
| --- | --- | --- |
| Complexity localized | APPLIED | `tracer.py` owns Python semantics. `runner.ts` owns interpreter lifetime. Components consume `TraceStep` values. |
| Deep modules | APPLIED | The runner exposes three operations and hides boot promises, stale messages, partial batches, and termination. |
| Information hiding | APPLIED | Pyodide imports and Python bridge globals remain in the worker. `App.svelte` does not call interpreter APIs. |
| Pull complexity downward | APPLIED | A stopped run returns a `RecordedRun` with its delivered prefix. Views do not merge worker batches. |
| Different layer, different abstraction | APPLIED | The worker converts Python snapshots into messages. The runner converts transport into recordings. The view selects states. |
| Appropriate generality | INTENTIONAL_EXCEPTION | `_parse` limits source constructs for synchronous stepping. Users pay the unsupported-source constraint. Revisit when common examples need excluded syntax. |
| Error semantics | APPLIED | A caught exception remains a step in a successful run. Uncaught errors, limits, and cancellations produce distinct terminal outcomes. |
| Consistency | APPLIED | One selected snapshot supplies highlighting, arrays, locals, and call frames. Limits come from one shared policy file. |
| Documentation clarifies intent | APPLIED | README defines before-line timing, error exits, literal pointer positions, supported syntax, and the trusted-code requirement. |

## Immediate evidence

`npm run check` passed with zero errors and zero warnings.
`npm test` passed 24 tests using the locked Pyodide interpreter and pure view functions.
`npm run test:e2e` passed 10 Chromium tests against a fresh production build.
A separate development-mode browser smoke test returned the expected result without page errors.
`npm audit --omit=dev` reported zero known vulnerabilities. This is not a security audit.

The tests cover these behaviors:

- Actual before-line values and terminal returns.
- Immutable snapshots after swaps, append, pop, and recursive slicing.
- Separate recursive frame identities and caller inspection.
- Function discovery, defaults, extra arguments, and an index parameter before the array parameter.
- Exact large integers and integral floats that cannot become Python index arrows.
- Overlapping pointers, boundary positions, and auxiliary-array selection.
- Caught exceptions, uncaught exceptions, and error exits through `finally`.
- Step, memory, array-size, depth, and elapsed limits.
- A main-thread watchdog stopping native Python work.
- Explicit cancellation, subsequent recovery, and edits invalidating an in-flight run.
- Keyboard playback, local draft reload, and a 390-pixel layout without horizontal document overflow.
- No external browser requests during the default recording flow.

The production output is approximately 14 MiB, including approximately 13 MiB of local Python runtime assets.
Desktop and narrow-screen screenshots were generated and inspected.
The tests do not establish Safari or Firefox compatibility, complete accessibility compliance, or hostile-code isolation.

## Outcomes

Immediate correctness has automated evidence for the cases above.
Long-term maintainability, interface stability, and the adequacy of the source subset remain PENDING.
Runtime changes staying inside their boundary is a design expectation, not an observed long-term outcome.

## Final test

The implementation removes source-rewrite requirements for supported functions, duplicated display inference, and interpreter work during backward replay.
Snapshot memory, transport, and interpreter limits remain implementation costs. Users choose pointer bindings and stay within the supported subset.
The runner hides interpreter startup, worker messages, stale-response handling, cancellation, and hard timeouts.
Repeated unsupported everyday examples, frequent trace limits, or mismatched states across panels would disprove the expected benefits.
