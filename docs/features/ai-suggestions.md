# AI cost & scaling suggestions

[← Docs index](../README.md)

## AI cost optimization

An "✨ AI cost optimization suggestions" card in the dashboard (and the `Terraform Cost: Get AI Cost Optimization Suggestions` command) sends the active file's resources + calculated costs to a user-chosen LLM and asks for concrete, resource-specific suggestions — rightsizing, reserved instances/savings plans, storage tier changes, architecture swaps (e.g. NAT Gateway → VPC endpoint) — each with an estimated monthly saving where the model can reasonably infer one.

**Setup:**
1. Run `Terraform Cost: Set AI Provider API Key`, pick **Gemini**, **Claude**, or **GPT**, and paste your key. This also sets `terraformCost.ai.provider` to match. Keys are stored via VS Code's `SecretStorage`, not in `settings.json`.
2. Run `Terraform Cost: Get AI Cost Optimization Suggestions` (or click "✨ Ask AI for suggestions" in the dashboard).

**Design notes:**
- **Explicitly user-triggered, never automatic** — it doesn't fire on every keystroke or file save, so it never silently burns API quota/cost.
- **Follows the dashboard's current scope** — analyzes the active file when the dashboard is in file scope, or every resource across the whole workspace when it's in workspace scope (no separate toggle to remember; whatever charts you're looking at is what gets analyzed). Workspace-scope calls cap at the 150 highest-cost resources to avoid silently blowing past a provider's context window on a very large project, and note the truncation in the prompt when it happens. Each suggestion is tagged with its source file (looked up from the original resource list, not trusted from the model's own response) so a workspace-wide suggestion is actually actionable — you know which file to go edit.
- **Provider-agnostic**: `src/integrations/ai-advisor.js` has one thin adapter per API shape (`fetch` calls to Gemini's `generateContent`, Anthropic's Messages API, and one shared OpenAI-compatible chat-completions adapter reused by OpenAI, DeepSeek, and Groq — no SDKs, keeps the extension small) behind a single `getSuggestions()` interface.
- **Defensive response parsing**: the model is asked to return strict JSON; if it doesn't, the raw text is still surfaced as a single suggestion rather than silently failing.
- Rendered suggestions are HTML-escaped in the webview before display, since they're untrusted model output.

## Capacity & scaling

A separate "📈 Capacity & scaling suggestions" card asks a different question than cost: *given this resource is a `t3.medium`, and I expect 50k requests/day and 500 concurrent users, is that the right size?* It reasons about under-provisioning (bottleneck risk) as well as over-provisioning (paying for headroom nobody uses).

**Setup:**
1. Run `Terraform Cost: Set Capacity & Scaling Inputs` (or click **Set capacity inputs** in the dashboard card). A short wizard asks for expected daily users, requests/day, peak requests/second, and expected growth %/month — all optional, leave any blank to skip. Saved to `terraform.capacity.json` at the workspace root (same directory-walk-up pattern as `terraform.budget.json`).
2. Run `Terraform Cost: Get Scaling Suggestions` (or click **Get scaling suggestions** in the dashboard). Uses the same AI provider/key as cost suggestions — no separate setup.

Example `terraform.capacity.json`:
```json
{
  "expected_users": 5000,
  "requests_per_day": 200000,
  "peak_requests_per_second": 50,
  "growth_rate_percent": 10
}
```

**Design notes:**
- **AI-required, deliberately no hardcoded sizing tables.** A hand-maintained "a `t3.medium` handles ~X req/s" lookup table would hit the exact same staleness problem the AI model-id defaults already did (see `src/integrations/ai-advisor.js`'s comments) — except with no live endpoint to catch it drifting. Letting the model reason over the numbers, clearly framed as a rough estimate, was judged more honest than a lookup table with false authority.
- Same explicitly-user-triggered, dashboard-scope-following behavior as cost suggestions (see above) — follows file, workspace, or a loaded plan, whichever the dashboard currently shows.
- Response shape mirrors cost suggestions but with `action: "scale_up" | "scale_down" | "keep"` and `suggestedChange` instead of `category`/`estimatedMonthlySavings` — see `buildScalingPrompt` / `parseScalingSuggestions` in `src/integrations/ai-advisor.js`.
