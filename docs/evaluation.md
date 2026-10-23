# Evaluation plan — no measurements yet

The harness and labels are hand-written work. This is a write-up outline, not
an evaluation harness or ground truth.

1. Choose three static CloudGoat/TerraGoat scenarios and pin revisions. Record
   licensing, Terraform compatibility patches and source paths.
2. Draw and label expected chains before running the detector. Record attack
   prerequisites, conditions, uncertainty and negative controls independently.
3. Define path matching, equivalent routes and treatment of search caps or
   unsupported semantics.
4. Record found, missed and false paths per scenario. Explain every mismatch.
5. Measure deterministic 500- and 5,000-resource plans. Publish generation method,
   seed, graph/path sizes, machine, Node version, repetitions and timing scope.
6. Check min-cut against its declared change-cost model. Re-run analysis after
   each suggested static edit; record failures and multi-attribute cases.

Never deploy these intentionally vulnerable labs for this project. No Terraform
apply workflow exists. No scenario has been downloaded, labelled or measured.

| Evidence | Status |
| --- | --- |
| Three independently labelled scenarios | Pending author work |
| Found/missed/false paths | Unmeasured |
| Runtime at 500 / 5,000 resources | Unmeasured |
| Min-cut validity/minimality | Unimplemented / unmeasured |
| Per-resource scanner comparison | Optional, unmeasured |
