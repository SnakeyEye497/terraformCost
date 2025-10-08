const vscode = require('vscode');

class ErrorHandler {
    constructor() {
        this.errorCount = 0;
        this.maxErrors = 10;
        this.errorLog = [];
    }

    async handleError(error, context = '', userMessage = null) {
        this.errorCount++;
        
        const errorInfo = {
            timestamp: new Date().toISOString(),
            context,
            message: error.message,
            stack: error.stack
        };
        
        this.errorLog.push(errorInfo);
        console.error(`[${context}] Error:`, error);

        // Show user-friendly message
        if (userMessage) {
            if (this.errorCount <= 3) {
                vscode.window.showErrorMessage(userMessage);
            }
        }

        // If too many errors, suggest disabling
        if (this.errorCount >= this.maxErrors) {
            const action = await vscode.window.showWarningMessage(
                'Terraform Cost Calculator is experiencing issues. Disable for this session?',
                'Disable',
                'Keep Enabled'
            );

            if (action === 'Disable') {
                const config = vscode.workspace.getConfiguration('terraformCost');
                await config.update('enabled', false, vscode.ConfigurationTarget.Workspace);
            }

            this.errorCount = 0; // Reset counter
        }

        return null;
    }

    async handleFileError(error, filePath) {
        return this.handleError(
            error,
            `File: ${filePath}`,
            `Failed to process file: ${filePath}`
        );
    }

    async handleParseError(error, content) {
        return this.handleError(
            error,
            'Terraform Parser',
            'Failed to parse Terraform file. Check syntax.'
        );
    }

    async handleInfracostError(error) {
        console.warn('Infracost error, falling back to default pricing:', error.message);
        
        if (error.message.includes('ENOENT')) {
            vscode.window.showWarningMessage(
                'Infracost CLI not found. Install from https://www.infracost.io or disable in settings.'
            );
        } else if (error.message.includes('API key')) {
            vscode.window.showWarningMessage(
                'Invalid Infracost API key. Get a free key at https://www.infracost.io'
            );
        }
        
        return null;
    }

    async handleNetworkError(error) {
        return this.handleError(
            error,
            'Network',
            'Network error. Using cached/fallback pricing.'
        );
    }

    getErrorLog() {
        return this.errorLog;
    }

    clearErrorLog() {
        this.errorLog = [];
        this.errorCount = 0;
    }

    async exportErrorLog() {
        try {
            const logContent = JSON.stringify(this.errorLog, null, 2);
            const doc = await vscode.workspace.openTextDocument({
                content: logContent,
                language: 'json'
            });
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            console.error('Failed to export error log:', error);
        }
    }
}

module.exports = ErrorHandler;