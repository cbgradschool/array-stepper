# Project guidance

Use the Nix/direnv environment for commands. If the shell does not load it, prefix commands with `direnv exec .`.

Read `.design/posd/decisions/001-array-visualizer-v1.md` and `002-execution-and-replay.md` before changing the scope or execution model.

Keep these contracts stable:

- Execute the pasted Python. Do not replace it with a predefined algorithm or inferred simulation.
- A line snapshot shows values before that line executes. Label return and exception exits separately.
- Record immutable states and replay them. Do not rerun Python when navigating backward.
- Keep worker lifecycle and hard timeouts inside `src/lib/runner.ts`.
- Keep execution policy in `src/lib/limits.json`.
- Clear the recording when source code or input changes. Ignore stale worker responses.
- Preserve delivered snapshots on errors, limits, and cancellation.
- Treat pasted code as trusted local code. Do not describe this tool as a security sandbox.
- Do not add an explanation panel, a backend, or React.

Before finishing a code change, run `npm run check`, `npm test`, and the relevant browser tests.
Use `npm run test:e2e` for the full production-build browser suite.
Do not commit generated runtime files, `node_modules`, `dist`, or test artifacts.
