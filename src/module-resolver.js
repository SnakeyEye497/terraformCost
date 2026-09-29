const path = require('path');

// Deliberately no `require('vscode')` here — this operates purely on
// already-parsed file content the caller hands in, so it's plain-Node
// testable standalone the same way terraform-parser.js and
// cost-calculator.js are.

const MAX_MODULE_DEPTH = 12;
const NON_VARIABLE_MODULE_ATTRS = new Set(['source', 'version', 'providers', 'count', 'for_each']);

/**
 * Walks local `module "x" { source = "./..." }` blocks to resolve resources
 * the way real Terraform would: a module's variables come from what its
 * caller passed in (falling back to the module's own `default`), and a
 * module instantiated more than once produces one resolved resource set per
 * call site — not one shared/flattened set.
 *
 * Deliberately out of scope: remote sources (registry, git, S3, etc. —
 * anything not starting with `./` or `../`), `count`/`for_each` on a module
 * block itself, and resources that reference a module's *output* (only
 * input variables passed into a module are handled).
 *
 * @param {Map<string, {resources, variables, modules, relPath}>} parsedByFile
 *   Absolute file path -> that file's already-parsed content (from
 *   TerraformParser.parse), plus a `relPath` for display purposes.
 * @param {import('./terraform-parser')} parser
 * @returns {Array<{ resource: object, absPath: string, sourceFile: string, modulePath: string|null }>}
 */
function resolveModuleGraph(parsedByFile, parser) {
    // Terraform treats every .tf file in one directory as a single shared
    // scope, so group files by directory first.
    const filesByDir = new Map(); // dir -> [{ absPath, relPath, parsed }]
    for (const [absPath, parsed] of parsedByFile) {
        const dir = path.dirname(absPath);
        if (!filesByDir.has(dir)) filesByDir.set(dir, []);
        filesByDir.get(dir).push({ absPath, relPath: parsed.relPath, parsed });
    }

    // Find every local module call site and which directory it targets.
    const callsByDir = new Map(); // callerDir -> [{ name, targetDir, overrides }]
    const calledDirs = new Set();

    for (const [absPath, parsed] of parsedByFile) {
        const callerDir = path.dirname(absPath);
        for (const mod of parsed.modules || []) {
            const source = mod.attributes?.source;
            if (typeof source !== 'string' || !(source.startsWith('./') || source.startsWith('../'))) {
                continue; // registry/git/other remote sources: not resolvable statically, skip
            }
            const targetDir = path.resolve(callerDir, source);
            if (!filesByDir.has(targetDir)) continue; // target has no .tf files we scanned

            const overrides = {};
            for (const [key, value] of Object.entries(mod.attributes || {})) {
                if (!NON_VARIABLE_MODULE_ATTRS.has(key)) overrides[key] = value;
            }

            if (!callsByDir.has(callerDir)) callsByDir.set(callerDir, []);
            callsByDir.get(callerDir).push({ name: mod.name, targetDir, overrides });
            calledDirs.add(targetDir);
        }
    }

    // A directory that's never the target of any module call is scanned
    // directly ("root"); a directory that IS a call target is resolved only
    // via its call site(s) — so a module called twice yields two resolved
    // resource sets, and a module is never double-counted against also
    // being scanned as if it were a root.
    const rootDirs = [...filesByDir.keys()].filter((d) => !calledDirs.has(d));

    const results = [];
    const stack = new Set(); // cycle guard for the current resolution chain

    function resolveDir(dir, overrides, modulePath, depth) {
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
            // Resolve `foo = var.bar`-style passthrough in the call's own
            // overrides against THIS directory's variable values, so a
            // caller can forward its own variable straight into a child
            // module rather than only ever passing literals.
            const resolvedCallOverrides = {};
            for (const [key, value] of Object.entries(call.overrides)) {
                resolvedCallOverrides[key] = (value !== null && typeof value === 'object' && value._ref === 'variable')
                    ? ownVariableValues[value.name]
                    : value;
            }
            const childPath = modulePath ? `${modulePath}.${call.name}` : call.name;
            resolveDir(call.targetDir, resolvedCallOverrides, childPath, depth + 1);
        }

        stack.delete(dir);
    }

    for (const dir of rootDirs) {
        resolveDir(dir, {}, null, 0);
    }

    return results;
}

module.exports = { resolveModuleGraph };
