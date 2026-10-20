const path = require('path');

// Deliberately no `require('vscode')` here — this operates purely on
// already-parsed file content the caller hands in, so it's plain-Node
// testable standalone the same way terraform-parser.js and
// cost-calculator.js are.

const MAX_MODULE_DEPTH = 12;
const MAX_MODULE_INSTANCES = 100; // guards against a typo like count = 100000 exploding the scan
const NON_VARIABLE_MODULE_ATTRS = new Set(['source', 'version', 'providers', 'count', 'for_each', 'depends_on']);

function isLocalSource(source) {
    return source.startsWith('./') || source.startsWith('../');
}

/**
 * Parses a `.terraform/modules/modules.json` manifest (written by
 * `terraform init`) into a Map of module key -> absolute install directory.
 * Keys are the dot-joined module call path from the root module, e.g. "vpc"
 * or "app.vpc" — the same shape resolveModuleGraph builds for modulePath.
 *
 * @param {object} manifestJson - parsed modules.json content
 * @param {string} rootDir - absolute path of the directory `terraform init` ran in
 * @returns {Map<string, string>}
 */
function parseModuleManifest(manifestJson, rootDir) {
    const keyToDir = new Map();
    for (const entry of manifestJson?.Modules || []) {
        if (!entry || !entry.Key || typeof entry.Dir !== 'string') continue; // "" is the root module itself
        keyToDir.set(entry.Key, path.resolve(rootDir, entry.Dir));
    }
    return keyToDir;
}

/**
 * How many instances a module block creates: a literal `count`, or the size
 * of a literal `for_each` list/map. Returns null when it's present but can't
 * be evaluated statically (then the module is resolved once, same as before).
 */
function getModuleInstanceKeys(attributes, resolveValue) {
    if (attributes.count !== undefined) {
        const count = resolveValue(attributes.count);
        if (typeof count === 'number' && count >= 0) {
            return Array.from({ length: Math.min(Math.floor(count), MAX_MODULE_INSTANCES) }, (_, i) => `[${i}]`);
        }
        return null;
    }
    if (attributes.for_each !== undefined) {
        const forEach = resolveValue(attributes.for_each);
        if (Array.isArray(forEach)) {
            return forEach.slice(0, MAX_MODULE_INSTANCES).map((k) => `["${k}"]`);
        }
        if (forEach && typeof forEach === 'object' && !forEach._ref && !forEach._function) {
            return Object.keys(forEach).slice(0, MAX_MODULE_INSTANCES).map((k) => `["${k}"]`);
        }
        return null;
    }
    return null;
}

/**
 * Walks `module "x" { source = "..." }` blocks to resolve resources the way
 * real Terraform would: a module's variables come from what its caller
 * passed in (falling back to the module's own `default`), and a module
 * instantiated more than once — via several call sites, or via `count` /
 * `for_each` on the module block — produces one resolved resource set per
 * instance, not one shared/flattened set.
 *
 * Local sources (`./`, `../`) are resolved relative to the caller. Remote
 * sources (registry, git, S3, ...) are resolved through the
 * `.terraform/modules/modules.json` manifest that `terraform init` writes,
 * when the caller supplies one for that root; without it they can't be
 * resolved statically and are reported in `results.unresolvedModules`.
 *
 * Still out of scope: resources that reference a module's *output*, and
 * `each.value` / `count.index` expressions inside a module's arguments.
 *
 * @param {Map<string, {resources, variables, modules, relPath}>} parsedByFile
 *   Absolute file path -> that file's already-parsed content (from
 *   TerraformParser.parse), plus a `relPath` for display purposes. Files
 *   inside remote module install dirs must be included here too.
 * @param {import('./terraform-parser')} parser
 * @param {object} [options]
 * @param {Map<string, Map<string, string>>} [options.moduleManifests]
 *   Root directory -> (module key -> absolute install dir), from parseModuleManifest.
 * @returns {Array<{ resource: object, absPath: string, sourceFile: string, modulePath: string|null }>
 *   & { unresolvedModules: Array<{ modulePath: string, source: string }> }}
 */
function resolveModuleGraph(parsedByFile, parser, options = {}) {
    const moduleManifests = options.moduleManifests || new Map();

    // Terraform treats every .tf file in one directory as a single shared
    // scope, so group files by directory first.
    const filesByDir = new Map(); // dir -> [{ absPath, relPath, parsed }]
    for (const [absPath, parsed] of parsedByFile) {
        const dir = path.dirname(absPath);
        if (!filesByDir.has(dir)) filesByDir.set(dir, []);
        filesByDir.get(dir).push({ absPath, relPath: parsed.relPath, parsed });
    }

    // Find every module call site. Local targets are known up front; remote
    // targets depend on which root they're reached from, so they're looked
    // up in that root's manifest during the walk.
    const callsByDir = new Map(); // callerDir -> [{ name, source, targetDir|null, attributes, overrides }]
    const calledDirs = new Set();

    for (const [absPath, parsed] of parsedByFile) {
        const callerDir = path.dirname(absPath);
        for (const mod of parsed.modules || []) {
            const source = mod.attributes?.source;
            if (typeof source !== 'string') continue;

            let targetDir = null;
            if (isLocalSource(source)) {
                targetDir = path.resolve(callerDir, source);
                if (!filesByDir.has(targetDir)) continue; // target has no .tf files we scanned
                calledDirs.add(targetDir);
            }

            const overrides = {};
            for (const [key, value] of Object.entries(mod.attributes || {})) {
                if (!NON_VARIABLE_MODULE_ATTRS.has(key)) overrides[key] = value;
            }

            if (!callsByDir.has(callerDir)) callsByDir.set(callerDir, []);
            callsByDir.get(callerDir).push({ name: mod.name, source, targetDir, attributes: mod.attributes || {}, overrides });
        }
    }

    // Every installed module directory is a call target, never a root.
    for (const keyToDir of moduleManifests.values()) {
        for (const dir of keyToDir.values()) calledDirs.add(dir);
    }

    // A directory that's never the target of any module call is scanned
    // directly ("root"); a directory that IS a call target is resolved only
    // via its call site(s) — so a module called twice yields two resolved
    // resource sets, and a module is never double-counted against also
    // being scanned as if it were a root.
    const rootDirs = [...filesByDir.keys()].filter((d) => !calledDirs.has(d));

    const results = [];
    const unresolvedModules = [];
    const stack = new Set(); // cycle guard for the current resolution chain

    function resolveDir(dir, overrides, modulePath, manifestKey, rootDir, depth) {
        if (depth > MAX_MODULE_DEPTH) {
            console.warn(`Module resolution: max depth (${MAX_MODULE_DEPTH}) exceeded at ${dir}, stopping.`);
            return;
        }
        if (stack.has(dir)) {
            console.warn(`Module resolution: cycle detected at ${dir}, skipping to avoid infinite recursion.`);
            return;
        }
        stack.add(dir);

        const dirFiles = filesByDir.get(dir) || [];
        const allVariablesInDir = dirFiles.flatMap((f) => f.parsed.variables || []);
        // This directory's fully-merged variable values (its own defaults,
        // overridden by whatever its caller passed in) — used both to
        // resolve its own resources and to resolve any `var.x` passthrough
        // in the overrides it hands to ITS OWN child module calls.
        const ownVariableValues = parser.computeVariableValues(allVariablesInDir, overrides);
        const resolveValue = (value) => (value !== null && typeof value === 'object' && value._ref === 'variable')
            ? ownVariableValues[value.name]
            : value;

        for (const { absPath, relPath, parsed } of dirFiles) {
            if (!parsed.resources || parsed.resources.length === 0) continue;
            // Deep-clone before resolving: the same parsed resource objects
            // would otherwise be mutated in place by resolveVariableReferences,
            // so a second instantiation of this same module would silently
            // inherit the first instantiation's already-resolved values
            // instead of its own overrides.
            const freshResources = parsed.resources.map((r) => structuredClone(r));
            const resolved = parser.resolveVariableReferences(freshResources, [], ownVariableValues);
            for (const resource of resolved) {
                results.push({ resource, absPath, sourceFile: relPath, modulePath });
            }
        }

        for (const call of callsByDir.get(dir) || []) {
            const childKey = manifestKey ? `${manifestKey}.${call.name}` : call.name;
            const targetDir = call.targetDir || moduleManifests.get(rootDir)?.get(childKey) || null;
            const childBasePath = modulePath ? `${modulePath}.${call.name}` : call.name;

            if (!targetDir || !filesByDir.has(targetDir)) {
                unresolvedModules.push({ modulePath: childBasePath, source: call.source });
                continue;
            }

            // Resolve `foo = var.bar`-style passthrough in the call's own
            // overrides against THIS directory's variable values, so a
            // caller can forward its own variable straight into a child
            // module rather than only ever passing literals.
            const resolvedCallOverrides = {};
            for (const [key, value] of Object.entries(call.overrides)) {
                resolvedCallOverrides[key] = resolveValue(value);
            }

            const instanceKeys = getModuleInstanceKeys(call.attributes, resolveValue) || [''];
            for (const instanceKey of instanceKeys) {
                resolveDir(targetDir, resolvedCallOverrides, `${childBasePath}${instanceKey}`, childKey, rootDir, depth + 1);
            }
        }

        stack.delete(dir);
    }

    for (const dir of rootDirs) {
        resolveDir(dir, {}, null, null, dir, 0);
    }

    results.unresolvedModules = unresolvedModules;
    return results;
}

module.exports = { resolveModuleGraph, parseModuleManifest };
