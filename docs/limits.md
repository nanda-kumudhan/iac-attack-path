# Supported model and limits

This release is an offline heuristic AWS checker. `analysis.status: complete` means the supported analysis ran to completion, not that AWS behavior is fully modelled or the infrastructure is secure.

| Area | Supported | Important omissions |
| --- | --- | --- |
| Input | Terraform plan JSON format 1.x, nested planned modules, unknown masks, known-value links, configuration-reference fallback | HCL parsing, state files, general expression evaluation, transitive module output/variable resolution |
| Network | Inline/standalone SG ingress, public IPv4/IPv6, explicit subnet associations and main-route associations, IGW default routes, EC2 profiles, public databases | ALB/NLB forwarding, ENIs, prefix lists, arbitrary public CIDR ranges, NACLs, listeners, peering/transit gateways, full egress/routing simulation |
| Internet source | `0.0.0.0/0` and `::/0`, plus public S3 read policy/ACL candidates | Specific public IPv4/IPv6 CIDRs are not currently internet sources |
| Data | All S3 buckets and RDS instance/cluster nodes; S3 GetObject/GetObjectVersion grants | DynamoDB, EBS, secrets, object-key precision, KMS decryption and data exfiltration channels |
| IAM | Role inline/customer attachments, three known managed-policy capability subsets, matching unconditional identity denies, known boundaries, possible conditions/negations, AssumeRole, four escalation rules | Complete resource-policy composition, account/root trust precision, user/group credentials, session policies, SCPs/RCPs, full condition semantics, arbitrary managed-policy fetching |
| Database pivot | A source-SG reference from an instance SG to a database SG on its database port | CIDR-based private pivots; source egress, routing and database credentials remain assumptions |
| Remediation | Exact minimum number of supported edits to intersect all enumerated introduced paths | Business disruption costs, all AWS remediations, automatic HCL edits, proof of security |

Unknown policy documents can create broad possible grants and false positives. Missing references or unsupported resources can cause false negatives. Unknown values are not silently interpreted as known-safe. Unsupported types and unresolved links produce warnings where detected; the checker does not prove that every unsupported construct was identified.

An EC2 application's exploitability and credential theft are never inferred as facts. IMDSv2 is useful protection but does not prove every possible credential theft is prevented; paths through an instance role remain possible. IAM escalation also assumes successful API operations and credential use under external controls.

Cross-account bucket grants, partial object prefixes, conditional denies, mixed public/private routes, legacy/new exclusive IAM attachment resources and account-level S3 public-access settings need particular review. The checker may overapproximate or miss these cases. Public bucket results remain possible because account controls and object access are not fully known. Known bucket `restrict_public_buckets`, ACL blocking and BucketOwnerEnforced ownership are used where present; `block_public_policy` alone does not prove that a pre-existing policy is ineffective.

## Resource limits and errors

- Plan text: 50 MiB per input; 20,000 managed resources; 40 planned module levels; 50,000 graph edges.
- Search: 4,000 paths, 24 edges per path, 100,000 states per graph.
- Exact minimum-edit refinement: 200,000 states.
- Report input: 5 MiB, 10,000 paths, 100 steps/path, 100 warnings, 4,000 characters per text field.
- Browser renders at most 200 matching path cards; filtering/search can narrow results. Markdown shows at most 20 paths; JSON and SARIF preserve full findings within the report limits.

Limits throw an analysis error, rather than truncating paths and issuing a clean verdict. In the CLI, exit 2 means no security verdict. The Action fails. The browser displays an error and retains any previous report, explicitly marked as previous. An unchanged/empty report is only a result within this model.

Real Terraform plans may contain credentials or sensitive attributes even when Terraform marks them sensitive. Keep them out of public source/build output. The checked-in generated plans use only the intentionally fake values in `examples/offline/main.tf`.
