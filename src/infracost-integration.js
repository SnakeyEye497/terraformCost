const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const vscode = require('vscode');

const execAsync = promisify(exec);

class InfracostIntegration {
    constructor() {
        this.infracostPath = 'infracost';
        this.cacheDir = null;
        this.apiKey = null;
        this.cliHasApiKey = false; // key configured in the CLI itself (`infracost auth login` / `configure set`)
        this.isAvailable = false;
        this.lastCheck = null;
        this.checkInterval = 5 * 60 * 1000; // 5 minutes
    }
    
    async promptForApiKey() {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Infracost API Key',
            placeHolder: 'ico-xxxxxxxxxxxxxxxxxxxxx',
            password: true, // Masks the input
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value) return 'API key is required';
                if (!value.startsWith('ico-')) return 'Invalid Infracost API key format';
                return null;
            }
        });

        if (apiKey) {
            // Save to global settings
            const config = vscode.workspace.getConfiguration('terraformCost');
            await config.update('infracostApiKey', apiKey, vscode.ConfigurationTarget.Global);

            this.apiKey = apiKey;
            vscode.window.showInformationMessage('✅ Infracost API key saved!');
        }
    }

    async initialize(context) {
        this.cacheDir = context.globalStorageUri.fsPath;
        await fs.mkdir(this.cacheDir, { recursive: true }).catch(() => {});

        const config = vscode.workspace.getConfiguration('terraformCost');
        this.apiKey = config.get('infracostApiKey');

        // Check if Infracost is available
        this.isAvailable = await this.checkInfracostInstalled();

        if (!this.isAvailable) {
            console.log('Infracost CLI not available, will use fallback pricing');
        } else {
            console.log('Infracost CLI detected and ready');
            if (!this.apiKey) {
                this.cliHasApiKey = await this.checkCliApiKey();
            }
        }

        // Offer to configure a key only when the CLI is actually installed
        // (otherwise a key alone can't be used) and has no key of its own,
        // only if the user hasn't already dismissed this offer, and never
        // awaited: activation must not block on a notification the user may
        // simply ignore.
        const promptDismissedKey = 'terraformCost.infracostKeyPromptDismissed';
        if (this.isAvailable && !this.hasApiKey() && config.get('useInfracost', true) &&
            !context.globalState.get(promptDismissedKey)) {
            vscode.window.showInformationMessage(
                'Infracost CLI detected but no API key is configured. Add one for accurate cloud pricing.',
                'Enter API Key',
                'Get Free Key',
                'Use Fallback Pricing'
            ).then(async (action) => {
                if (action === 'Enter API Key') {
                    await this.promptForApiKey();
                } else if (action === 'Get Free Key') {
                    vscode.env.openExternal(vscode.Uri.parse('https://www.infracost.io/docs/#quick-start'));
                } else if (action === 'Use Fallback Pricing') {
                    await context.globalState.update(promptDismissedKey, true);
                }
            });
        }

        return this.isAvailable;
    }

    hasApiKey() {
        return !!this.apiKey || this.cliHasApiKey;
    }

    async checkCliApiKey() {
        try {
            const { stdout } = await execAsync('infracost configure get api_key', { timeout: 5000 });
            return /ico-\S+/.test(stdout);
        } catch {
            return false;
        }
    }

    async checkInfracostInstalled() {
        // Rate limit checks
        if (this.lastCheck && Date.now() - this.lastCheck < this.checkInterval) {
            return this.isAvailable;
        }

        try {
            const { stdout } = await execAsync('infracost --version', { timeout: 5000 });
            this.lastCheck = Date.now();
            this.isAvailable = true;
            console.log('Infracost version:', stdout.trim());
            return true;
        } catch (error) {
            this.lastCheck = Date.now();
            this.isAvailable = false;
            return false;
        }
    }

    async calculateCostsWithInfracost(terraformPath) {
        if (!this.isAvailable || !this.hasApiKey()) {
            return null;
        }

        try {
            const tempDir = path.join(this.cacheDir, 'infracost-temp');
            await fs.mkdir(tempDir, { recursive: true });

            const outputPath = path.join(tempDir, `infracost-${Date.now()}.json`);

            const env = {
                ...process.env,
                INFRACOST_LOG_LEVEL: 'error',
                INFRACOST_SKIP_UPDATE_CHECK: 'true'
            };
            if (this.apiKey) env.INFRACOST_API_KEY = this.apiKey; // otherwise the CLI's own configured key is used

            // Check if path is a file or directory
            const stats = await fs.stat(terraformPath).catch(() => null);
            if (!stats) {
                console.error('Path does not exist:', terraformPath);
                return null;
            }

            const targetPath = stats.isDirectory() ? terraformPath : path.dirname(terraformPath);

            const command = `infracost breakdown --path "${targetPath}" --format json --out-file "${outputPath}"`;
            
            console.log('Running Infracost for:', targetPath);
            
            await execAsync(command, {
                env,
                timeout: 60000, // 60 second timeout
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer
            });

            // Read and parse the output
            const outputData = await fs.readFile(outputPath, 'utf8');
            const infracostData = JSON.parse(outputData);

            // Clean up temp file
            await fs.unlink(outputPath).catch(() => {});

            return this.parseInfracostOutput(infracostData);

        } catch (error) {
            console.error('Infracost calculation failed:', error.message);
            
            if (error.code === 'ENOENT') {
                this.isAvailable = false;
            }
            
            return null;
        }
    }

    parseInfracostOutput(infracostData) {
        try {
            const resources = [];
            let totalMonthlyCost = 0;

            // Handle different Infracost output versions
            const projects = infracostData.projects || [];
            
            for (const project of projects) {
                const breakdown = project.breakdown;
                if (!breakdown || !breakdown.resources) continue;

                totalMonthlyCost += parseFloat(breakdown.totalMonthlyCost || 0);

                for (const resource of breakdown.resources) {
                    const parsedResource = this.parseResource(resource);
                    if (parsedResource) {
                        resources.push(parsedResource);
                    }
                }
            }

            // Fallback to top-level totalMonthlyCost
            if (totalMonthlyCost === 0 && infracostData.totalMonthlyCost) {
                totalMonthlyCost = parseFloat(infracostData.totalMonthlyCost);
            }

            return {
                resources,
                totalMonthlyCost,
                totalHourlyCost: totalMonthlyCost / 730, // Average hours per month
                totalYearlyCost: totalMonthlyCost * 12,
                currency: infracostData.currency || 'USD',
                timeGenerated: infracostData.timeGenerated || new Date().toISOString(),
                version: infracostData.version
            };

        } catch (error) {
            console.error('Error parsing Infracost output:', error);
            return null;
        }
    }

    parseResource(infracostResource) {
        try {
            const monthlyCost = parseFloat(infracostResource.monthlyCost || 0);
            const hourlyCost = parseFloat(infracostResource.hourlyCost || monthlyCost / 730);

            const breakdown = [];
            
            // Parse cost components
            if (infracostResource.costComponents) {
                for (const component of infracostResource.costComponents) {
                    const componentCost = parseFloat(component.monthlyCost || 0);
                    if (componentCost > 0) {
                        const name = component.name || 'Unknown component';
                        breakdown.push(`${name}: $${componentCost.toFixed(2)}/mo`);
                    }
                }
            }

            // Parse subresources
            if (infracostResource.subresources) {
                for (const subresource of infracostResource.subresources) {
                    const subCost = parseFloat(subresource.monthlyCost || 0);
                    if (subCost > 0) {
                        const name = subresource.name || 'Subresource';
                        breakdown.push(`${name}: $${subCost.toFixed(2)}/mo`);
                    }
                }
            }

            // If no breakdown, add total
            if (breakdown.length === 0 && monthlyCost > 0) {
                breakdown.push(`Total: $${monthlyCost.toFixed(2)}/mo`);
            }

            return {
                name: infracostResource.name || 'unknown',
                type: infracostResource.resourceType || 'unknown',
                metadata: infracostResource.metadata || {},
                cost: {
                    hourly: hourlyCost,
                    monthly: monthlyCost,
                    yearly: monthlyCost * 12,
                    currency: 'USD',
                    breakdown,
                    source: 'infracost'
                },
                tags: infracostResource.tags || {},
                location: infracostResource.metadata?.region || null
            };

        } catch (error) {
            console.error('Error parsing resource:', error);
            return null;
        }
    }

    async calculateCostsForFile(filePath) {
        if (!this.isAvailable) {
            return null;
        }

        try {
            const stats = await fs.stat(filePath);
            const targetPath = stats.isDirectory() ? filePath : path.dirname(filePath);
            return await this.calculateCostsWithInfracost(targetPath);
        } catch (error) {
            console.error('File access error:', error);
            return null;
        }
    }

    async quickBreakdown(workspaceRoot) {
        // Optimized for quick estimates
        if (!this.isAvailable || !this.hasApiKey()) {
            return null;
        }

        try {
            const env = {
                ...process.env,
                INFRACOST_LOG_LEVEL: 'error',
                INFRACOST_SKIP_UPDATE_CHECK: 'true'
            };
            if (this.apiKey) env.INFRACOST_API_KEY = this.apiKey;

            // Use --format json for structured output
            const command = `infracost breakdown --path "${workspaceRoot}" --format json`;
            
            const { stdout } = await execAsync(command, { 
                env,
                timeout: 30000,
                maxBuffer: 5 * 1024 * 1024
            });

            const infracostData = JSON.parse(stdout);
            return this.parseInfracostOutput(infracostData);

        } catch (error) {
            console.error('Quick breakdown failed:', error.message);
            return null;
        }
    }

    async validateApiKey() {
        if (!this.apiKey) return false;
        
        try {
            const env = {
                ...process.env,
                INFRACOST_API_KEY: this.apiKey
            };

            await execAsync('infracost configure get api_key', { 
                env, 
                timeout: 5000 
            });
            return true;
        } catch (error) {
            return false;
        }
    }

    getStatus() {
        return {
            available: this.isAvailable,
            hasApiKey: this.hasApiKey(),
            lastCheck: this.lastCheck
        };
    }

    async setApiKey(apiKey) {
        this.apiKey = apiKey;
        const config = vscode.workspace.getConfiguration('terraformCost');
        await config.update('infracostApiKey', apiKey, vscode.ConfigurationTarget.Global);
        
        // Validate immediately
        const isValid = await this.validateApiKey();
        if (!isValid) {
            throw new Error('Invalid Infracost API key');
        }
    }

    dispose() {
        // Cleanup temp files if needed
        if (this.cacheDir) {
            const tempDir = path.join(this.cacheDir, 'infracost-temp');
            fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }


    
}

module.exports = InfracostIntegration;