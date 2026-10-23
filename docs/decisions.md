# Stage decisions and ownership

The author owns the analysis. Generated code is limited to Action packaging,
PR comments and SARIF formatting, the graph UI and documentation site. Tooling
and a shared presentation interface support those parts. No engine, analysis
CLI, labelled scenarios, benchmark generator or evaluation harness is generated.

## Delivery A: tooling and the boundary

**Decision:** Strict TypeScript, npm with a lockfile, Vitest for delivery tests,
esbuild for the Action and Vite for the viewer.

**Why:** The future engine can run in Node and the browser. A report interface
lets delivery work be exercised without filling in hand-written components.
Adapt this interface when the engine's needs become clear.

`src/report/schema.ts` describes display output, not the typed infrastructure
graph. Resource types, edge evidence, identity and certainty propagation remain
author decisions.

## Delivery B: formatting and the Action

**Decision:** Consume a precomputed report, write Markdown/SARIF, fail for both
possible and definite introduced paths, and reject missing, invalid or demo
reports by default. Write artifacts before failing the path gate.

**Why:** Packaging should not implement diff or silently turn unknowns into a
clean check. Path change classifications must come from the engine.

**Decision:** Node 24 and a committed runtime bundle, `lib/action.cjs`.

**Why:** GitHub needs executable JavaScript at the referenced commit; consumers
should not need to install or compile this repository.

**Decision:** Local files by default, count-only logs, opt-in comments with an
explicit token, no automatic SARIF upload. Comment failures are warnings and
cannot erase a path-gate failure. Bound comment size and escape resource text.

**Why:** Reports reveal infrastructure details. Posting findings is a deliberate
disclosure. Fork PRs often lack write permission; presentation failures should
not change the finding verdict. Each opted-in run creates a new comment;
updating an existing comment is not implemented.

## Delivery C: browser viewer

**Decision:** Display one supplied path at a time, with filters, resource search,
Cytoscape, a textual sequence, explanation and optional engine-supplied suggestion.
Load a synthetic demo only when requested.

**Why:** This works before the engine exists, avoids an unreadable graph of
thousands of resources and provides an accessible alternative to canvas. Filters
select report rows; no analysis graph or path search is implemented here.

**Decision:** Bundle assets locally, read files with browser APIs, use no remote
fonts/CDN/analytics and block network connections in the production CSP.

**Why:** Private reports can be explored locally. Browser Terraform analysis is
pending the author's browser-compatible engine.

Report validation runs with Zod's JIT disabled: its optional dynamic-code probe
would otherwise trigger a CSP violation. This keeps `unsafe-eval` unnecessary.

**Visual revision:** Use a compact security-review workspace: a charcoal
navigation rail, solid neutral panels, crisp borders, restrained status colours
and monospace resource names. Remove the oversized marketing introduction.
Place path selection, the diagram and evidence alongside each other on desktop;
stack them on smaller screens. Keep report controls and counts above the work.

**Why:** The review task needs evidence and resource chains visible together.
Red identifies introduced routes, amber indicates uncertainty and green denotes
removed routes. This is a flat tool interface with no glass, blur, gradients,
decorative shadows or oversized rounded cards. Empty states remain explicit;
synthetic findings load only when requested.

## Delivery D: docs and publishing

**Decision:** A static guide beside the viewer and a manually triggered Pages
workflow that publishes only the viewer build with its synthetic example.

**Why:** No server is needed, status and limits stay visible, and unfinished work
is not published with every push. No Site or hosted service was created here.

**Decision:** No invented evaluation scores or CloudGoat/TerraGoat labels.

**Why:** Independent hand labels and measured misses are this project's evidence.
A presentation demo cannot provide it.

## Next hand-written stages

| Stage | Author's decision | Evidence needed |
| --- | --- | --- |
| 1. Ground truth | Three scenarios, pinned revisions, entry/data targets, compromise assumptions and negative controls | Independent expected chains and prerequisites |
| 2. Plan spike | Produce useful plan JSON without real credentials or deployment | Reproducible offline procedure and recorded unresolved data |
| 3. Graph/parser | Typed nodes, edge evidence, routing, public addressing, security groups, profiles and S3 targets | Fixtures distinguish exposure from reachability |
| 4. BFS/CLI | Path meaning, termination, cycles, caps and explanation of prerequisites | Understandable CLI results and uncertainty |
| 5. IAM subset | Four or five published escalation rules with explicit omitted semantics | Positive/negative examples for each rule |
| 6. Identity/diff | Canonical paths, certainty-change treatment and CLI exit codes | Before/after tests and a delivery report |
| 7. Integration | Wire the real CLI into plan-comparison CI | Introduced findings and analysis errors fail correctly |
| 8. Min-cut | Change cost, mutable attributes and shared attribute-to-edge mapping | All intended paths cut; minimal under the documented model |
| 9. Browser analysis | Worker integration and size limits for the engine | Real plans analysed locally with a responsive UI |
| 10. Evaluation | Matching rules, found/missed/false accounting and benchmark generation | Three labelled scenarios and measured 500/5,000-resource runtime |

Delivery work is intentionally out of the original order so it can be useful
while the author writes the core. The MVP still requires stages 1–6 and a
hand-written evaluation. Delivery tests do not evaluate detection quality.
