const path = require('path');
const fs = require('fs');
const Mocha = require('mocha');

function collectTestFiles(dir) {
	let results = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results = results.concat(collectTestFiles(full));
		} else if (entry.isFile() && entry.name.endsWith('.test.js')) {
			results.push(full);
		}
	}
	return results;
}

function run() {
	const mocha = new Mocha({ ui: 'tdd', color: true });
	const testsRoot = path.resolve(__dirname, '..');

	return new Promise((resolve, reject) => {
		try {
			const files = collectTestFiles(testsRoot);
			files.forEach((f) => mocha.addFile(f));
			mocha.run((failures) => {
				if (failures > 0) {
					reject(new Error(`${failures} tests failed.`));
				} else {
					resolve();
				}
			});
		} catch (err) {
			reject(err);
		}
	});
}

module.exports = { run };
