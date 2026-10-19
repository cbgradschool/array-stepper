# GitHub Pages deployment

Status: authorized workflow implementation. An actual GitHub deployment remains pending.
This decision follows the user's request to add automated publishing after the first implementation passed its tests.
It replaces the earlier decision to defer static public hosting. It does not change Python execution or trust requirements.

## Problem and complexity

Publish the static application without a backend or manual build commits.
Avoid separate asset-path rules for local development, a repository path, and the Python worker.
Keep publishing credentials out of the build that runs dependency scripts.

## Alternatives

A `gh-pages` branch can hold generated files, but users must keep source and build commits synchronized.
A Pages Actions workflow can build from the lockfile, test the result, and publish an artifact without changing repository contents.
Use the workflow and keep generated files ignored.

A hardcoded Vite base such as `/dca_visualizer/` handles one repository path.
The existing relative base works without repository-specific configuration.
Keep it and test actual Python execution from an arbitrary subdirectory.

Installing Nix in CI would mirror the local toolchain more closely, but adds another bootstrap and cache layer.
Use `setup-node` with Node.js 24 for the hosted workflow, as approved in the deployment discussion.
Local development still uses the pinned Nix environment. CI and local Node patch versions can differ.

## Ownership and decision

- `.github/workflows/pages.yml` owns triggers, permissions, validation, artifact upload, and deployment ordering.
- Existing npm commands own the build and test steps. The workflow uploads the exact build exercised by Playwright.
- `vite.config.ts` keeps relative asset URLs. No application or worker URL code changes are required.
- `tests/browser/pages.spec.ts` checks repository-path hosting without SPA fallback or isolation headers.
- README owns the one-time GitHub repository and Pages setup instructions.

Build and deployment use separate jobs. The build has read-only repository access and no persisted checkout credentials.
Only the deploy job receives `pages: write` and `id-token: write`.
All actions use verified commit pins. Deployments are serialized, and manual runs outside `main` cannot publish.
No Git repository, remote, GitHub repository, or public site is created by adding these local files.

## Principle rationale

Information hiding: APPLIED. Hosting-specific orchestration lives in the workflow rather than application panels or Python tracing code.
Design it twice: APPLIED. Generated-branch publishing and artifact publishing were compared, as were fixed and relative asset paths.
Consistency: APPLIED. The workflow uses the existing npm test/build entry points and Node.js 24.
Define avoidable errors out of existence: APPLIED. `needs: build` gates deployment, and the uploaded artifact is the tested output.

These choices are not evidence of successful remote deployment or long-term maintenance outcomes.

## Tradeoffs and evidence plan

GitHub account settings and environment protections remain owner responsibilities.
Public hosting still serves a trusted-code tool, not an untrusted-code sandbox.
Repository paths under one Pages hostname share an origin. Revisit isolation before accepting untrusted code.

Local verification passed: actionlint 1.7.12 reported no workflow errors, type checks reported zero errors or warnings, and all 24 Python/view tests passed.
All 11 production browser tests passed, including the new repository-path test.
That test loaded the UI, worker, and WASM under `/repository-name-test/`, returned the expected result, and exercised home navigation and reload.
It also confirmed that the test host needed no cross-origin isolation headers and that asset requests stayed under the repository prefix.

Action commit pins were resolved from the official repositories' version tags through the GitHub API.
The Linux build has not run on GitHub yet. A live Actions run remains necessary to establish hosted-runner compatibility, account permissions, and publication behavior.

## Final test

The workflow removes manual generated-file publishing and repository-name edits in application code.
GitHub setup, action-pin maintenance, and hosting limits remain owner responsibilities.
The workflow hides deployment mechanics behind a successful push to `main`.
Subpath asset failures, failing hosted builds, or repeated manual deployment fixes would disprove the expected benefit.
