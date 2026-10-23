# IaC Attack Path Checker

Compare base and head Terraform plans **offline** and fail CI when a change adds a possible route from the internet to AWS data. The same TypeScript engine runs in a CLI, a GitHub Action and a browser worker. No AI or ML is used.

```text
Internet → SecurityGroup → Instance → Role → Bucket
```

The checker explains the prerequisites and computes the smallest set of supported rule, policy-statement or profile edits that intersects every introduced path. One edit is enough for the common failure: newly public ingress on an instance with a role that can read S3.

This is a working, deliberately bounded security model, not a complete AWS authorization evaluator. See [limits](docs/limits.md) and [measured evaluation](docs/evaluation.md). A reachable server still needs an exploit or stolen credentials. Such chains are **possible**, and fail the gate by default.

## Run

Node 24 or later; Node 24 is the Action runtime.

```sh
npm ci
npm run analyze -- --base fixtures/terraform-generated/base.json \
  --head fixtures/terraform-generated/head.json
# Expected exit 1: one introduced path; minimum cut is the public ingress rule.

npm run analyze -- --base base.json --head head.json --out-dir iac-report
npm run build:cli
node dist/cli.cjs --help
```

Inputs are JSON from `terraform show -json`, **not HCL or state files**. Without `--base`, the CLI compares head against empty infrastructure. `--no-fail` writes findings without exit 1; invalid or incomplete analysis still exits 2. `--json` writes machine-readable output to stdout. Local artifacts are `report.json`, `report.md`, `report.sarif` and `graph.json`.

| Exit | Meaning |
| --- | --- |
| 0 | No introduced paths, or explicit `--no-fail` |
| 1 | Introduced paths, including possible ones |
| 2 | Invalid input, failed analysis or an exceeded search/minimum-edit limit |

For a credential-free example, `npm run spike` initializes the locked AWS provider and generates base/head plans in `examples/offline`. Initialization downloads provider binaries; the plans use placeholders, no data sources, no refresh and no real AWS credentials. The engine itself needs no Terraform binary, credentials or network access. [Spike details](docs/offline-plan.md).

## Browser

```sh
npm run dev
# Or: npm run build:viewer && npx vite preview --host 127.0.0.1
```

Choose base/head plan files and **Analyze plans**, or **Load demo** to analyze a normalized CloudGoat SSRF example. The base is optional. The cancellable worker keeps the UI responsive. You can also open a precomputed report, inspect path evidence and the minimum edit set, filter findings, and export JSON/Markdown/SARIF.

Scripts, styles and Cytoscape are bundled locally. There are no analytics, CDN fonts or backend uploads. Production CSP blocks network connections. Inputs stay in memory until cleared, cancelled or the tab closes. The initial static site assets still have to be served/downloaded. [GitHub Pages setup](docs/action.md#github-pages).

## GitHub Action

After your trusted planning job has produced both JSON files:

```yaml
- name: Check introduced attack paths
  id: paths
  uses: nanda-kumudhan/iac-attack-path@main # Pin a reviewed commit for real use.
  with:
    base-plan: base.json
    head-plan: head.json
    output-directory: iac-report
```

The committed `lib/action.cjs` runs without installing dependencies. The Action writes reports before failing, and logs counts by default. PR comments require `post-comment: 'true'`, a token and `pull-requests: write`. Publishing comments or uploading SARIF sends resource details to GitHub. A precomputed `report-file` remains supported. [Full integration and SARIF](docs/action.md).

The repository CI runs engine/delivery tests and the Action against real Terraform-generated fixtures. It does not deploy vulnerable infrastructure or run arbitrary Terraform from PRs.

## Implementation

- Recursive Terraform plan parser, `after_unknown` masks and configuration-reference fallback.
- Typed Internet, SecurityGroup, Instance, Role, Bucket and Database graph, with evidence and confidence on every edge.
- Inline and standalone ingress, IPv4/IPv6 separation, public-address and subnet/IGW route checks, instance profiles and S3 grants. Public S3 policies/ACLs and a limited private database pivot are supported.
- IAM inline/customer policies, three recognized AWS managed-policy subsets, explicit unconditional denies, permission boundaries, conditional uncertainty and AssumeRole trust checks.
- Four escalation rules: self `PutRolePolicy`, self `AttachRolePolicy`, `CreatePolicyVersion` on an attached customer policy, and `UpdateAssumeRolePolicy` plus `sts:AssumeRole`.
- Bounded BFS over simple paths, canonical base/head diff, and max-flow/min-cut with exact shared-edit refinement.
- CLI, bundled Node 24 Action, Markdown/SARIF, browser worker and static Pages workflow.
- Three labelled CloudGoat slices, a TerraGoat negative control, real Terraform output, tests and a deterministic benchmark harness.

[Architecture and algorithm decisions](docs/decisions.md) · [Report contract](docs/report-contract.md) · [Source provenance](fixtures/README.md)

## Evaluation

On the checked-in normalized static slices: **2 found, 1 missed, 0 false resource chains**. The missed CloudGoat `rce_web_app` route needs ALB forwarding and CIDR-based private database routing, which are unsupported. TerraGoat's negative control produces no path. Labels were derived from pinned upstream source, separately from detector output, but have **not been independently human-reviewed**. These small adapted fixtures do not establish full-lab accuracy.

`npm run evaluate` regenerates found/missed/false counts. `npm run benchmark` measures both plan analyses on 500 and 5,000 resources and records timings and machine details. See [results, workload and threats to validity](docs/evaluation.md). Never deploy CloudGoat or TerraGoat for this evaluation.

```sh
npm run check       # typecheck, Vitest, CLI + Action + production viewer builds
npm run evaluate
npm run benchmark
npm run test:browser # production browser checks; install Chromium first
```

## Scope

AWS only. Unknown values and assumed compromise produce possible paths. Unsupported resources and missing links can cause misses; conditions and missing external controls can cause false positives. Full IAM, SCPs/RCPs, KMS, NACLs, load balancers, application vulnerabilities, Kubernetes and Azure are outside this release. An empty report does not prove security. No ML component was skipped; none is needed.
