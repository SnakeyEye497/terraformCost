const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const FILE_NAME = 'terraform-cost-history.json';
const MAX_ENTRIES = 200; // prevents unbounded growth; oldest entries drop first

/**
 * Reads/appends an optional terraform-cost-history.json per workspace — a
 * plain array of `{ timestamp, scope, label, totalMonthly, currency,
 * resourceCount }` snapshots, recorded explicitly via
 * `Terraform Cost: Record Cost Snapshot` (never automatically — matches the
 * "user-triggered, not automatic" pattern the AI/export features already
 * use, so recording never happens silently on every save).
 *
 * Mirrors BudgetManager/CapacityManager's directory walk-up pattern for
 * reading, for the same reason: a project may have this file at its root
 * and .tf files nested under it. Writing always targets a specific folder
 * (the caller decides which — typically the workspace root) rather than
 * walking up, since there's no ambiguity about where a snapshot "belongs"
 * the way there can be about where to look one up from.
 */
class CostHistoryManager {
    constructor() {
        this.cache = new Map(); // folder path -> parsed history array
    }

    async loadHistoryForFile(filePath) {
        let dir = path.dirname(filePath);
        const workspaceFolders = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) || [];

        while (dir) {
            if (this.cache.has(dir)) return this.cache.get(dir);

            const file = path.join(dir, FILE_NAME);
            if (fs.existsSync(file)) {
                try {
                    const raw = await fs.promises.readFile(file, 'utf8');
                    const parsed = JSON.parse(raw);
                    const history = Array.isArray(parsed) ? parsed : [];
                    this.cache.set(dir, history);
                    return history;
                } catch (err) {
                    console.warn('Failed to parse cost history file', file, err.message);
                    return [];
                }
            }

            if (workspaceFolders.includes(dir)) break;
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }

        return [];
    }

    async appendSnapshot(folderUri, snapshot) {
        const filePath = path.join(folderUri.fsPath, FILE_NAME);
        let history = [];
        if (fs.existsSync(filePath)) {
            try {
                const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
                if (Array.isArray(parsed)) history = parsed;
            } catch (err) {
                console.warn('Failed to parse existing cost history, starting fresh:', err.message);
            }
        }

        history.push(snapshot);
        if (history.length > MAX_ENTRIES) {
            history = history.slice(history.length - MAX_ENTRIES);
        }

        await fs.promises.writeFile(filePath, JSON.stringify(history, null, 2) + '\n', 'utf8');
        this.cache.set(folderUri.fsPath, history);
        return history;
    }

    clearCache() {
        this.cache.clear();
    }
}

module.exports = CostHistoryManager;
