#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../examples/offline"
# init downloads the provider; subsequent plans require no AWS account or calls.
export AWS_EC2_METADATA_DISABLED=true
export CHECKPOINT_DISABLE=1
terraform init -backend=false -input=false
terraform validate
terraform plan -refresh=false -input=false -lock=false -var=public_ingress=false -out=base.tfplan
terraform show -json base.tfplan > base.json
terraform plan -refresh=false -input=false -lock=false -var=public_ingress=true -out=head.tfplan
terraform show -json head.tfplan > head.json
