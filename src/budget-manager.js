const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

class BudgetManager {
    constructor() {
        // cache budgets by folder path
        this.budgets = new Map();
        // track notifications already shown per file to avoid spam: filePath -> lastLevel
        this.notified = new Map();
    }

    async loadBudgetForFolder(folderUri) {
        try {
            const filePath = path.join(folderUri.fsPath, 'terraform.budget.json');
            if (!fs.existsSync(filePath)) {
                this.budgets.delete(folderUri.fsPath);
                return null;
            }

            const raw = await fs.promises.readFile(filePath, 'utf8');
            const parsed = JSON.parse(raw);

            // Normalize numeric values
            const normalized = {
                final_limit: Number(parsed.final_limit || parsed.finalLimit || 0),
                limit_1: Number(parsed.limit_1 || parsed.limit1 || 0),
                limit_2: Number(parsed.limit_2 || parsed.limit2 || 0),
                limit_3: Number(parsed.limit_3 || parsed.limit3 || 0)
            };

            this.budgets.set(folderUri.fsPath, normalized);
            return normalized;
        } catch (err) {
            console.warn('Failed to load terraform.budget.json for', folderUri.fsPath, err.message);
            this.budgets.delete(folderUri.fsPath);
            return null;
        }
    }

    async loadBudgetForFile(filePath) {
        // Walk up directories from filePath to workspace root(s) looking for terraform.budget.json
        let dir = path.dirname(filePath);
        const workspaceFolders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];

        while (dir) {
            // If cached, return
            if (this.budgets.has(dir)) return this.budgets.get(dir);

            const budgetFile = path.join(dir, 'terraform.budget.json');
            if (fs.existsSync(budgetFile)) {
                try {
                    const raw = await fs.promises.readFile(budgetFile, 'utf8');
                    const parsed = JSON.parse(raw);
                    const normalized = {
                        final_limit: Number(parsed.final_limit || parsed.finalLimit || 0),
                        limit_1: Number(parsed.limit_1 || parsed.limit1 || 0),
                        limit_2: Number(parsed.limit_2 || parsed.limit2 || 0),
                        limit_3: Number(parsed.limit_3 || parsed.limit3 || 0),
                        __source: budgetFile
                    };

                    this.budgets.set(dir, normalized);
                    return normalized;
                } catch (err) {
                    console.warn('Failed to parse budget file', budgetFile, err.message);
                    this.budgets.delete(dir);
                    return null;
                }
            }

            // Stop at workspace root(s)
            if (workspaceFolders.includes(dir)) break;

            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }

        return null;
    }

    clearCache() {
        this.budgets.clear();
        this.notified.clear();
    }

    getNotificationLevelForFile(filePath) {
        return this.notified.get(filePath) || 0;
    }

    setNotificationLevelForFile(filePath, level) {
        this.notified.set(filePath, level);
    }
}

module.exports = BudgetManager;
