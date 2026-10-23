# GitHub Action integration

The Action compares base/head Terraform plans directly with the offline engine, or consumes a precomputed v1 report. It uses the committed `lib/action.cjs` and Node 24; consumers do not install this repository's dependencies. Rebuild the bundle when its source changes. CI checks bundle drift.

## Plans and gating

In a workflow where a trusted planning step already produced the two files:

```yaml
name: IaC paths
on: [pull_request]
permissions:
  contents: read
jobs:
  paths:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      # Your own trusted job must provide base.json and head.json here.
      # For a credential-free smoke test, use the checked-in fixtures below.
      - name: Compare and gate
        id: paths
        uses: ./
        with:
          base-plan: fixtures/terraform-generated/base.json
          head-plan: fixtures/terraform-generated/head.json
          output-directory: iac-report
      # Optional: uploads disclose findings to GitHub.
      - uses: actions/upload-artifact@v4
        if: ${{ always() && steps.paths.outputs.report-file != '' }}
        with:
          name: iac-findings
          path: iac-report
```

The sample fixture intentionally introduces a path, so the gate fails. Replace those paths with your plans for a real repository. For an external repository use `nanda-kumudhan/iac-attack-path@<reviewed-commit-sha>` instead of `./`. The Action does not generate plans or obtain AWS credentials.

Produce each plan with the matching base/head checkout and the same planning inputs, provider lockfile and state assumptions. Terraform planning runs providers and can execute data sources; it is distinct from this offline parser. Do not give untrusted fork code cloud credentials. The [offline example](offline-plan.md) avoids cloud data sources and needs no AWS access, but is not a general solution for planning arbitrary live infrastructure.

| Input | Default | Meaning |
| --- | --- | --- |
| `base-plan`, `head-plan` | Empty | Pair of Terraform plan JSON paths |
| `report-file` | Empty | Alternative precomputed v1 report; cannot be combined with plan inputs |
| `output-directory` | `iac-report` | JSON/Markdown/SARIF directory |
| `fail-on-introduced` | `true` | Fail for any introduced path, including possible |
| `allow-demo` | `false` | Allow example reports for presentation tests only |
| `post-comment` | `false` | Post findings to this pull request |
| `github-token` | Empty | Required only for comments |

Outputs: `introduced-count`, `report-file`, `markdown-file`, `sarif-file`. File outputs are absolute paths. Reports are written before an introduced-path failure. Malformed/missing inputs, incompatible versions and incomplete searches fail without a clean verdict. `fail-on-introduced: 'false'` allows findings but never suppresses analysis errors. The Action deliberately does not set outputs for an analysis that failed before report generation.

## PR comments

```yaml
permissions:
  contents: read
  pull-requests: write
# In the checking step's with:
# post-comment: 'true'
# github-token: ${{ github.token }}
```

Comments create a new comment per run and disclose the report's resource names. They require a `pull_request` event with write permission. Fork PRs may lack write permission. Token/context/API failures produce a warning while preserving the analysis verdict. Do not use `pull_request_target` to run untrusted PR code to obtain write credentials. No comments were posted to anyone else's repository as part of implementation.

## SARIF

`report.sarif` is SARIF 2.1.0. `IAC001` results include introduced paths, canonical fingerprints, evidence, certainty and suggested edits. Possible paths are warnings; the Action still gates them. Terraform plan JSON does not reliably contain HCL source lines, so the engine does not fabricate them. Standalone SARIF is useful; GitHub annotations may require real source locations supplied by a separate source mapper.

Optional upload requires repository code-scanning availability and `security-events: write`:

```yaml
- uses: github/codeql-action/upload-sarif@v4
  if: ${{ always() && steps.paths.outputs.sarif-file != '' }}
  with:
    sarif_file: ${{ steps.paths.outputs.sarif-file }}
```

## GitHub Pages

The checked-in **Publish report viewer** workflow builds and deploys only `dist/viewer`. In GitHub settings select **GitHub Actions** as the Pages build source, then dispatch the workflow. The browser uses the exact same engine in a worker. Only the public normalized demonstration is bundled; selected files are not uploaded or included in the published site.

The expected project URL after a successful deployment is `https://nanda-kumudhan.github.io/iac-attack-path/`. Treat it as a deployment target until a workflow run verifies publication.

Official references: [JavaScript Actions](https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action), [metadata syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax), [SARIF support](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning), [Cytoscape](https://js.cytoscape.org/).
