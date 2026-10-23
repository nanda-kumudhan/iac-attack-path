# Measured evaluation

The engine is evaluated against expected resource chains prepared from pinned CloudGoat/TerraGoat source. These are normalized static slices, not deployed labs or full-lab Terraform outputs. Labels were prepared separately from detector output but have not had independent human review. See [provenance, exact revisions and changes](../fixtures/README.md).

## Found, missed and false paths

Run `npm run evaluate` to regenerate [machine-readable results](evaluation-results.json). A finding is matched by its complete ordered resource sequence. Port and IAM-action variants collapse into one resource chain, so several semantically distinct detector paths can match one label. Duplicate chain variants do not inflate the found count. Expected absent chains are misses; unexpected actual chains are false paths. Errors are failures, not zero-finding measurements.

| Static slice | Found | Missed | False chains |
| --- | ---: | ---: | ---: |
| CloudGoat `ec2_ssrf` HTTP → instance role → S3 | 1 | 0 | 0 |
| CloudGoat `cloud_breach_s3` proxy → instance role → S3 | 1 | 0 | 0 |
| CloudGoat `rce_web_app` ALB → EC2 → private RDS | 0 | 1 | 0 |
| TerraGoat negative: open EC2, no role/public bucket grant | 0 | 0 | 0 |
| **Total** | **2** | **1** | **0** |

The missed chain requires ALB listener/target forwarding and CIDR-based private database access, both outside the supported model. The miss is retained in the denominator and an integration test checks that the harness reports it. It is a concrete false negative, not an implicit clean result for the upstream lab. The two found chains assume SSRF/proxy exploitation and metadata credential use. The EC2 SSRF slice ends at S3, rather than claiming the entire Lambda-based lab objective was detected.

The TerraGoat source comment describes a public bucket, but the pinned resource has no public ACL or policy; labels follow the resource fields rather than the comment. This is a limited negative control. Tests also cover private routes, NAT, wrong resource ARNs, explicit denies, restricted boundaries, IPv4/IPv6 mismatch, unsupported PassRole-only chains and malformed policies. Passing unit tests is separate from measured detection quality.

## Minimum-edit verification

Both detected CloudGoat slices need one supported ingress edit. The real Terraform-generated example independently introduces one chain and produces a single public HTTP ingress rule as its cut. Removing that ingress in the base eliminates the chain.

For shared edits and multiple independent paths, Vitest checks coverage and compares the exact solver with exhaustive edit-subset enumeration across 80 deterministic small cases. This validates minimum cardinality under the stated edit model. It does not establish that applying a recommendation is the cheapest operational change or prove that unmodelled AWS routes are blocked. The complete cut, rather than a single per-path suggestion, is needed when its cost exceeds one.

## Runtime

Run `npm run benchmark` to regenerate [timings and host metadata](benchmark-results.json). The deterministic generator produces exactly 500 or 5,000 managed resources per plan. One public SG/instance/profile/role/bucket chain is surrounded by private SG/instance pairs. It uses no random input and needs no seed. It is deliberately sparse, with one role and one target; **it is not a dense IAM or path-explosion benchmark**.

The recorded run used Node 26.12.1 on Linux x64, Intel Core i7-8665U (the Action targets Node 24):

| Managed resources per plan | Median over five runs | Introduced paths |
| --- | ---: | ---: |
| 500 | 8.47 ms | 1 |
| 5,000 | 255.21 ms | 1 |

Timing includes parsing both JSON strings, building both graphs, BFS, diff, max-flow, exact cut refinement and report validation. File I/O, Node startup, Terraform, provider download and rendering are excluded. Each size has one excluded warmup and five measured repetitions. See the JSON for all samples, CPU, OS and Node version. Results are machine-dependent; they are not latency guarantees. Search and cut caps bound difficult graphs and fail explicitly.

## Threats to validity

- The implementer prepared both engine and labels. Independent human review and a larger held-out corpus remain necessary.
- Normalization removes much of each real lab. Static slices do not test every upstream resource, IAM condition or current provider schema.
- Generic compromise and credential assumptions may flag chains that cannot actually be exploited. No exploit was run.
- Resource-sequence matching collapses port/action distinctions. Raw report counts differ from evaluation-chain counts by design.
- Unsupported ALB/private-CIDR behavior causes a documented false negative. Missing external controls can cause false positives.
- The sparse benchmark understates many-role, many-bucket or highly connected workloads. No linear-scaling claim is made.
- No comparative evaluation against threatmap, cloud-pathfinder or per-resource scanners has been performed. No quality ranking is claimed.

CloudGoat and TerraGoat were only read as source. Nothing was deployed. The separate credential-free example was planned, never applied.
