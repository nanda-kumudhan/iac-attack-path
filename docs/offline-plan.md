# Credential-free Terraform plan spike

`examples/offline/main.tf` is a minimal AWS example with static placeholder inputs. It has no remote backend, AWS data sources, provisioners or real credentials. A Boolean changes HTTP ingress from `10.0.0.0/8` to `0.0.0.0/0`. Six resources model an SG, instance, profile, role, inline read policy and bucket. Public-routing evidence is deliberately unavailable in this small example; the finding is possible.

```sh
npm run spike
npm run analyze -- --base examples/offline/base.json --head examples/offline/head.json
# Exit 1; one introduced chain and a minimum cut of one ingress rule.
```

The script runs `terraform init -backend=false`, `validate`, two `plan -refresh=false` operations, and `show -json`. The provider uses placeholder credentials with credential validation, region validation, metadata checks and account-ID requests disabled. There are no apply or destroy commands. Initialization downloads the provider and verifies its lockfile. After initialization, this configuration needs no AWS account or cloud API calls to plan. This is a reproducible plan-only example, not a vulnerable lab deployment.

Verified locally with **Terraform 1.15.9** and **hashicorp/aws 6.70.0**, pinned in `examples/offline/.terraform.lock.hcl`. The copied, checked-in outputs in `fixtures/terraform-generated` are real Terraform JSON, including configuration references and unknown masks; tests run without Terraform or the provider. Fake provider values in these public fixtures are intentional. The script's generated files and binary plans in `examples/offline` are ignored.

This does **not** prove arbitrary CloudGoat/TerraGoat stacks can plan offline. Live AMI/account/availability-zone lookups, archives, legacy provider fields and other dependencies need separate handling. The CloudGoat/TerraGoat evaluation fixtures are manually normalized static slices, not outputs falsely presented as full-lab plans. TerraGoat's declared Terraform 0.12 requirement is one reason not to run its old configuration unchanged with a current provider.
