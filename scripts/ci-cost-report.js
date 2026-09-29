#!/usr/bin/env node
/**
 * Headless CLI cost calculator — reuses the extension's real
 * src/terraform-parser.js + src/cost-calculator.js (not a reimplementation)
 * outside the VS Code extension host, for use in CI (GitHub Actions PR
 * cost-diff comments — see .github/workflows/terraform-cost.yml).
 *
 * Both modules only touch `vscode.workspace.getConfiguration(...).get(key,
 * default)` — never any other vscode API — as long as
 * TerraformCostCalculator.initialize() is never called (which would also
 * try to shell out to a real `infracost` binary). So a minimal stub
 * returning the caller's own default for every config key is enough to run
 * them standalone; this is the same approach used to verify
 * test-fixtures/complex-project's numbers.
 *
 * Usage: node scripts/ci-cost-report.js [directory]  (defaults to cwd)
 * Output: a single JSON object on stdout — { totalMonthly, resourceCount,
 * fileCount, byProvider: {aws: 123.45, ...} }
 */
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request) {
    if (request === 'vscode') {
        return {
            workspace: {
                getConfiguration: () => ({ get: (key, def) => def })
            }
        };
    }
    return originalLoad.apply(this, arguments);
};

const fs = require('fs');
const path = require('path');
const TerraformParser = require('../src/terraform-parser');
const TerraformCostCalculator = require('../src/cost-calculator');

const SKIP_DIRS = new Set(['node_modules', '.terraform', '.git', '.vscode-test']);

function findTfFiles(dir, results = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return results;
    }
    for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            findTfFiles(full, results);
        } else if (entry.name.endsWith('.tf')) {
            results.push(full);
        }
    }
    return results;
}

async function calculateTotal(rootDir) {
    const parser = new TerraformParser();
    const calculator = new TerraformCostCalculator();
    // Deliberately not calling calculator.initialize() — keeps this.infracost
    // null (so pricing always falls through to the built-in fallback tables,
    // same as a Dev Host run with no Infracost configured) and avoids trying
    // to shell out to a real `infracost` binary that won't exist in CI.

    const files = findTfFiles(rootDir);
    let totalMonthly = 0;
    let resourceCount = 0;
    const byProvider = {};

    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        const parsed = await parser.parse(text);
        if (!parsed.resources || parsed.resources.length === 0) continue;

        const resolved = parser.resolveVariableReferences(parsed.resources, parsed.variables);
        for (const resource of resolved) {
            try {
                const cost = await calculator.calculateResourceCost(resource, file);
                totalMonthly += cost.monthly || 0;
                resourceCount++;
                const provider = resource.provider || 'unknown';
                byProvider[provider] = (byProvider[provider] || 0) + (cost.monthly || 0);
            } catch (err) {
                console.error(`Failed to cost ${resource.type}.${resource.name} in ${file}: ${err.message}`);
            }
        }
    }

    return {
        totalMonthly: Number(totalMonthly.toFixed(2)),
        resourceCount,
        fileCount: files.length,
        byProvider: Object.fromEntries(
            Object.entries(byProvider).map(([k, v]) => [k, Number(v.toFixed(2))])
        )
    };
}

async function main() {
    const rootDir = path.resolve(process.argv[2] || process.cwd());
    if (!fs.existsSync(rootDir)) {
        console.error(`Directory not found: ${rootDir}`);
        process.exit(1);
    }
    const result = await calculateTotal(rootDir);
    console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
