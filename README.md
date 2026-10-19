# Array Stepper

Paste a Python function and replay its execution beside an array diagram.
The app uses Svelte, TypeScript, CodeMirror 6, and Pyodide.
Python runs in a browser worker, not on a server.

## Run locally

Nix supplies Node.js 24, npm, Git, and direnv.
The flake follows the environment in `../uc_berkeley_dsa` and uses the same pinned nixpkgs revision.

```sh
direnv allow
npm ci
npm run dev
```

Open the local URL printed by Vite, usually `http://127.0.0.1:5173`.
If your shell does not load direnv automatically, use `direnv exec . npm run dev`.
You can also use `nix develop` to enter the environment manually.

The development command copies the locked Python runtime into `public/pyodide/`.
The browser loads these files from the local server.
The app does not need a CDN, an API key, a Python installation, or a backend.

## Use the visualizer

1. Paste your functions into the source editor, or load an example.
2. Select the function to run.
3. Enter one numeric array and any scalar arguments as JSON.
4. Select **Record run**.
5. Use the playback controls to inspect each step.
6. Open **Index pointers** to choose which variables become arrows.

Use JSON values such as `[5, 6, 7, 1, 2, 3, 4]`, `9`, `true`, `"text"`, or `null`.
Leave an optional input empty to use its Python default.
An empty array is valid input, but your function can reject it.

The highlighted line is about to execute.
The array and variables show their values before that line.
Return, exception, and error-exit snapshots are labeled separately.
A handled exception does not make the recording fail.

The rotated-maximum example expects a rotated, strictly increasing array.
The binary-search example expects an ascending sorted array.
The app does not enforce these algorithm-specific conditions.

The diagram follows the active function call.
Select a call-stack entry to inspect a caller, or select another array in that frame.
The execution highlight continues to identify the active call, even when you inspect a caller.

Arrows use literal index positions.
Negative values appear in the left boundary lane, and values beyond the array appear in the right lane.
The arrow label keeps the actual value. This display does not change Python negative indexing.
Overlapping pointers stack above the same cell.

Arrow keys move backward or forward when focus is outside an input or the code editor.
Space starts or pauses playback. Command+Enter or Control+Enter records a run.
Editing the source, entry function, or inputs stops playback and clears the old recording.

The app saves the current source, entry function, and input text in this browser's local storage.
It does not save recordings or provide run history.
Pointer selections remain available during the current page session.

## Supported Python

Use synchronous, undecorated functions with fixed parameters.
Helper functions, recursion, numeric array mutation, insertion, deletion, and slicing are supported.
Function defaults and top-level constants must be literal values.
The entry function accepts exactly one numeric list and any additional scalar arguments.
Helpers can receive more than one list.

The diagram supports flat numeric lists, including negative numbers, decimals, and duplicates.
Strings, tuples, dictionaries, sets, and other objects do not get separate diagrams.
Container variables use bounded summaries, and the recorder does not call user-defined representation methods.
Large Python integers keep their exact text within the recorder's display-size limit.

Supported imports are `math`, `bisect`, `heapq`, `collections`, `functools`, `itertools`, `operator`, `statistics`, `typing`, and `random`.
Third-party packages, classes, decorators, asynchronous functions, `*args`, and `**kwargs` are not supported.
Generator functions and generator expressions in pasted source are also excluded.
The app reports these limits instead of silently showing a different algorithm.

Stepping follows executed Python source lines, not individual expressions.
Several statements on one source line remain one line-level operation.
A built-in or library call such as `array.sort()` runs as one operation.
Write the algorithm's loops in your pasted source to inspect their internal steps.

## Execution limits

The recording stops at the first applicable limit:

- 10,000 recorded events.
- 5 seconds of execution, excluding Python startup.
- 20 MiB of serialized snapshots.
- 1,000 elements per list.
- 64 active user-function calls.
- 100 local variables per call.
- 50,000 source characters.

`src/lib/limits.json` owns these provisional limits.
The Python recorder and the browser watchdog use the same policy.
A stopped or failed run retains its captured steps.
A hard timeout or Stop preserves the prefix already received from the worker, not an undelivered batch.
Captured output is limited to 4,096 characters. A hard termination can lose buffered output.

Run only code that you trust.
This tool is not a security sandbox.
A worker keeps ordinary Python execution off the interface thread, but it does not isolate hostile code from the browser origin.
Import restrictions and recording limits are not security controls or a hard limit on total browser memory.
The app itself does not upload source code or inputs.

## Tests and production build

The Python tests use the same npm-locked Pyodide interpreter as the app.
The browser tests use the production build rather than a mocked interpreter.

```sh
npm run check
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm run preview
```

The build writes a static site to `dist/`, including the Python runtime.
The Vite base path is relative, so the build can be served from a subdirectory.
Serve it over HTTP. Do not open `index.html` directly through `file://`.
The GitHub Pages workflow publishes this same static build.

Chromium is covered by browser tests.
The layout supports narrow screens and honors reduced-motion preferences.
Safari and Firefox compatibility remain unverified.

## Publish to GitHub Pages

`.github/workflows/pages.yml` builds, tests, and publishes the site on pushes to `main`.
You can also run it manually from the Actions tab with `main` selected.
Only the deploy job receives permission to publish.
The workflow uses Node.js 24 without changing the local Nix/direnv environment.

Create an empty GitHub repository first. A public repository supports Pages on GitHub Free.
If this project is not yet a Git repository, run these commands from its directory:

```sh
git init -b main
git add .
git status --short
```

Review the staged files before publishing them.
The ignore rules exclude dependencies, generated runtime files, builds, and test artifacts.
Replace `YOUR_USERNAME` and `YOUR_REPOSITORY` below with your GitHub details:

```sh
git commit -m "Add Array Stepper and GitHub Pages deployment"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

Then complete the GitHub setup:

1. Open the repository's Settings → Pages.
2. Under Build and deployment, set Source to GitHub Actions.
3. Open Actions → Deploy GitHub Pages.
4. Select Run workflow with the `main` branch.
5. Open the site URL from the completed Publish site job.

The first push can start a workflow before Pages is enabled.
If that deployment fails, enable Pages and run the workflow again.
Later pushes to `main` deploy automatically after the tests pass.
If you use a different deployment branch, update both branch references in `.github/workflows/pages.yml`.

A project site normally appears at `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/`.
The existing `base: './'` keeps asset paths relative, so no repository name belongs in `vite.config.ts`.
The browser tests include a static repository-subdirectory test with real Python execution and no special isolation headers.

The workflow runs `npm ci`, type checks, Python/view tests, and Chromium browser tests.
The browser-test command runs `npm run build` through its Playwright server configuration.
The workflow uploads the tested `dist/`, including Pyodide, without rebuilding it or committing build files.
GitHub supplies the deployment token. No personal access token or extra repository secret is required.
The actions are pinned to specific commits with version comments for reviewable updates.

Publishing the site does not turn it into a security sandbox.
Visitors must still run only trusted Python code.
Project sites under the same `USERNAME.github.io` hostname share a browser origin, which is a browser permission boundary.
Different repository paths do not isolate hostile code from other sites on that origin.

The workflow follows the [Vite deployment guide](https://vite.dev/guide/static-deploy.html#github-pages)
and [GitHub's custom Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Code layout

- `src/lib/tracer.py` owns source analysis and Python snapshots.
- `src/lib/python.worker.ts` loads the local runtime and sends trace batches.
- `src/lib/runner.ts` owns worker lifetime, cancellation, and hard timeouts.
- `src/lib/trace-view.ts` owns snapshot display rules.
- `src/App.svelte` coordinates editing, frame selection, and playback.
- `src/components/` contains the code editor and array diagram.
- `.design/posd/decisions/` records the agreed scope and implementation choices.

The screenshot supplied during planning guides the dark, two-panel layout.
The explanation panel is intentionally omitted.
