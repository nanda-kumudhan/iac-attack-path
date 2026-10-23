# IaC Attack Path Checker

An offline project to check whether a Terraform change introduces a route from
the internet to private AWS data. The planned engine compares base/head plans,
explains new chains and suggests changes that block them.

**Current status:** Action packaging, Markdown/SARIF formatting, a browser report
viewer and a static guide are implemented. The engine, analysis CLI, ground-truth
labels and evaluation harness remain for the author to hand-code. This checkout
does not yet detect attack paths or analyse raw Terraform plans.

## Run the delivery demo

Use Node 24 (`.nvmrc`), then:

```sh
npm ci
npm run dev
```

Open the printed local URL and choose **Load demo**, or load a v1
report from your engine. The viewer filters supplied findings and shows each
path, explanation and supplied suggestion. Reports are read without upload.
Scripts and Cytoscape are bundled; there are no remote fonts, CDN or analytics.
The production content security policy blocks network connections.

```sh
# Formatting only, not the planned analysis CLI
npm run report -- --input examples/reports/demo.json --out-dir iac-report

# Verify delivery code and build the Action + static viewer/guide
npm run check
```

The demo is synthetic, not a CloudGoat fixture or evidence of detection quality.
Its suggestion is illustrative; no minimum cut has been calculated.

## Ownership and stages

| Hand-written by the author | Generated delivery code |
| --- | --- |
| Typed graph and Terraform parser | Action wrapper and bundle |
| Networking/IAM extraction and escalation rules | PR comment and SARIF formatting |
| BFS, explanation logic, canonical identity and diff | Cytoscape report viewer |
| Min-cut and attribute-to-change mapping | Static guide, CI and Pages packaging |
| Analysis CLI, labels and evaluation harness | Presentation validation and delivery tests |

The report contract describes display data, not the infrastructure graph model.
Every path, ID, classification, certainty and suggested edit must come from the
hand-written engine. See [stage decisions and reasons](docs/decisions.md) for
completed delivery stages and your next steps. `src/engine` and `src/cli` remain
unimplemented.

## Planned MVP

Read `terraform show -json`, model security groups, EC2 instances, IAM roles and
S3 buckets, find internet-to-data paths, compare base/head findings and exit
non-zero for introduced paths. Check three hand-labelled static scenarios.
IAM escalation rules and min-cut follow the core analysis.

The browser currently views reports. Browser analysis requires the shared,
hand-written engine and is not implemented yet.

## Integration

- [Report contract](docs/report-contract.md): engine output consumed by delivery.
- [Action usage](docs/action.md): gating, comments, SARIF and Pages setup.
- [Evaluation plan](docs/evaluation.md): evidence to collect, with no invented scores.
- `guide.html`: static guide built alongside the viewer.

The Action reads a report, writes Markdown/SARIF and fails for introduced paths,
including possible paths. Missing/invalid reports fail; demos are rejected by
default. It neither runs Terraform nor computes a diff. Comments are disabled
by default. Opted-in comments and SARIF uploads disclose findings to GitHub.

`lib/action.cjs` is the committed runtime bundle; rebuild it when source changes.
CI checks delivery only. Pages publication is manually triggered. Nothing has
been deployed.

## Evaluation and limits

AWS only, heuristic analysis and a small planned IAM subset; unknown values
should yield possible paths. Public ingress alone does not establish a route:
routing, addressing and service exposure matter. Network access does not imply
compromise or credential theft. Explain those prerequisites explicitly.

There is no claim of full IAM evaluation or proof that an empty report means
secure infrastructure. Canonical diff and min-cut cost modelling remain author
decisions. No evaluation measurements exist yet.

CloudGoat and TerraGoat will be analysed statically only. Never deploy these
intentionally vulnerable labs for this project. No credentials, deployment
commands or Terraform apply workflows are included.
