import { describe, it, expect } from "vitest";
import {
  comparePlans,
  buildGraph,
  emptyPlan,
  findPaths,
  parsePlan,
  wildcard,
} from "../../src/engine";
import {
  basicResources,
  plan,
  resource,
} from "../../scripts/evaluation/fixtures";
import realBase from "../../fixtures/terraform-generated/base.json";
import realHead from "../../fixtures/terraform-generated/head.json";
const analyze = (rs = basicResources()) => comparePlans(emptyPlan(), plan(rs));
const at = (rs: ReturnType<typeof basicResources>, type: string) =>
  rs.find((r) => r.type === type)!.values;
describe("Terraform and network extraction", () => {
  it("detects the main failure and calculates a one-rule ingress cut", () => {
    const result = comparePlans(
      plan(basicResources(false)),
      plan(basicResources(true)),
    );
    expect(result.report.paths).toHaveLength(1);
    expect(result.report.paths[0]).toMatchObject({
      change: "introduced",
      certainty: "possible",
    });
    expect(result.cut.cost).toBe(1);
    expect(result.cut.edits[0]?.resource).toBe("aws_security_group.web");
  });
  it("analyses real Terraform-generated plans, including false leaves in unknown masks", () => {
    expect(findPaths(buildGraph(realBase))).toHaveLength(0);
    const result = comparePlans(realBase, realHead);
    expect(result.report.paths).toHaveLength(1);
    expect(result.cut.cost).toBe(1);
  });
  it.each([
    "private address",
    "private route",
    "NAT route",
    "private ingress",
    "no role",
    "no grant",
    "ICMP",
  ])("does not manufacture a route: %s", (variant) => {
    const rs = basicResources();
    if (variant === "private address")
      at(rs, "aws_instance").associate_public_ip_address = false;
    if (variant === "private route") at(rs, "aws_route_table").route = [];
    if (variant === "NAT route")
      at(rs, "aws_route_table").route = [
        { cidr_block: "0.0.0.0/0", nat_gateway_id: "nat-123" },
      ];
    if (variant === "private ingress")
      at(rs, "aws_security_group").ingress[0].cidr_blocks = ["10.0.0.0/8"];
    if (variant === "no role")
      delete at(rs, "aws_instance").iam_instance_profile;
    if (variant === "no grant")
      at(rs, "aws_iam_role_policy").policy = JSON.stringify({ Statement: [] });
    if (variant === "ICMP")
      at(rs, "aws_security_group").ingress[0].protocol = "icmp";
    expect(analyze(rs).report.paths).toHaveLength(0);
  });
  it("does not mix public IPv6 ingress with IPv4-only addressing", () => {
    const rs = basicResources();
    at(rs, "aws_security_group").ingress[0].cidr_blocks = ["::/0"];
    expect(analyze(rs).report.paths).toHaveLength(0);
  });
  it("supports standalone IPv6 rules with an IPv6 IGW route", () => {
    const rs = basicResources();
    at(rs, "aws_security_group").ingress = [];
    at(rs, "aws_route_table").route = [
      { ipv6_cidr_block: "::/0", gateway_id: "igw-main" },
    ];
    at(rs, "aws_instance").ipv6_addresses = ["2001:db8::1"];
    rs.push(
      resource("aws_vpc_security_group_ingress_rule.http", {
        security_group_id: "sg-web",
        cidr_ipv6: "::/0",
        ip_protocol: "tcp",
        from_port: 80,
        to_port: 80,
      }),
    );
    expect(analyze(rs).report.paths).toHaveLength(1);
  });
  it("marks absent routing evidence as possible", () => {
    const rs = basicResources().filter((r) => !r.type.startsWith("aws_route"));
    expect(analyze(rs).report.paths[0]?.certainty).toBe("possible");
  });
  it("resolves configuration references for a new unknown SG ID", () => {
    const p: any = plan(basicResources());
    delete at(p.planned_values.root_module.resources, "aws_security_group").id;
    at(
      p.planned_values.root_module.resources,
      "aws_instance",
    ).vpc_security_group_ids = null;
    p.configuration = {
      root_module: {
        resources: [
          {
            address: "aws_instance.web",
            expressions: {
              vpc_security_group_ids: {
                references: [
                  "aws_security_group.web.id",
                  "aws_security_group.web",
                ],
              },
            },
          },
        ],
      },
    };
    expect(comparePlans(emptyPlan(), p).report.paths).toHaveLength(1);
  });
  it("descends child modules and does not match same-named resources across modules", () => {
    const original = basicResources();
    const child = structuredClone(original);
    for (const r of child) r.address = `module.example.${r.address}`;
    const p = {
      format_version: "1.0",
      planned_values: {
        root_module: { child_modules: [{ resources: child }] },
      },
    };
    const result = comparePlans(emptyPlan(), p);
    expect(result.report.paths[0]?.steps[1]?.resource).toBe(
      "module.example.aws_security_group.web",
    );
  });
  it("ignores deletions and data resources", () => {
    const p: any = plan(basicResources());
    p.resource_changes = [
      { address: "aws_s3_bucket.data", change: { after: null } },
    ];
    expect(comparePlans(emptyPlan(), p).report.paths).toHaveLength(0);
  });
  it.each([
    {},
    { format_version: "2.0", planned_values: { root_module: {} } },
    { format_version: "1.0", values: { root_module: {} } },
    { ...plan([]), errored: true },
    { ...plan([]), complete: false },
  ])("rejects invalid or incomplete plans", (p) =>
    expect(() => parsePlan(p)).toThrow(),
  );
  it("rejects duplicate resource addresses and invalid JSON", () => {
    const rs = basicResources();
    rs.push(rs[0]!);
    expect(() => analyze(rs)).toThrow(/Duplicate/);
    expect(() => parsePlan("{")).toThrow(/Invalid/);
  });
  it("warns for unsupported resource types", () =>
    expect(
      buildGraph(
        plan([resource("aws_lambda_function.fn", {})]),
      ).warnings.join(),
    ).toContain("Unsupported resource type"));
  it("implements literal, star and question-mark matching", () => {
    expect(wildcard("s3:Get*", "S3:GetObject", true)).toBe(true);
    expect(wildcard("a.b", "axb")).toBe(false);
    expect(wildcard("a?b", "acb")).toBe(true);
  });
});
describe("path identity and bounded enumeration", () => {
  it("removes and preserves chains with canonical identities independent of resource order", () => {
    const rs = basicResources();
    const reverse = structuredClone(rs).reverse();
    expect(comparePlans(plan(rs), plan(reverse)).report.paths[0]?.change).toBe(
      "unchanged",
    );
    expect(
      comparePlans(plan(rs), plan(basicResources(false))).report.paths[0]
        ?.change,
    ).toBe("removed");
  });
  it("ignores IAM statement and action order and SG ingress order", () => {
    const rs = basicResources();
    at(rs, "aws_iam_role_policy").policy = JSON.stringify({
      Statement: [
        {
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:ListBucket"],
          Resource: "*",
        },
        { Effect: "Allow", Action: "ec2:DescribeInstances", Resource: "*" },
      ],
    });
    const changed = structuredClone(rs);
    const policy = JSON.parse(at(changed, "aws_iam_role_policy").policy);
    policy.Statement.reverse();
    policy.Statement[1].Action.reverse();
    at(changed, "aws_iam_role_policy").policy = JSON.stringify(policy);
    expect(
      comparePlans(plan(rs), plan(changed)).report.paths.every(
        (p) => p.change === "unchanged",
      ),
    ).toBe(true);
  });
  it("fails closed on search caps and handles cycles", () => {
    const graph = buildGraph(plan(basicResources()));
    expect(() => findPaths(graph, { maxDepth: 1 })).toThrow(/depth/);
    expect(() => findPaths(graph, { maxStates: 1 })).toThrow(/state/);
    const role = graph.nodes.find((n) => n.kind === "Role")!;
    graph.edges.push({
      id: "cycle",
      from: role.id,
      to: "internet",
      kind: "network",
      certainty: "possible",
      evidence: "cycle",
    });
    expect(findPaths(graph)).toHaveLength(1);
  });
});

it("requires the database TCP port for a direct public database path", () => {
  const rs = basicResources().filter(
    (r) =>
      ![
        "aws_instance",
        "aws_iam_role",
        "aws_iam_instance_profile",
        "aws_iam_role_policy",
        "aws_s3_bucket",
      ].includes(r.type),
  );
  rs.push(
    resource("aws_db_instance.db", {
      publicly_accessible: true,
      engine: "postgres",
      port: 5432,
      vpc_security_group_ids: ["sg-web"],
    }),
  );
  expect(analyze(rs).report.paths).toHaveLength(0);
  at(rs, "aws_security_group").ingress[0].from_port = 5432;
  at(rs, "aws_security_group").ingress[0].to_port = 5432;
  expect(analyze(rs).report.paths).toHaveLength(1);
  at(rs, "aws_security_group").ingress[0].protocol = "udp";
  expect(analyze(rs).report.paths).toHaveLength(0);
});
it.each([
  { format_version: "1.0", planned_values: { root_module: true } },
  {
    format_version: "1.0",
    planned_values: { root_module: { child_modules: "bad" } },
  },
  {
    format_version: "1.0",
    planned_values: { root_module: { resources: [null] } },
  },
  {
    format_version: "1.0",
    planned_values: { root_module: {} },
    resource_changes: "bad",
  },
])(
  "rejects malformed plan collections instead of returning clean results",
  (input) => expect(() => parsePlan(input)).toThrow(),
);

it("resolves a relative child-module reference only inside that child module", () => {
  const p: any = {
    format_version: "1.0",
    planned_values: {
      root_module: {
        resources: [
          resource("aws_security_group.web", { id: "sg-root", ingress: [] }),
        ],
        child_modules: [
          {
            resources: [
              {
                ...resource("aws_security_group.web", { ingress: [] }),
                address: "module.child.aws_security_group.web",
              },
              {
                ...resource("aws_instance.web", {
                  associate_public_ip_address: true,
                }),
                address: "module.child.aws_instance.web",
              },
            ],
          },
        ],
      },
    },
    configuration: {
      root_module: {
        module_calls: {
          child: {
            module: {
              resources: [
                {
                  address: "aws_instance.web",
                  expressions: {
                    vpc_security_group_ids: {
                      references: ["aws_security_group.web.id"],
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
  };
  const edges = buildGraph(p).edges.filter(
    (e) => e.to === "module.child.aws_instance.web",
  );
  expect(edges.length).toBeGreaterThan(0);
  expect(
    edges.every((e) => e.from === "module.child.aws_security_group.web"),
  ).toBe(true);
});
