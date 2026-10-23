import { describe, it, expect } from "vitest";
import { buildGraph, comparePlans, emptyPlan } from "../../src/engine";
import {
  basicResources,
  plan,
  resource,
} from "../../scripts/evaluation/fixtures";
function withPolicy(statements: any[]) {
  const rs = basicResources();
  rs.find((r) => r.type === "aws_iam_role_policy")!.values.policy =
    JSON.stringify({ Statement: statements });
  return rs;
}
const allow = (action: any, resource = "*", extra = {}) => ({
  Effect: "Allow",
  Action: action,
  Resource: resource,
  ...extra,
});
const paths = (rs: ReturnType<typeof basicResources>) =>
  comparePlans(emptyPlan(), plan(rs)).report.paths;
describe("bounded IAM semantics", () => {
  it("honours unconditional explicit denies across policies", () => {
    const rs = withPolicy([allow("s3:*")]);
    rs.push(
      resource("aws_iam_role_policy.deny", {
        role: "web-role",
        policy: JSON.stringify({
          Statement: [{ Effect: "Deny", Action: "s3:Get*", Resource: "*" }],
        }),
      }),
    );
    expect(paths(rs)).toHaveLength(0);
  });
  it("does not treat ListBucket or a bucket-only ARN as object read", () => {
    expect(paths(withPolicy([allow("s3:ListBucket")]))).toHaveLength(0);
    expect(
      paths(withPolicy([allow("s3:GetObject", "arn:aws:s3:::example-data")])),
    ).toHaveLength(0);
  });
  it("suppresses unrelated resource grants", () =>
    expect(
      paths(withPolicy([allow("s3:GetObject", "arn:aws:s3:::other/*")])),
    ).toHaveLength(0));
  it("retains conditions and unknown policy documents as possible", () => {
    const rs = withPolicy([
      allow("s3:GetObject", "*", {
        Condition: { StringEquals: { "aws:SourceVpc": "vpc-other" } },
      }),
    ]);
    expect(
      buildGraph(plan(rs)).edges.find((e) => e.kind === "grant")?.certainty,
    ).toBe("possible");
    const p: any = plan(withPolicy([]));
    p.planned_values.root_module.resources.find(
      (r: any) => r.type === "aws_iam_role_policy",
    ).values.policy = null;
    p.resource_changes = [
      {
        address: "aws_iam_role_policy.read",
        change: { after_unknown: { policy: true } },
      },
    ];
    expect(comparePlans(emptyPlan(), p).report.paths[0]?.certainty).toBe(
      "possible",
    );
  });
  it("requires a permissions boundary to allow object read", () => {
    const rs = basicResources();
    rs.find((r) => r.type === "aws_iam_role")!.values.permissions_boundary =
      "arn:aws:iam::111111111111:policy/boundary";
    rs.push(
      resource("aws_iam_policy.boundary", {
        arn: "arn:aws:iam::111111111111:policy/boundary",
        policy: JSON.stringify({ Statement: [allow("ec2:*")] }),
      }),
    );
    expect(paths(rs)).toHaveLength(0);
  });
  it.each(["iam:PutRolePolicy", "iam:AttachRolePolicy"])(
    "models catalogue self-mutation %s as possible",
    (action) => {
      const rs = withPolicy([
        allow(action, "arn:aws:iam::111111111111:role/web-role"),
      ]);
      expect(
        paths(rs).some((p) => p.explanation.includes("IAM escalation")),
      ).toBe(true);
    },
  );
  it("does not treat mutation of another role as possession of its credentials", () =>
    expect(
      paths(
        withPolicy([
          allow("iam:PutRolePolicy", "arn:aws:iam::111111111111:role/other"),
        ]),
      ),
    ).toHaveLength(0));
  it("does not allow a self mutation to bypass a known S3 explicit deny", () =>
    expect(
      paths(
        withPolicy([
          allow("iam:PutRolePolicy"),
          { Effect: "Deny", Action: "s3:*", Resource: "*" },
        ]),
      ),
    ).toHaveLength(0));
  it("models CreatePolicyVersion only for attached customer policies", () => {
    const rs = withPolicy([
      allow(
        "iam:CreatePolicyVersion",
        "arn:aws:iam::111111111111:policy/mutable",
      ),
    ]);
    rs.push(
      resource("aws_iam_policy.mutable", {
        arn: "arn:aws:iam::111111111111:policy/mutable",
        policy: JSON.stringify({ Statement: [] }),
      }),
    );
    expect(paths(rs)).toHaveLength(0);
    rs.find((r) => r.type === "aws_iam_role")!.values.managed_policy_arns = [
      "arn:aws:iam::111111111111:policy/mutable",
    ];
    expect(paths(rs)[0]?.explanation).toContain("CreatePolicyVersion");
  });
  it("requires both trust mutation and AssumeRole capability", () => {
    const rs = withPolicy([allow("iam:UpdateAssumeRolePolicy")]);
    rs.push(
      resource("aws_iam_role.target", {
        name: "target",
        arn: "arn:aws:iam::111111111111:role/target",
        assume_role_policy: JSON.stringify({ Statement: [] }),
      }),
      resource("aws_iam_role_policy.target", {
        role: "target",
        policy: JSON.stringify({ Statement: [allow("s3:GetObject")] }),
      }),
    );
    expect(paths(rs)).toHaveLength(0);
    rs.find((r) => r.address === "aws_iam_role_policy.read")!.values.policy =
      JSON.stringify({
        Statement: [allow(["iam:UpdateAssumeRolePolicy", "sts:AssumeRole"])],
      });
    expect(paths(rs)[0]?.explanation).toContain("UpdateAssumeRolePolicy");
  });
  it("does not treat PassRole alone as credential theft", () =>
    expect(paths(withPolicy([allow("iam:PassRole")]))).toHaveLength(0));
  it("rejects malformed known policies", () => {
    const rs = basicResources();
    rs.find((r) => r.type === "aws_iam_role_policy")!.values.policy = "{";
    expect(() => paths(rs)).toThrow(/Malformed/);
  });
  it("finds public bucket policies and honours bucket public-access restriction", () => {
    const rs = [
      resource("aws_s3_bucket.data", { bucket: "example-data" }),
      resource("aws_s3_bucket_policy.public", {
        bucket: "example-data",
        policy: JSON.stringify({
          Statement: [
            allow("s3:GetObject", "arn:aws:s3:::example-data/*", {
              Principal: "*",
            }),
          ],
        }),
      }),
    ];
    expect(paths(rs)).toHaveLength(1);
    rs.push(
      resource("aws_s3_bucket_public_access_block.block", {
        bucket: "example-data",
        restrict_public_buckets: true,
      }),
    );
    expect(paths(rs)).toHaveLength(0);
  });
  it("recognizes public ACLs and ignores them when blocked or ownership-enforced", () => {
    const rs = [
      resource("aws_s3_bucket.data", {
        bucket: "example-data",
        acl: "public-read",
      }),
    ];
    expect(paths(rs)).toHaveLength(1);
    rs.push(
      resource("aws_s3_bucket_public_access_block.block", {
        bucket: "example-data",
        ignore_public_acls: true,
      }),
    );
    expect(paths(rs)).toHaveLength(0);
  });
});

it("treats unknown inline role-policy bodies as possible and keeps named block identity stable", () => {
  const rs = withPolicy([]);
  rs.find((r) => r.type === "aws_iam_role")!.values.inline_policy = [
    { name: "read", policy: null },
  ];
  const p: any = plan(rs);
  p.resource_changes = [
    {
      address: "aws_iam_role.web",
      change: { after_unknown: { inline_policy: [{ policy: true }] } },
    },
  ];
  expect(comparePlans(emptyPlan(), p).report.paths[0]?.certainty).toBe(
    "possible",
  );
});

it("maps managed-policy findings to the attachment rather than an uneditable AWS policy document", () => {
  const rs = withPolicy([]);
  rs.find((r) => r.type === "aws_iam_role")!.values.managed_policy_arns = [
    "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess",
  ];
  const grant = buildGraph(plan(rs)).edges.find((e) => e.kind === "grant");
  expect(grant?.edit?.attribute).toContain("managed_policy_arns[");
  expect(grant?.edit?.attribute).not.toContain("Statement");
});
it("keeps duplicate policy statements as distinct removable grants", () => {
  const rs = withPolicy([
    allow("s3:GetObject"),
    { Resource: "*", Action: "s3:GetObject", Effect: "Allow" },
  ]);
  const grants = buildGraph(plan(rs)).edges.filter((e) => e.kind === "grant");
  expect(grants).toHaveLength(2);
  expect(new Set(grants.map((e) => e.edit?.id)).size).toBe(2);
});
