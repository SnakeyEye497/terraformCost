const vscode = require('vscode');
const { resolveModuleGraph } = require('./module-resolver');

/**
 * Discovers every .tf file in the workspace (not just the active editor),
 * resolves resources the way real Terraform would — following local
 * `module "x" { source = "./..." }` calls, so a module's variables come from
 * what its caller passed in (not just the module's own default) and a
 * module instantiated more than once produces one resolved resource set per
 * call site — then costs every resource. This is the data source for the
 * dashboard's "Whole workspace" scope.
 *
 * The actual graph-walking lives in module-resolver.js (pure, no vscode
 * dependency, standalone-testable); this class is just the vscode-facing
 * shell around it — finding files and reading their content through the
 * workspace API rather than raw fs, so it respects unsaved editor buffers
 * and multi-root workspaces the way live scanning should.
 *
 * Only remote module sources (registry, git, etc. — anything not starting
 * with `./` or `../`) fall outside what's resolved; a resource that lives
 * only inside such a module simply won't be found. Module resolution only
 * applies here, at workspace scope — single-file scope inherently has no
 * "caller" to consult for override values, so it keeps resolving each
 * file's own variables from their own defaults, as before.
 */
class WorkspaceScanner {
    /**
     * @param {import('./terraform-parser')} parser
     * @param {import('./cost-calculator')} calculator
     */
    constructor(parser, calculator) {
        this.parser = parser;
        this.calculator = calculator;
    }

    /**
     * @returns {Promise<Array<{ resource: object, cost: object, sourceFile: string, modulePath: string|null }>>}
     */
    async scan() {
        const uris = await vscode.workspace.findFiles(
            '**/*.tf',
            '{**/.terraform/**,**/node_modules/**,**/.vscode-test/**,**/.git/**}'
        );

        // Parse every file up front — the module-graph walk needs to see
        // every file's module blocks before it can tell which directories
        // are "root" vs. a module's target.
        const parsedByFile = new Map(); // absolute fsPath -> parsed content + relPath
        for (const uri of uris) {
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                const parsed = await this.parser.parse(doc.getText());
                parsedByFile.set(uri.fsPath, {
                    ...parsed,
                    relPath: vscode.workspace.asRelativePath(uri, false)
                });
            } catch (err) {
                console.warn(`Workspace scan: failed to read/parse ${uri.fsPath}:`, err.message);
            }
        }

        let resolvedResources;
        try {
            resolvedResources = resolveModuleGraph(parsedByFile, this.parser);
        } catch (err) {
            console.error('Module graph resolution failed:', err);
            resolvedResources = [];
        }

        const results = [];
        for (const { resource, absPath, sourceFile, modulePath } of resolvedResources) {
            try {
                const cost = await this.calculator.calculateResourceCost(resource, absPath);
                results.push({ resource, cost, sourceFile, modulePath, line: resource.line || 0 });
            } catch (err) {
                console.error(`Error calculating cost for ${resource.type}.${resource.name} in ${sourceFile}:`, err);
            }
        }

        return results;
    }
}

module.exports = WorkspaceScanner;
