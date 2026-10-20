const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const FILE_NAME = 'terraform.capacity.json';

/**
 * Reads/writes an optional terraform.capacity.json per workspace — the
 * expected real-world load (users, requests/day, growth) a project's
 * resources should be sized against. Mirrors BudgetManager's directory
 * walk-up pattern deliberately, for the same reason: a project may have this
 * file at its root and .tf files nested under it.
 *
 * This is pure config storage; it has no opinion on what "right-sized"
 * means — that reasoning happens in AIAdvisor.getScalingSuggestions().
 */
class CapacityManager {
    constructor() {
        this.cache = new Map(); // folder path -> parsed config
    }

    async loadCapacityForFolder(folderUri) {
        try {
            const filePath = path.join(folderUri.fsPath, FILE_NAME);
            if (!fs.existsSync(filePath)) {
                this.cache.delete(folderUri.fsPath);
                return null;
            }
            const raw = await fs.promises.readFile(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            this.cache.set(folderUri.fsPath, parsed);
            return parsed;
        } catch (err) {
            console.warn('Failed to load terraform.capacity.json for', folderUri.fsPath, err.message);
            this.cache.delete(folderUri.fsPath);
            return null;
        }
    }

    async loadCapacityForFile(filePath) {
        let dir = path.dirname(filePath);
        const workspaceFolders = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) || [];

        while (dir) {
            if (this.cache.has(dir)) return this.cache.get(dir);

            const file = path.join(dir, FILE_NAME);
            if (fs.existsSync(file)) {
                try {
                    const raw = await fs.promises.readFile(file, 'utf8');
                    const parsed = JSON.parse(raw);
                    this.cache.set(dir, parsed);
                    return parsed;
                } catch (err) {
                    console.warn('Failed to parse capacity file', file, err.message);
                    this.cache.delete(dir);
                    return null;
                }
            }

            if (workspaceFolders.includes(dir)) break;
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }

        return null;
    }

    async saveCapacityForFolder(folderUri, config) {
        const filePath = path.join(folderUri.fsPath, FILE_NAME);
        await fs.promises.writeFile(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8');
        this.cache.set(folderUri.fsPath, config);
    }

    clearCache() {
        this.cache.clear();
    }
}

module.exports = CapacityManager;
