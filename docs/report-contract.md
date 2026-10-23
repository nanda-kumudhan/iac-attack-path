# Presentation report v1

This connects the **hand-written engine** to generated delivery code. It does not
define the analysis graph, canonicalization, search, diff, IAM or min-cut.

The runtime schema is `src/report/schema.ts`. Input is UTF-8 JSON, at most 5 MiB,
with no extra fields. Limits: 10,000 paths, 100 steps/path, 100 warnings and 4,000
characters per text field. The viewer lists the first 200 matching paths; search
narrows large reports. Markdown shows at most 20 paths within a length budget;
SARIF includes all introduced paths.

```json
{
  "schemaVersion": 1,
  "analysis": { "status": "complete", "warnings": [] },
  "paths": [{
    "id": "engine-assigned-canonical-id",
    "change": "introduced",
    "certainty": "possible",
    "explanation": "Evidence, unknowns and attack prerequisites from the engine.",
    "steps": [
      { "resource": "Internet" },
      { "resource": "aws_instance.example" },
      { "resource": "aws_s3_bucket.example" }
    ],
    "location": { "file": "infra/main.tf", "line": 12 },
    "remediation": {
      "description": "Optional, supported engine suggestion.",
      "resource": "aws_security_group.example",
      "attribute": "ingress.cidr_blocks"
    }
  }]
}
```

This illustrates field shape, not a valid attack chain. Do not use it as a
detection test or as a substitute for writing the engine.

- `analysis.status`: `complete` means successful completion of the supported
  analysis, not complete AWS coverage. `demo` is synthetic data, rejected by
  the Action by default. Errors or truncated search must not produce `complete`
  with an empty path list; fail analysis instead.
- `warnings`: supported limitations, not hidden analysis failures.
- `id`: unique, opaque canonical identity from the engine. Never rewritten here.
- `change`: engine-assigned `introduced`, `removed` or `unchanged`. The author's
  diff must define the treatment of certainty changes.
- `certainty`: `definite` or `possible`, defined by the author's model. Network
  access alone does not imply exploitation or credential theft.
- `steps`: at least two display names in engine-supplied order. No typed graph
  is inferred. Repeated resources are shown as separate occurrences.
- `location`: optional real repository-relative file and positive line, without
  traversal, backslashes, controls or URI syntax. Plans may lack source lines;
  do not invent them.
- `remediation`: optional engine output. Only claim minimality after implementing
  and validating min-cut and its cost model.

SARIF 2.1.0 emits `IAC001` only for introduced paths: `error` for definite and
`warning` for possible. The Action fails on both. IDs are preserved as SARIF
fingerprints; GitHub may compute location fingerprints on upload. Results
without source locations remain valid standalone SARIF but cannot be shown as
GitHub source annotations. No locations are fabricated.

Reports can reveal infrastructure details. Comments, uploads and shared exports
are separate disclosure decisions.
