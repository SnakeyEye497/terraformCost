const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { resolveModuleGraph, parseModuleManifest } = require('./module-resolver');

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
 * Remote module sources (registry, git, etc.) are resolved through the
 * `.terraform/modules/modules.json` manifest `terraform init` writes — their
 * downloaded source is read from `.terraform/modules/...` even though that
 * folder is otherwise excluded from the scan. Without a prior `terraform
 * init`, a resource that lives only inside a remote module simply won't be
 * found (see `unresolvedModules` on the result). Module resolution only
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

        const moduleManifests = await this.loadModuleManifests(parsedByFile);

        let resolvedResources;
        try {
            resolvedResources = resolveModuleGraph(parsedByFile, this.parser, { moduleManifests });
        } catch (err) {
            console.error('Module graph resolution failed:', err);
            resolvedResources = [];
        }
        this.lastUnresolvedModules = resolvedResources.unresolvedModules || [];
        if (this.lastUnresolvedModules.length > 0) {
            console.warn('Workspace scan: modules that could not be resolved (run `terraform init` to download remote modules):',
                this.lastUnresolvedModules);
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

    /**
     * Finds every `.terraform/modules/modules.json` in the workspace, and
     * parses the .tf files of each remote module it lists into
     * parsedByFile (mutated in place).
     *
     * @returns {Promise<Map<string, Map<string, string>>>} root dir -> (module key -> install dir)
     */
    async loadModuleManifests(parsedByFile) {
        const moduleManifests = new Map();
        let manifestUris = [];
        try {
            manifestUris = await vscode.workspace.findFiles('**/.terraform/modules/modules.json', '**/node_modules/**');
        } catch (err) {
            console.warn('Workspace scan: failed to search for module manifests:', err.message);
        }

        for (const uri of manifestUris) {
            try {
                // <root>/.terraform/modules/modules.json -> <root>
                const rootDir = path.dirname(path.dirname(path.dirname(uri.fsPath)));
                const manifest = JSON.parse(await fs.promises.readFile(uri.fsPath, 'utf8'));
                const keyToDir = parseModuleManifest(manifest, rootDir);
                moduleManifests.set(rootDir, keyToDir);

                for (const dir of new Set(keyToDir.values())) {
                    let entries = [];
                    try {
                        entries = await fs.promises.readdir(dir);
                    } catch {
                        continue; // listed in the manifest but not on disk
                    }
                    for (const name of entries.filter((n) => n.endsWith('.tf'))) {
                        const filePath = path.join(dir, name);
                        if (parsedByFile.has(filePath)) continue;
                        const parsed = await this.parser.parse(await fs.promises.readFile(filePath, 'utf8'));
                        parsedByFile.set(filePath, {
                            ...parsed,
                            relPath: vscode.workspace.asRelativePath(filePath, false)
                        });
                    }
                }
            } catch (err) {
                console.warn(`Workspace scan: failed to read module manifest ${uri.fsPath}:`, err.message);
            }
        }

        return moduleManifests;
    }
}

module.exports = WorkspaceScanner;
