const path = require('path');
const cp = require('child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

// NOTE: We do not use @vscode/test-electron's own runTests() helper here.
// On Windows it spawns Code.exe with `shell: true` but does not quote the
// args array, so any path containing a space (e.g. a user profile like
// "C:\Users\First Last\...") gets split into bogus arguments and VS Code
// fails to start. Spawning directly with shell:false avoids that bug, since
// Node quotes argv correctly for Windows by default in that mode.
async function main() {
	try {
		const extensionDevelopmentPath = path.resolve(__dirname, '..');
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		const vscodeExecutablePath = await downloadAndUnzipVSCode();

		// Isolated user-data/extensions dirs so this headless test instance
		// never collides with any other running VS Code (including the real
		// editor this script itself might be running inside) — without this,
		// VS Code refuses to start a second instance sharing the default
		// profile ("only supported if no other instance of Code is running").
		const userDataDir = path.resolve(__dirname, '..', '.vscode-test', 'user-data');
		const extensionsDir = path.resolve(__dirname, '..', '.vscode-test', 'extensions');

		const args = [
			'--no-sandbox',
			'--disable-gpu-sandbox',
			'--disable-updates',
			'--skip-welcome',
			'--skip-release-notes',
			'--disable-workspace-trust',
			`--user-data-dir=${userDataDir}`,
			`--extensions-dir=${extensionsDir}`,
			`--extensionTestsPath=${extensionTestsPath}`,
			`--extensionDevelopmentPath=${extensionDevelopmentPath}`,
		];

		// Strip ELECTRON_RUN_AS_NODE: when this script itself runs inside a
		// VS Code / Electron host (e.g. under Claude Code's own extension
		// host), that var is inherited by child processes and makes the
		// spawned Code.exe boot as plain Node instead of launching VS Code.
		const childEnv = { ...process.env };
		delete childEnv.ELECTRON_RUN_AS_NODE;

		const exitCode = await new Promise((resolve, reject) => {
			const cmd = cp.spawn(vscodeExecutablePath, args, { stdio: 'inherit', env: childEnv });
			cmd.on('error', reject);
			cmd.on('close', (code) => resolve(code));
		});

		if (exitCode !== 0) {
			console.error(`Tests failed with exit code ${exitCode}`);
			process.exit(exitCode ?? 1);
		}
	} catch (err) {
		console.error('Failed to run tests');
		console.error(err);
		process.exit(1);
	}
}

main();
