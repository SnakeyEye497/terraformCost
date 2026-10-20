# Module-graph resolution

[← Docs index](../README.md)

Workspace scope doesn't just flatten every file's resources into one list — `src/core/module-resolver.js` follows `module "x" { source = "..." }` calls the way real Terraform does:

- A module's variables come from what its caller actually passed in (`instance_type = "m5.xlarge"` in the `module` block), falling back to the module's own `default` only if the caller didn't pass one.
- A module instantiated **more than once** — e.g. `module "prod" { source = "./modules/app", instance_type = "m5.xlarge" }` and `module "dev" { source = "./modules/app", instance_type = "t3.micro" }` — produces **two independently-resolved resource sets**, not one shared/flattened one. (This needed a specific fix: the naive approach mutates parsed resource objects in place, so a second instantiation would silently inherit the first's already-resolved values — module-resolver.js deep-clones before resolving each instantiation to avoid that.)
- A caller can forward its own variable straight into a child module (`foo = var.bar`) and it resolves correctly against the caller's own scope.
- Nested modules (a module that itself calls further modules) work, with a cycle guard and a depth limit (12) against a module accidentally referencing itself.
- **`count` / `for_each` on a module block** instantiates it once per instance (`workers[0]`, `workers[1]`, `regional["eu"]`, …). This works for literal values and for values passed through `var.x`; `count = 0` removes the module.
- **Remote sources** (Terraform Registry, git, S3, …) are resolved through the `.terraform/modules/modules.json` manifest that `terraform init` (or `terraform get`) writes. The downloaded module source in `.terraform/modules/` is read even though that folder is otherwise excluded from scanning.
- Each resolved resource is tagged with a `modulePath` (e.g. `app.compute` for a nested call) shown throughout the dashboard, export, and AI suggestions alongside — or in place of — the source file.

**Limits**: a remote module that hasn't been downloaded yet (no `terraform init`) can't be resolved and is logged as unresolved rather than silently dropped. Expressions inside modules (`local.*`, conditionals, `each.value`) aren't evaluated. For a project that leans on those, load a real [`terraform` plan](plan-costing.md) instead, because Terraform's own plan engine has already resolved all of it.

**Verification**: `src/core/module-resolver.js` has no `vscode` dependency, so it is unit-tested in `test/suite/module-resolver.test.js`. The tests cover overrides, multiple call sites, var passthrough, module `count`/`for_each` (including `count = 0`), remote and nested-remote modules via a manifest, unresolved remote modules, and roots-vs-modules. It was also run against the real `terraform-aws-modules/vpc/aws` 5.13.0 registry module downloaded with `terraform get`. All 77 of the module's resources resolved through the manifest, alongside a local module with `count = 2`.
