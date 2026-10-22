# IaC Attack Path Checker

A project I'm building to check whether a Terraform change opens a path from the internet to private AWS data.

The idea is to connect the dots between resources. An open security group might look like one issue, but it gets more interesting when the attached instance has a role that can read an S3 bucket.

## The plan

Compare the base and head Terraform plans, build a graph for each, and flag any new attack paths. Eventually, this should run as a GitHub Action and suggest the smallest change that blocks a path.

The engine will run offline. A browser viewer is planned too, so plans can be analysed locally without uploading infrastructure code.

## First version

- Read JSON from `terraform show -json`.
- Model security groups, EC2 instances, IAM roles and S3 buckets.
- Find paths from the internet to data using BFS.
- Compare paths between two plans and return a non-zero exit code when a new one appears.
- Check the results against three hand-labelled scenarios.

After that: a GitHub Action, min-cut suggestions, SARIF output and a graph viewer.

## Planned stack

TypeScript, Node.js and Vitest for the engine and CLI. Cytoscape.js for the viewer, with GitHub Actions and GitHub Pages for delivery.

## Folder structure

```text
src/
  engine/        Graph model, parser and analysis
  cli/           Command-line interface
  action/        GitHub Action integration
  viewer/        Browser graph viewer
tests/
  fixtures/      Before/after plans and expected paths
docs/            Design notes and evaluation results
```

## Evaluation and limits

I'll compare found, missed and false paths against hand-labelled CloudGoat and TerraGoat scenarios, using static analysis only. These labs are intentionally vulnerable and won't be deployed for this project. I'll also measure runtime on generated plans with 500 and 5,000 resources.

The initial scope is AWS and a small subset of IAM behaviour. Values that are unknown until apply should produce possible paths rather than definite ones. Results will be heuristic, with no claim of complete IAM evaluation.

## Status

Just the folder structure for now. No implementation or runnable commands yet.
