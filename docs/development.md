# Development

[← Docs index](README.md)

See [Architecture](architecture.md) for how the source is organized.

## Setup

```bash
git clone https://github.com/SnakeyEye497/terraformCost.git
cd terraformCost
npm install
```

Requires Node.js 20.19+ (tested on v22).

## Commands

| Task | Command |
|---|---|
| Build `dist/extension.js` (development) | `npm run compile` |
| Rebuild on every change | `npm run watch` |
| Lint | `npm run lint` |
| Run the test suite (compiles and lints first) | `npm test` |
| Build a `.vsix` package | `npm run vsix` |
| Production bundle only | `npm run package` |
| Run the extension interactively | Press **F5** in VS Code (runs `npm: compile` first) |

VS Code loads the bundle `dist/extension.js` (`"main"` in `package.json`), not the files in `src/` directly, so rebuild after changing code. F5 does this for you.

## Making code changes and seeing them take effect

1. Edit any file under `src/` in your **main** VS Code window (not the Dev Host window).
2. Rebuild the bundle: `npm run compile`, or keep `npm run watch` running in a terminal so it rebuilds on every save.
3. Switch to the **Extension Development Host** window and run **Developer: Reload Window** from the Command Palette (`Ctrl+Shift+P`).
4. The extension reloads with your changes. Alternatively, stop the debug session and press F5 again, which recompiles automatically.

To stop the Dev Host, close that window, or press `Shift+F5` in your main VS Code window.

## Tests

`npm test` downloads a standalone VS Code into `.vscode-test/` on the first run, then runs every `*.test.js` under `test/` inside a real extension host (`test/runTest.js` → `test/suite/index.js`).

| File | Covers |
|---|---|
| `test/suite/extension.test.js` | Parser and calculator basics, package.json, and activation: every declared command is registered, and only those |
| `test/suite/parser.test.js` | HCL parsing |
| `test/suite/cost-calculator.test.js` | Resource coverage, free types, count/for_each, nested plan attributes, Infracost matching |
| `test/suite/module-resolver.test.js` | Local, remote (manifest) and nested modules, module count/for_each, unresolved modules |
| `test/suite/managers.test.js` | Budget/capacity/history files, Slack/Teams payloads and delivery errors, plan parsing |
| `test/suite/ai-and-export.test.js` | AI advisor against a stubbed API, Excel export round-trips |
| `test/suite/billing-integration.test.js` | Billing-period math, provider response parsing, CLI invocation, report output |

Tests never call real external services: `fetch` is stubbed and CLIs are replaced with fake runners. Fixtures live in `test/fixtures/`. See [complex-project](../test/fixtures/complex-project/README.md) for its expected totals.

To launch the Dev Host from a terminal without the VS Code UI (after `npm test` has downloaded VS Code once):

```bash
.vscode-test/vscode-win32-x64-archive-*/Code.exe --extensionDevelopmentPath="$PWD"
```

## CI

`.github/workflows/terraform-cost.yml` runs on every pull request that changes a `.tf` file and posts the cost difference as a PR comment. See [CI: PR cost-diff comments](features/ci-pr-comments.md). Try the same report locally:

```bash
node scripts/ci-cost-report.js test/fixtures/complex-project
```

## Publishing

1. Create a publisher at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage), and make sure its ID matches `"publisher"` in `package.json` (currently `snakeyeye497`).
2. Create an Azure DevOps Personal Access Token at [dev.azure.com](https://dev.azure.com) (**User settings → Personal access tokens**) with **Organization: All accessible organizations** and the **Marketplace → Manage** scope.
3. Run `npx vsce login <publisher-id>` and paste the token when prompted. Never commit or share it.
4. Bump `"version"` in `package.json`, update `CHANGELOG.md`, then run `npx vsce publish`. This runs the production webpack build through `vscode:prepublish`.

Before publishing, check:

- [ ] `npm test` passes and `npm audit` is clean
- [ ] `npm run vsix` builds, and the package installs and activates (`code --install-extension …`)
- [ ] `CHANGELOG.md` has an entry for the new version
