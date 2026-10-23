import {
  AnalysisError,
  canonical,
  identity,
  hasUnknown,
  list,
  object,
  possible,
  strings,
  wildcard,
  type Certainty,
  type Edge,
  type Edit,
} from "./model";
import { type Plan, type Resource, Resolver } from "./plan";
export interface Statement {
  Effect?: string;
  Action?: string | string[];
  NotAction?: unknown;
  Resource?: string | string[];
  NotResource?: unknown;
  Condition?: unknown;
  Principal?: unknown;
  NotPrincipal?: unknown;
}
export interface Policy {
  source: Resource;
  attribute: string;
  statements: Statement[];
  unknown: boolean;
  attachmentEdit?: Edit;
}
export function readPolicy(source: Resource, attribute = "policy"): Policy {
  let value = source.values[attribute];
  if (value === undefined || value === null)
    return {
      source,
      attribute,
      statements: [],
      unknown: source.unknown[attribute] === true,
    };
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new AnalysisError("Malformed IAM policy document in plan");
    }
  }
  if (!value || typeof value !== "object" || !("Statement" in value))
    throw new AnalysisError("IAM policy document has no Statement");
  const statements = Array.isArray(value.Statement)
    ? value.Statement
    : [value.Statement];
  if (statements.some((s: any) => !s || !["Allow", "Deny"].includes(s.Effect)))
    throw new AnalysisError("Invalid IAM policy statement");
  return { source, attribute, statements, unknown: false };
}
const matches = (values: unknown, target: string, insensitive = false) =>
  strings(values).some((v) => wildcard(v, target, insensitive));
function actionMatches(s: Statement, action: string): boolean {
  return s.NotAction !== undefined
    ? !matches(s.NotAction, action, true)
    : matches(s.Action, action, true);
}
function resourceMatches(s: Statement, resource: string): boolean {
  return s.NotResource !== undefined
    ? !matches(s.NotResource, resource)
    : matches(s.Resource, resource);
}
function semanticStatement(s: Statement) {
  const { Sid, ...value } = s as Statement & { Sid?: string };
  return {
    ...value,
    ...(s.Action
      ? {
          Action: strings(s.Action)
            .map((a) => a.toLowerCase())
            .sort(),
        }
      : {}),
    ...(s.Resource ? { Resource: strings(s.Resource).sort() } : {}),
  };
}
export function statementEdit(p: Policy, s: Statement): Edit {
  if (p.attachmentEdit) return p.attachmentEdit;
  const semantic = canonical(semanticStatement(s));
  const occurrence = p.statements
    .slice(0, p.statements.indexOf(s))
    .filter((other) => canonical(semanticStatement(other)) === semantic).length;
  return {
    id: identity("edit", [
      p.source.address,
      p.attribute,
      semanticStatement(s),
      occurrence,
    ]),
    resource: p.source.address,
    attribute: `${p.attribute}.Statement[${identity("statement", semanticStatement(s))}:${occurrence}]`,
    description:
      "Remove or narrow this IAM statement so it no longer grants the path capability.",
  };
}
export interface Grant {
  certainty: Certainty;
  edit: Edit;
  evidence: string;
}
export function permission(
  policies: Policy[],
  action: string,
  arns: string[],
  boundary?: Policy,
): Grant[] {
  const relevant = (s: Statement) =>
    actionMatches(s, action) && arns.some((arn) => resourceMatches(s, arn));
  const denies = policies
    .flatMap((p) => p.statements)
    .filter((s) => s.Effect === "Deny" && relevant(s));
  if (denies.some((s) => !s.Condition && !s.NotAction && !s.NotResource))
    return [];
  let boundaryCertainty: Certainty = "definite";
  if (boundary) {
    if (boundary.unknown) boundaryCertainty = "possible";
    else {
      if (
        boundary.statements.some(
          (s) => s.Effect === "Deny" && relevant(s) && !s.Condition,
        )
      )
        return [];
      const allows = boundary.statements.filter(
        (s) => s.Effect === "Allow" && relevant(s),
      );
      if (!allows.length) return [];
      if (
        boundary.statements.some((s) => s.Effect === "Deny" && relevant(s)) ||
        !allows.some((s) => !s.Condition && !s.NotAction && !s.NotResource)
      )
        boundaryCertainty = "possible";
    }
  }
  const result: Grant[] = [];
  for (const p of policies) {
    if (p.unknown)
      result.push({
        certainty: "possible",
        edit: {
          id: identity("edit", [p.source.address, p.attribute]),
          resource: p.source.address,
          attribute: p.attribute,
          description:
            "Resolve and restrict this unknown policy before merging.",
        },
        evidence: `Unknown policy might grant ${action}; resolve it before merge.`,
      });
    for (const s of p.statements)
      if (s.Effect === "Allow" && relevant(s))
        result.push({
          certainty: possible(
            boundaryCertainty,
            denies.length ||
              s.Condition ||
              s.NotAction ||
              s.NotResource ||
              policies.some((p) => p.unknown)
              ? "possible"
              : "definite",
          ),
          edit: statementEdit(p, s),
          evidence: `${action} allowed by ${p.source.address}; conditions and external controls require review.`,
        });
  }
  return result;
}
export function resourceArns(r: Resource): string[] {
  if (r.type === "aws_s3_bucket") {
    const arn =
      typeof r.values.arn === "string"
        ? r.values.arn
        : typeof r.values.bucket === "string"
          ? `arn:aws:s3:::${r.values.bucket}`
          : "";
    return arn ? [arn, `${arn}/*`] : ["arn:aws:s3:::UNKNOWN/*"];
  }
  if (r.type === "aws_iam_role")
    return [
      r.values.arn ?? `arn:aws:iam::*:role/${r.values.name ?? "UNKNOWN"}`,
    ];
  return [
    r.values.arn ??
      `arn:aws:rds-db:*:*:dbuser:${r.values.resource_id ?? "UNKNOWN"}/*`,
  ];
}
export function extractIam(
  plan: Plan,
  resolver: Resolver,
  add: (e: Omit<Edge, "id">) => void,
  warn: (s: string) => void,
) {
  const roles = plan.resources.filter((r) => r.type === "aws_iam_role");
  const buckets = plan.resources.filter((r) => r.type === "aws_s3_bucket");
  const docs = new Map<string, Policy>();
  const attached = new Map<string, Resource[]>();
  const rolePolicies = new Map<string, Policy[]>();
  const boundaryFor = new Map<string, Policy>();
  for (const r of plan.resources)
    if (r.type === "aws_iam_policy") docs.set(r.address, readPolicy(r));
  for (const role of roles) {
    const policies: Policy[] = list(role.values.inline_policy).map(
      (inline, i) => {
        const policy = readPolicy({
          ...role,
          values: { policy: inline.policy },
          unknown: object(list(role.unknown.inline_policy)[i]),
        });
        return {
          ...policy,
          source: role,
          attribute: `inline_policy[${inline.name ?? identity("inline", policy.statements)}].policy`,
        };
      },
    );
    // These provider-computed inventory fields are unknown on every new role.
    // Only an explicitly configured unknown policy is evidence of a capability.
    const configured = (attribute: string) =>
      Object.hasOwn(role.expressions, attribute) ||
      role.values[attribute] != null;
    if (role.unknown.inline_policy === true && configured("inline_policy"))
      policies.push({
        source: role,
        attribute: "inline_policy",
        statements: [],
        unknown: true,
      });
    if (
      hasUnknown(role.unknown.managed_policy_arns) &&
      configured("managed_policy_arns")
    )
      policies.push({
        source: role,
        attribute: "managed_policy_arns",
        statements: [],
        unknown: true,
      });
    const managed: Resource[] = [];
    for (const link of resolver.resolve(role, "managed_policy_arns", [
      "aws_iam_policy",
    ])) {
      managed.push(link.resource);
      policies.push(docs.get(link.resource.address)!);
    }
    for (const arn of strings(role.values.managed_policy_arns))
      if (
        !plan.resources.some(
          (r) => r.type === "aws_iam_policy" && r.values.arn === arn,
        )
      )
        policies.push(externalPolicy(role, arn));
    for (const r of plan.resources) {
      if (
        r.type === "aws_iam_role_policy" &&
        resolver
          .resolve(r, "role", ["aws_iam_role"])
          .some((x) => x.resource.address === role.address)
      )
        policies.push(readPolicy(r));
      if (
        [
          "aws_iam_role_policy_attachment",
          "aws_iam_policy_attachment",
        ].includes(r.type) &&
        resolver
          .resolve(
            r,
            r.type === "aws_iam_policy_attachment" ? "roles" : "role",
            ["aws_iam_role"],
          )
          .some((x) => x.resource.address === role.address)
      ) {
        const links = resolver.resolve(r, "policy_arn", ["aws_iam_policy"]);
        if (links.length)
          for (const link of links) {
            managed.push(link.resource);
            policies.push(docs.get(link.resource.address)!);
          }
        else policies.push(externalPolicy(r, r.values.policy_arn));
      }
    }
    const boundary = resolver.resolve(role, "permissions_boundary", [
      "aws_iam_policy",
    ])[0]?.resource;
    if (role.values.permissions_boundary || role.unknown.permissions_boundary)
      boundaryFor.set(
        role.address,
        boundary
          ? docs.get(boundary.address)!
          : {
              source: role,
              attribute: "permissions_boundary",
              statements: [],
              unknown: true,
            },
      );
    if (policies.some((p) => p.unknown))
      warn(
        "An IAM policy or attachment is unknown; broad possible capabilities require review.",
      );
    attached.set(role.address, managed);
    rolePolicies.set(role.address, policies);
  }
  function externalPolicy(source: Resource, arn: unknown): Policy {
    // Three supported AWS managed-policy capability subsets. Other documents must be present locally.
    const known: Record<string, Statement[]> = {
      "arn:aws:iam::aws:policy/AdministratorAccess": [
        { Effect: "Allow", Action: "*", Resource: "*" },
      ],
      "arn:aws:iam::aws:policy/AmazonS3FullAccess": [
        { Effect: "Allow", Action: "s3:*", Resource: "*" },
      ],
      "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess": [
        { Effect: "Allow", Action: ["s3:Get*", "s3:List*"], Resource: "*" },
      ],
    };
    const statements = typeof arn === "string" ? known[arn] : undefined;
    if (!statements)
      warn(
        "An attached managed policy document is unavailable; its capabilities are possible, not evaluated.",
      );
    return {
      source,
      attribute:
        source.type === "aws_iam_role" ? "managed_policy_arns" : "policy_arn",
      statements: statements ?? [],
      unknown: !statements,
      ...(statements
        ? {
            attachmentEdit: {
              id: identity("edit", [source.address, "managed-attachment", arn]),
              resource: source.address,
              attribute:
                source.type === "aws_iam_role"
                  ? `managed_policy_arns[${String(arn)}]`
                  : "policy_arn",
              description: `Detach ${String(arn)} or replace it with a policy without this capability.`,
            },
          }
        : {}),
    };
  }
  const get = (r: Resource, action: string, arns: string[]) =>
    permission(
      rolePolicies.get(r.address) ?? [],
      action,
      arns,
      boundaryFor.get(r.address),
    );
  for (const role of roles) {
    const policies = rolePolicies.get(role.address)!;
    for (const bucket of buckets)
      for (const action of ["s3:GetObject", "s3:GetObjectVersion"])
        for (const grant of get(
          role,
          action,
          resourceArns(bucket).filter((x) => x.endsWith("/*")),
        ))
          add({
            from: role.address,
            to: bucket.address,
            kind: "grant",
            certainty: grant.certainty,
            evidence: grant.evidence,
            edit: grant.edit,
          });
    for (const target of roles)
      if (target.address !== role.address) {
        const trust = readPolicy(target, "assume_role_policy");
        const trusted = trust.statements.some(
          (s) =>
            s.Effect === "Allow" &&
            actionMatches(s, "sts:AssumeRole") &&
            strings(object(s.Principal).AWS).some(
              (p) =>
                p === "*" ||
                resourceArns(role).some((arn) => wildcard(p, arn)) ||
                p.endsWith(":root"),
            ),
        );
        for (const grant of get(role, "sts:AssumeRole", resourceArns(target))) {
          if (trusted || trust.unknown)
            add({
              from: role.address,
              to: target.address,
              kind: "assume-role",
              certainty: "possible",
              evidence:
                "AssumeRole requires target trust and any conditions, account and session controls to allow the request.",
              edit: grant.edit,
            });
          for (const mutation of get(
            role,
            "iam:UpdateAssumeRolePolicy",
            resourceArns(target),
          ))
            add({
              from: role.address,
              to: target.address,
              kind: "escalation",
              certainty: "possible",
              evidence:
                "IAM escalation: UpdateAssumeRolePolicy plus sts:AssumeRole can change target trust and assume it.",
              edit: mutation.edit,
            });
        }
      }
    // Four catalogue rules. Self-policy mutation does not grant another role's credentials.
    const self = resourceArns(role);
    const mutations: { rule: string; grants: Grant[] }[] = [
      {
        rule: "iam:PutRolePolicy on the current role",
        grants: get(role, "iam:PutRolePolicy", self),
      },
      {
        rule: "iam:AttachRolePolicy on the current role (requires an attachable policy with broader access)",
        grants: get(role, "iam:AttachRolePolicy", self),
      },
      {
        rule: "iam:CreatePolicyVersion on an attached customer-managed policy",
        grants: (attached.get(role.address) ?? []).flatMap((p) =>
          get(role, "iam:CreatePolicyVersion", [p.values.arn ?? "UNKNOWN"]),
        ),
      },
    ];
    for (const mutation of mutations)
      for (const grant of mutation.grants)
        for (const bucket of buckets) {
          // A new Allow cannot override an existing unconditional Deny or a boundary.
          const simulated: Policy = {
            source: role,
            attribute: "hypothetical",
            unknown: false,
            statements: [
              { Effect: "Allow", Action: "s3:GetObject", Resource: "*" },
            ],
          };
          if (
            !permission(
              [...policies, simulated],
              "s3:GetObject",
              resourceArns(bucket).filter((x) => x.endsWith("/*")),
              boundaryFor.get(role.address),
            ).length
          )
            continue;
          add({
            from: role.address,
            to: bucket.address,
            kind: "escalation",
            certainty: "possible",
            evidence: `IAM escalation: ${mutation.rule}; assumes successful policy mutation and credential use.`,
            edit: grant.edit,
          });
        }
  }
  for (const bucket of buckets) {
    const policies = plan.resources
      .filter(
        (r) =>
          r.type === "aws_s3_bucket_policy" &&
          resolver
            .resolve(r, "bucket", ["aws_s3_bucket"])
            .some((x) => x.resource.address === bucket.address),
      )
      .map((r) => readPolicy(r));
    const blocks = plan.resources.filter(
      (r) =>
        r.type === "aws_s3_bucket_public_access_block" &&
        resolver
          .resolve(r, "bucket", ["aws_s3_bucket"])
          .some((x) => x.resource.address === bucket.address),
    );
    for (const p of policies)
      for (const s of p.statements) {
        if (
          s.Effect !== "Allow" ||
          !actionMatches(s, "s3:GetObject") ||
          !resourceArns(bucket)
            .filter((x) => x.endsWith("/*"))
            .some((arn) => resourceMatches(s, arn))
        )
          continue;
        const principal =
          s.Principal === "*" || strings(object(s.Principal).AWS).includes("*");
        if (
          principal &&
          !blocks.some((b) => b.values.restrict_public_buckets === true)
        ) {
          if (
            !policies.some((doc) =>
              doc.statements.some(
                (d) =>
                  d.Effect === "Deny" &&
                  !d.Condition &&
                  actionMatches(d, "s3:GetObject") &&
                  resourceArns(bucket).some((arn) => resourceMatches(d, arn)) &&
                  (d.Principal === "*" ||
                    strings(object(d.Principal).AWS).includes("*")),
              ),
            )
          )
            add({
              from: "internet",
              to: bucket.address,
              kind: "grant",
              certainty: "possible",
              evidence:
                "Anonymous S3 read policy; account-level public-access blocks, conditions and object existence require review.",
              edit: statementEdit(p, s),
            });
        }
        for (const role of roles)
          if (
            strings(object(s.Principal).AWS).some((p) =>
              resourceArns(role).some((arn) => wildcard(p, arn)),
            )
          ) {
            const grants = permission(
              [p, ...(rolePolicies.get(role.address) ?? [])],
              "s3:GetObject",
              resourceArns(bucket).filter((x) => x.endsWith("/*")),
              boundaryFor.get(role.address),
            );
            if (grants.length)
              add({
                from: role.address,
                to: bucket.address,
                kind: "grant",
                certainty: "possible",
                evidence:
                  "S3 resource policy names the role; account and effective-policy controls require review.",
                edit: statementEdit(p, s),
              });
          }
      }
    const aclResources = [
      bucket,
      ...plan.resources.filter(
        (r) =>
          r.type === "aws_s3_bucket_acl" &&
          resolver
            .resolve(r, "bucket", ["aws_s3_bucket"])
            .some((x) => x.resource.address === bucket.address),
      ),
    ];
    for (const acl of aclResources)
      if (
        ["public-read", "public-read-write"].includes(acl.values.acl) &&
        !blocks.some((b) => b.values.ignore_public_acls === true) &&
        !plan.resources.some(
          (r) =>
            r.type === "aws_s3_bucket_ownership_controls" &&
            resolver
              .resolve(r, "bucket", ["aws_s3_bucket"])
              .some((x) => x.resource.address === bucket.address) &&
            list(r.values.rule).some(
              (rule) => rule.object_ownership === "BucketOwnerEnforced",
            ),
        )
      )
        add({
          from: "internet",
          to: bucket.address,
          kind: "grant",
          certainty: "possible",
          evidence:
            "Public-read S3 ACL; account controls and object-level access require review.",
          edit: {
            id: identity("edit", [acl.address, "acl"]),
            resource: acl.address,
            attribute: "acl",
            description: "Replace the public ACL with private access.",
          },
        });
  }
}
