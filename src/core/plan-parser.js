const TerraformParser = require('./terraform-parser');

/**
 * Turns `terraform show -json <planfile>` output into the same
 * { type, name, provider, attributes } resource shape TerraformParser
 * produces from static HCL — so TerraformCostCalculator.calculateResourceCost()
 * can cost either one without caring which path a resource came from.
 *
 * This is the accurate alternative to static parsing: Terraform's own plan
 * engine has already fully evaluated every `var.x`, `count`/`for_each`,
 * conditional, and function call by the time this JSON exists, so
 * attributes here are always plain resolved values — never the
 * `{ _ref: 'variable', ... }` placeholders the static parser has to leave
 * behind for anything it can't evaluate itself.
 *
 * Only resources that will actually exist *after* this plan applies are
 * included — a pure delete (`change.after === null`) contributes nothing to
 * the post-apply cost, so it's excluded; everything else (create, update,
 * no-op) is.
 */

/**
 * @param {object} planJson - parsed `terraform show -json` output
 * @returns {Array<{ type: string, name: string, provider: string, attributes: object, moduleAddress: string|null }>}
 */
function extractResourcesFromPlan(planJson) {
    if (!planJson || !Array.isArray(planJson.resource_changes)) {
        throw new Error("This doesn't look like `terraform show -json` output (no resource_changes array found).");
    }

    const resources = [];

    for (const change of planJson.resource_changes) {
        if (change.mode !== 'managed') continue; // skip data sources
        const after = change.change?.after;
        if (after === null || after === undefined) continue; // pure delete: won't exist post-apply

        resources.push({
            type: change.type,
            name: change.name,
            provider: TerraformParser.getProviderFromResourceType(change.type),
            attributes: after,
            moduleAddress: change.module_address || null
        });
    }

    return resources;
}

/**
 * @param {object} planJson
 * @returns {{ terraformVersion: string|null, resourceCount: number }}
 */
function getPlanMetadata(planJson) {
    return {
        terraformVersion: planJson?.terraform_version || null,
        resourceCount: Array.isArray(planJson?.resource_changes) ? planJson.resource_changes.length : 0
    };
}

module.exports = { extractResourcesFromPlan, getPlanMetadata };
