import {
  AnalysisError,
  canonical,
  identity,
  hasUnknown,
  list,
  object,
  possible,
  strings,
  type Certainty,
  type Edge,
  type Graph,
  type NodeKind,
} from "./model";
import { parsePlan, Resolver, type Resource } from "./plan";
import { extractIam } from "./iam";
const kinds: Record<string, NodeKind> = {
  aws_security_group: "SecurityGroup",
  aws_instance: "Instance",
  aws_iam_role: "Role",
  aws_s3_bucket: "Bucket",
  aws_db_instance: "Database",
  aws_rds_cluster: "Database",
};
const auxiliary = new Set([
  "aws_vpc",
  "aws_subnet",
  "aws_internet_gateway",
  "aws_route",
  "aws_route_table",
  "aws_route_table_association",
  "aws_main_route_table_association",
  "aws_security_group_rule",
  "aws_vpc_security_group_ingress_rule",
  "aws_vpc_security_group_egress_rule",
  "aws_iam_instance_profile",
  "aws_iam_role_policy",
  "aws_iam_policy",
  "aws_iam_role_policy_attachment",
  "aws_iam_policy_attachment",
  "aws_s3_bucket_policy",
  "aws_s3_bucket_acl",
  "aws_s3_bucket_public_access_block",
  "aws_s3_bucket_ownership_controls",
  "aws_eip",
  "aws_eip_association",
]);
interface Rule {
  sg: Resource;
  source: Resource;
  value: Record<string, any>;
  attribute: string;
  certainty: Certainty;
}
export function buildGraph(input: unknown): Graph {
  const plan = parsePlan(input);
  const resolver = new Resolver(plan);
  const graph: Graph = {
    nodes: [{ id: "internet", kind: "Internet" }],
    edges: [],
    warnings: [...plan.warnings],
  };
  const warn = (s: string) => {
    if (!graph.warnings.includes(s) && graph.warnings.length < 95)
      graph.warnings.push(s);
  };
  warn(
    "Heuristic AWS subset: reachable services require an application exploit or credentials; network reachability does not prove compromise.",
  );
  warn(
    "NACLs, service listeners, organization/session policies, KMS, cross-account access and external resources are not fully evaluated.",
  );
  const edges = new Map<string, string>();
  const editKeys = new Map<string, string>();
  const add = (e: Omit<Edge, "id">) => {
    if (e.edit) {
      const key = canonical(e.edit);
      if (editKeys.has(e.edit.id) && editKeys.get(e.edit.id) !== key)
        throw new AnalysisError("Edit identity collision");
      editKeys.set(e.edit.id, key);
    }
    const key = canonical(e);
    const id = identity("edge", e);
    if (edges.has(id) && edges.get(id) !== key)
      throw new AnalysisError("Edge identity collision");
    if (!edges.has(id)) {
      edges.set(id, key);
      graph.edges.push({ ...e, id });
    }
    if (graph.edges.length > 50000)
      throw new AnalysisError("Graph exceeds 50,000 edges");
  };
  for (const r of plan.resources) {
    const kind = kinds[r.type];
    if (kind) graph.nodes.push({ id: r.address, kind });
    else if (!auxiliary.has(r.type))
      warn(
        `Unsupported resource type: ${r.type}. Paths through it may be missed.`,
      );
  }
  const groups = plan.resources.filter((r) => r.type === "aws_security_group");
  const instances = plan.resources.filter((r) => r.type === "aws_instance");
  const databases = plan.resources.filter((r) =>
    ["aws_db_instance", "aws_rds_cluster"].includes(r.type),
  );
  const rules: Rule[] = [];
  for (const sg of groups) {
    for (const value of list(sg.values.ingress))
      rules.push({
        sg,
        source: sg,
        value: object(value),
        attribute: "ingress",
        certainty: "definite",
      });
    if (hasUnknown(sg.unknown.ingress)) {
      warn(
        "Unknown security-group ingress is modelled as possible public ingress.",
      );
      rules.push({
        sg,
        source: sg,
        value: { cidr_blocks: ["0.0.0.0/0", "::/0"], protocol: "-1" },
        attribute: "ingress",
        certainty: "possible",
      });
    }
  }
  for (const r of plan.resources)
    if (
      (r.type === "aws_security_group_rule" && r.values.type === "ingress") ||
      r.type === "aws_vpc_security_group_ingress_rule"
    ) {
      const targets = resolver.resolve(r, "security_group_id", [
        "aws_security_group",
      ]);
      if (!targets.length)
        warn(
          "An ingress rule has an unresolved security group; paths may be missed.",
        );
      for (const { resource: sg, certainty } of targets)
        rules.push({
          sg,
          source: r,
          value: r.values,
          attribute:
            r.type === "aws_security_group_rule" ? "cidr_blocks" : "cidr_ipv4",
          certainty,
        });
    }
  function attached(r: Resource) {
    return resolver
      .resolve(
        r,
        r.type === "aws_instance"
          ? "vpc_security_group_ids"
          : "vpc_security_group_ids",
        ["aws_security_group"],
      )
      .concat(
        r.type === "aws_instance"
          ? resolver.resolve(r, "security_groups", ["aws_security_group"])
          : [],
      );
  }
  function route(r: Resource, family: "ipv4" | "ipv6"): Certainty | false {
    const subnets = resolver.resolve(r, "subnet_id", ["aws_subnet"]);
    if (!subnets.length) {
      warn(
        "Missing subnet/routing evidence is possible reachability, not a confirmed public route.",
      );
      return "possible";
    }
    let uncertain = false;
    for (const subnet of subnets) {
      const associations = plan.resources.filter(
        (a) =>
          a.type === "aws_route_table_association" &&
          resolver
            .resolve(a, "subnet_id", ["aws_subnet"])
            .some((x) => x.resource.address === subnet.resource.address),
      );
      const tables = associations.flatMap((a) =>
        resolver.resolve(a, "route_table_id", ["aws_route_table"]),
      );
      if (!tables.length) {
        const vpcs = resolver.resolve(subnet.resource, "vpc_id", ["aws_vpc"]);
        for (const a of plan.resources.filter(
          (a) =>
            a.type === "aws_main_route_table_association" &&
            resolver
              .resolve(a, "vpc_id", ["aws_vpc"])
              .some((x) =>
                vpcs.some((v) => v.resource.address === x.resource.address),
              ),
        ))
          tables.push(
            ...resolver.resolve(a, "route_table_id", ["aws_route_table"]),
          );
      }
      if (!tables.length) {
        uncertain = true;
        continue;
      }
      for (const table of tables) {
        const candidates = [
          ...list(table.resource.values.route),
          ...plan.resources
            .filter(
              (a) =>
                a.type === "aws_route" &&
                resolver
                  .resolve(a, "route_table_id", ["aws_route_table"])
                  .some((x) => x.resource.address === table.resource.address),
            )
            .map((a) => ({ ...a.values, __resource: a })),
        ];
        for (const entry of candidates)
          if (
            (family === "ipv4"
              ? (entry.cidr_block ?? entry.destination_cidr_block)
              : (entry.ipv6_cidr_block ??
                entry.destination_ipv6_cidr_block)) ===
            (family === "ipv4" ? "0.0.0.0/0" : "::/0")
          ) {
            const src = entry.__resource ?? {
              ...table.resource,
              values: entry,
            };
            const gateways = resolver.resolve(src, "gateway_id", [
              "aws_internet_gateway",
            ]);
            if (
              gateways.length ||
              (typeof entry.gateway_id === "string" &&
                entry.gateway_id.startsWith("igw-"))
            )
              return possible(
                subnet.certainty,
                table.certainty,
                gateways[0]?.certainty ?? "definite",
              );
            if (entry.gateway_id == null && object(src.unknown).gateway_id)
              uncertain = true;
          }
        if (hasUnknown(table.resource.unknown.route)) uncertain = true;
      }
    }
    return uncertain ? "possible" : false;
  }
  function exposure(r: Resource, family: "ipv4" | "ipv6"): Certainty | false {
    if (r.type !== "aws_instance") {
      if (r.values.publicly_accessible === false) return false;
      return "possible"; // DB subnet groups and authentication are not fully modelled.
    }
    let address: Certainty | false = false;
    if (family === "ipv4") {
      if (
        r.values.public_ip ||
        r.values.associate_public_ip_address === true ||
        plan.resources.some(
          (e) =>
            ["aws_eip", "aws_eip_association"].includes(e.type) &&
            resolver
              .resolve(e, "instance", ["aws_instance"])
              .some((x) => x.resource.address === r.address),
        )
      )
        address = "definite";
      else if (r.unknown.public_ip || r.unknown.associate_public_ip_address)
        address = "possible";
      else if (r.values.associate_public_ip_address !== false) {
        const subnets = resolver.resolve(r, "subnet_id", ["aws_subnet"]);
        if (
          subnets.some(
            (s) => s.resource.values.map_public_ip_on_launch === true,
          )
        )
          address = "possible";
        else if (
          !subnets.length ||
          subnets.some((s) => s.resource.values.map_public_ip_on_launch == null)
        )
          address = "possible";
      }
    } else if (
      strings(r.values.ipv6_addresses).length ||
      Number(r.values.ipv6_address_count) > 0
    )
      address = "definite";
    else if (r.unknown.ipv6_addresses || r.unknown.ipv6_address_count)
      address = "possible";
    if (!address) return false;
    const reach = route(r, family);
    return reach === false ? false : possible(address, reach);
  }
  for (const rule of rules) {
    const v = rule.value;
    const protocol = String(v.protocol ?? v.ip_protocol ?? "-1");
    // ICMP alone does not establish an application or database attack surface.
    if (!["-1", "tcp", "udp", "6", "17"].includes(protocol)) continue;
    const cidrs = [
      ...strings(v.cidr_blocks),
      ...strings(v.ipv6_cidr_blocks),
      ...strings(v.cidr_ipv4),
      ...strings(v.cidr_ipv6),
    ];
    const semantic = {
      protocol,
      from: v.from_port ?? null,
      to: v.to_port ?? null,
      cidrs: [...cidrs].sort(),
      sources: [
        ...strings(v.security_groups),
        ...strings(v.referenced_security_group_id),
      ].sort(),
    };
    const edit = {
      id: identity("edit", [rule.source.address, semantic]),
      resource: rule.source.address,
      attribute:
        rule.source.type === "aws_security_group"
          ? `ingress[${identity("rule", semantic)}]`
          : rule.source.type === "aws_vpc_security_group_ingress_rule"
            ? v.cidr_ipv6
              ? "cidr_ipv6"
              : "cidr_ipv4"
            : "cidr_blocks",
      description: `Remove public ${protocol} ingress on ports ${v.from_port ?? "all"}–${v.to_port ?? "all"} from ${cidrs.join(", ")} or restrict its source to an approved private network.`,
    };
    for (const family of ["ipv4", "ipv6"] as const)
      if (cidrs.includes(family === "ipv4" ? "0.0.0.0/0" : "::/0")) {
        add({
          from: "internet",
          to: rule.sg.address,
          kind: "ingress",
          family,
          protocol,
          ports: [Number(v.from_port ?? 0), Number(v.to_port ?? 65535)],
          certainty: rule.certainty,
          evidence: `Public ${family} ingress, protocol ${protocol}, ports ${v.from_port ?? "all"}–${v.to_port ?? "all"}.`,
          edit,
        });
      }
  }
  for (const r of [...instances, ...databases]) {
    const links = attached(r);
    if (
      !links.length &&
      (r.unknown.vpc_security_group_ids || r.values.vpc_security_group_ids)
    )
      warn(
        "A compute/database security-group attachment is unresolved; paths may be missed.",
      );
    for (const link of links)
      for (const family of ["ipv4", "ipv6"] as const) {
        const certainty = exposure(r, family);
        if (!certainty) continue;
        add({
          from: link.resource.address,
          to: r.address,
          kind: "network",
          families: [family],
          ...(r.type !== "aws_instance"
            ? {
                requiresPort: Number(
                  r.values.port ??
                    (String(r.values.engine).includes("postgres")
                      ? 5432
                      : 3306),
                ),
              }
            : {}),
          certainty: possible(link.certainty, certainty),
          evidence:
            "Attached security group plus public addressing/routing evidence. Listener availability and NACLs require review.",
        });
      }
  }
  for (const instance of instances) {
    for (const profile of resolver.resolve(instance, "iam_instance_profile", [
      "aws_iam_instance_profile",
    ]))
      for (const role of resolver.resolve(profile.resource, "role", [
        "aws_iam_role",
      ]))
        add({
          from: instance.address,
          to: role.resource.address,
          kind: "credentials",
          certainty: "possible",
          evidence:
            "Assumes exploitation of a reachable application or SSRF and theft/use of instance-profile credentials; IMDSv2 is not proof of prevention.",
          edit: {
            id: identity("edit", [instance.address, "iam_instance_profile"]),
            resource: instance.address,
            attribute: "iam_instance_profile",
            description:
              "Detach or replace the instance profile with a role that cannot reach the data.",
          },
        });
    for (const database of databases)
      for (const rule of rules.filter((rule) =>
        attached(database).some((s) => s.resource.address === rule.sg.address),
      )) {
        const sources = [
          ...strings(rule.value.security_groups),
          ...strings(rule.value.referenced_security_group_id),
          ...strings(rule.value.source_security_group_id),
        ];
        if (
          !attached(instance).some(
            (s) =>
              sources.includes(s.resource.values.id) ||
              sources.includes(s.resource.address),
          )
        )
          continue;
        const dbPort =
          database.values.port ??
          (String(database.values.engine).includes("postgres") ? 5432 : 3306);
        if (
          String(rule.value.protocol ?? rule.value.ip_protocol) !== "-1" &&
          !(
            Number(rule.value.from_port) <= dbPort &&
            Number(rule.value.to_port) >= dbPort
          )
        )
          continue;
        const ivpc = resolver.resolve(instance, "subnet_id", ["aws_subnet"])[0]
          ?.resource.values.vpc_id;
        const gvpc = rule.sg.values.vpc_id;
        if (ivpc && gvpc && ivpc !== gvpc) continue;
        add({
          from: instance.address,
          to: database.address,
          kind: "network",
          certainty: "possible",
          evidence:
            "Security-group source reference permits database port; assumes source egress, private routing, application compromise and database credentials.",
          edit: {
            id: identity("edit", [
              rule.source.address,
              rule.attribute,
              rule.value,
            ]),
            resource: rule.source.address,
            attribute:
              rule.source.type === "aws_security_group"
                ? "ingress"
                : "source_security_group_id",
            description:
              "Remove this database ingress rule from the exposed instance security group.",
          },
        });
      }
  }
  extractIam(plan, resolver, add, warn);
  graph.nodes.sort((a, b) => a.id.localeCompare(b.id));
  graph.edges.sort((a, b) => a.id.localeCompare(b.id));
  return graph;
}
