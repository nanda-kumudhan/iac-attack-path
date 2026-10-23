# Action integration

This is a report consumer. The engine and analysis CLI are still to be written.
`npm run report` formats existing reports only.

Use Node 24. `npm run build:action` produces `lib/action.cjs`; commit that bundle
with source changes before another repository uses it. CI checks source/bundle
drift. No release or remote repository has been created by this scaffold.

## Workflow after the engine exists

This is a template, not an enabled workflow. Replace the placeholder CLI command
with the hand-written engine. Analysis errors must fail before the Action runs.
Configure the CLI's report mode so findings can be gated by this Action.

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
      # Obtain base/head plans using your validated offline procedure.
      # This analysis command is a PLACEHOLDER:
      - name: Analyse both plans
        run: your-cli compare --base base.json --head head.json --report report.json
      # For local use, first set up Node, npm ci, npm run build:action.
      # For external use replace ./ with owner/repo@reviewed-commit-sha.
      - name: Gate findings
        id: paths
        uses: ./
        with:
          report-file: report.json
          output-directory: iac-report
```

| Input | Default | Meaning |
| --- | --- | --- |
| `report-file` | Required | Engine-produced v1 JSON |
| `output-directory` | `iac-report` | Local Markdown/SARIF directory |
| `fail-on-introduced` | `true` | Fail for introduced paths including possible |
| `allow-demo` | `false` | Synthetic delivery smoke tests only |
| `post-comment` | `false` | Publish the report to this PR |
| `github-token` | Empty | Required only for comments |

Outputs: `introduced-count`, `markdown-file`, `sarif-file` (absolute paths).
Artifacts are written before path-gate failure. Missing/invalid reports,
unsupported versions and disallowed demos fail the step. Malformed input never
falls back to a clean report. No GitHub job summary is published by default.

For comments, set `post-comment: 'true'`, `github-token: ${{ github.token }}`
and job permission `pull-requests: write`. This sends resource details to GitHub
and creates a new comment each run. Context/token/API failures produce a warning;
the finding verdict is preserved. Do not use `pull_request_target` to execute
untrusted PR code to gain comment access. Fork PRs can still run read-only checks.

The repository's **Delivery checks** workflow exercises synthetic packaging only;
it is not an infrastructure-security gate.

## SARIF and Pages

SARIF upload is not configured. If adding `github/codeql-action/upload-sarif`,
provide `security-events: write`, check repository code-scanning availability and
accept that findings leave the runner. Real source locations are necessary for
GitHub annotations. For optional uploads after gate failure use `if: always()`
and verify that artifact outputs exist before trying to upload.

For Pages: push to GitHub, select **GitHub Actions** as the Pages build source,
then manually run **Publish report viewer**. Only `dist/viewer` is uploaded. Do
not copy real plans/reports into source, public assets or build output. The
workflow has not been run here.

Official references:

- [JavaScript Actions and runtime bundles](https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action)
- [Secure use of pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
- [GitHub SARIF support](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning)
- [Cytoscape.js](https://js.cytoscape.org/)
