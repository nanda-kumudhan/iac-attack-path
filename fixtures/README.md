# Fixtures and provenance

`terraform-generated/{base,head}.json` are actual outputs of the credential-free Terraform example. Reproduce them with `npm run spike`; see `docs/offline-plan.md`. They include only fixed fake credentials and public example values.

`scenarios/*/{base,head}.json` are **manually normalized static slices**, not actual full-lab plans. Each has `provenance.json` recording an upstream Git commit, exact source paths and SHA-256 hashes; `labels.json` records expected ordered chains and assumptions. CloudGoat revision: `63c65bd26edc6919499adfa20b176c450e35c33c`. TerraGoat revision: `729f8da62c6a85ce4af5ad3d123de97776d954c4`.

Modified fixture representation: names, IDs, account and bucket values are placeholders; secrets, provisioners, unrelated user/Lambda resources, application assets and data sources are omitted. Infrastructure relationships needed for the selected source slice are retained. Network support resources are abbreviated to common placeholder addresses. HTTP `cg_whitelist` is set to `0.0.0.0/0` in the CloudGoat heads. Bases replace public HTTP ingress with private sources as a counterfactual remediation. No upstream Terraform was deployed or executed.

The `ec2_ssrf` slice stops at private S3 read, not the lab's final Lambda invocation. `cloud_breach_s3` models its HTTP proxy-to-S3 chain. `rce_web_app` retains its ALB and private database dependencies as a deliberately measurable unsupported chain. The TerraGoat negative slice checks that an outdated source comment calling a bucket public does not manufacture an access grant. It has no bucket ACL/policy or EC2 role chain.

Labels were prepared from upstream source and walkthroughs before executing the evaluation harness. They were created in the same implementation session, and **have not been independently human-reviewed**. The benchmark is not ground truth. These fixtures are regression evidence for a narrow model, not a claim of unbiased real-world detection quality.

Expected-chain matching collapses port/action variants to one ordered resource sequence. An exact sequence mismatch counts as one miss and one false chain where applicable. The unsupported `rce_web_app` chain remains in the denominator. Reviewers should check source/normalization fidelity and challenge each label.

Upstream licenses are preserved under `licenses/`: CloudGoat BSD 3-Clause and TerraGoat Apache 2.0. These are modified representations of small infrastructure slices; no upstream application assets or real credentials are redistributed. Upstream repositories: [CloudGoat](https://github.com/RhinoSecurityLabs/cloudgoat), [TerraGoat](https://github.com/bridgecrewio/terragoat).
