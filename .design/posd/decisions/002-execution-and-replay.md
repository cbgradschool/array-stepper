# Execution and replay boundaries

Status: implemented and tested. The user approved implementation after the interview. See `../reviews/001-first-implementation.md` for immediate evidence and remaining limits.

## Problem and complexity

The editor, arrows, variables, and call stack must agree on one execution point. Python can mutate arrays, recurse, throw exceptions, or never finish. Reconstructing behavior separately in each panel would duplicate timing and scope rules.

## Alternatives

AST instrumentation can capture expression-level details, but it rewrites user code and adds risks around evaluation order and side effects. CPython tracing preserves source execution and supplies line, frame, return, and exception events. Use CPython tracing because explanations and expression stepping are out of scope. Built-ins and library calls remain single operations.

Delta traces reduce repeated data, but replay needs reconstruction and checkpoints. Full snapshots allow direct backward navigation. Use full snapshots with limits for this small-example tool. Revisit this choice if common examples reach the memory budget.

A shared long-lived Python interpreter starts quickly, but user code can modify global interpreter state. Reuse the worker for source analysis and its next run, then discard it after execution. Each run uses a fresh namespace. Terminate the worker on cancellation or a hard timeout.

## Ownership

- `src/lib/limits.json` owns the shared execution policy used by the interpreter and host watchdog.
- `src/lib/tracer.py` owns source analysis, Python call semantics, scope capture, immutable value snapshots, and cooperative limits.
- `src/lib/python.worker.ts` owns Pyodide loading and message transport.
- `src/lib/runner.ts` owns worker lifecycle, request identity, cancellation, hard timeouts, and partial trace retention.
- `src/lib/trace-view.ts` owns display-value rules and selection within a snapshot.
- `src/App.svelte` owns the draft, selected execution step, and playback controls. It does not infer Python execution from source.

## Implementation defaults

These defaults resolve open interview branches without adding product requirements.

- Serve the npm-locked Pyodide files locally. No CDN or remote execution service is required.
- Use synchronous, undecorated top-level functions with fixed parameters. Reject unsupported syntax explicitly. Discover parameters with Python AST parsing, without executing user source.
- Accept JSON argument fields. Empty optional fields use Python defaults. Preserve large integers by parsing input text in Python, not JavaScript.
- Allow one flat numeric input list, plus scalar arguments. Show other values as bounded summaries without calling user-defined `repr` methods.
- Limit runs to 10,000 events, five seconds after startup, and 20 MiB of serialized snapshots. Limit lists to 1,000 elements and call depth to 64 for visualization. These limits are provisional.
- Send snapshots in small batches. A hard termination retains the prefix already delivered to the main thread, not an undelivered worker buffer.
- A line event shows state before execution. Return, exception, and error-exit events are labeled separately. CPython error unwinding is not presented as a successful `return None`. Only an uncaught exception makes a run fail.
- Default to the active call frame. Permit inspection of its callers, without changing the active execution line. Select arrays within the inspected frame and store pointer bindings per function and array name.
- Show literal index positions. Values below zero and at or beyond the array length stay visible in boundary lanes. Do not clamp or wrap arrows. This display does not change Python negative indexing.
- Use a dark two-column desktop layout inspired by the supplied screenshot. Stack the panels on narrow screens. Omit explanations.
- Offer forward/backward steps, start/end, play/pause, a speed selector, and a timeline. Respect reduced-motion preferences.
- Save only the editable draft locally. Do not save recordings or create a history interface. Storage failures must not prevent use.
- This is a trusted-code local tool, not a security sandbox. A Web Worker protects interface responsiveness, not the browser origin from hostile code. Import restrictions and tracing limits are not a security boundary.

## Principle adherence and evidence

- Information hiding: APPLIED. Pyodide initialization and bridge globals stay inside `python.worker.ts`; the interface uses recordings from `runner.ts`.
- Design it twice: APPLIED. Instrumentation/tracing, deltas/snapshots, and shared/fresh interpreters were compared above.
- Pull complexity downward: APPLIED. The runner retains partial traces and handles cancellation once, instead of requiring each panel to handle worker messages. Browser tests exercise stopping native Python work and subsequent recovery.
- Appropriate generality: INTENTIONAL_EXCEPTION. The engine rejects asynchronous functions and generators. Users needing those features pay the limitation. Revisit when real array examples require them.

## Expected outcomes

Recorded states must not change after later array mutations. Recursive frames must retain distinct identities. An old worker response must never restore an invalidated run. A blocking Python call must not prevent the Stop button from working. The Python/view and browser suites pass these immediate cases. See the implementation review for the tested scenarios. Long-term maintainability remains unobserved.

## Final test

The design removes duplicated execution inference and live reverse execution. Snapshot memory, worker lifecycle, and scope identity remain implementation responsibilities. The runner hides interpreter and cancellation mechanics from the views. Repeated unsupported everyday examples, slow recording, or mismatched panel states would disprove the expected benefits.
