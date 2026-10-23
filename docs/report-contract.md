# Report v1

`src/report/schema.ts` validates the output shared by the engine, CLI, Action and browser. `src/engine/model.ts` defines the analysis graph. Reports are UTF-8 JSON with no extra fields. The existing v1 precomputed-report interface remains compatible; `cut` is optional.

```json
{
  "schemaVersion": 1,
  "analysis": { "status": "complete", "warnings": [] },
  "paths": [{
    "id": "path-canonical-hash",
    "change": "introduced",
    "certainty": "possible",
    "explanation": "Public ingress; assumed application exploit and credential use; role read grant.",
    "steps": [
      { "resource": "internet" },
      { "resource": "aws_security_group.web" },
      { "resource": "aws_instance.web" },
      { "resource": "aws_iam_role.web" },
      { "resource": "aws_s3_bucket.data" }
    ],
    "remediation": {
      "description": "Remove this public ingress rule.",
      "resource": "aws_security_group.web",
      "attribute": "ingress[rule-semantic-hash]"
    }
  }],
  "cut": {
    "cost": 1,
    "model": "Unit cost per distinct supported edit on introduced paths.",
    "edits": [{
      "id": "edit-canonical-hash",
      "resource": "aws_security_group.web",
      "attribute": "ingress[rule-semantic-hash]",
      "description": "Remove this public ingress rule."
    }]
  }
}
```

This example illustrates the interface, not an evaluation fixture. Use the CLI to obtain an engine-produced report.

`analysis.status: complete` means the supported analysis finished; `demo` marks example output rejected by the Action unless explicitly allowed. Errors and truncated searches throw rather than producing a complete empty report. Warnings describe model limitations and unresolved evidence.

Path `id` is opaque, deterministic engine output. `change` is introduced, removed or unchanged. Certainty is definite or possible; any possible edge makes the path possible. Assumed EC2 compromise and IAM escalation are possible. Certainty changes participate in identity and therefore become removed + introduced. The gate fails for both kinds of introduced path.

`steps` preserves order. `explanation` records edge evidence and assumptions. Optional `location` contains a real repository-relative filename and positive source line, without traversal or URI syntax. The current plan parser does not fabricate HCL line numbers.

`cut` lists the **entire** minimum supported edit set across introduced paths. Per-path `remediation` is one member intersecting that path, and does not mean that a single edit always blocks every other path. Hashed rule/statement selectors are semantic identifiers, not literal HCL indices. The engine does not modify infrastructure files automatically. See the [cost model and exact refinement](decisions.md#minimum-changes).

Limits: 5 MiB when loading a report, 10,000 paths, 100 steps/path, 100 warnings, 4,000 characters/text field. The engine uses tighter path-search limits. The viewer lists 200 matching cards; Markdown displays at most 20 paths within its comment budget. JSON and SARIF contain full findings within the limits.

SARIF 2.1.0 emits `IAC001` only for introduced paths: error for definite, warning for possible. IDs are preserved as fingerprints. Standalone SARIF without source locations cannot provide GitHub source annotations. Comments, uploads and exports can reveal infrastructure details and remain deliberate opt-ins.
