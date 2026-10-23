// Plan-shape building blocks for synthetic tests and deterministic benchmarks.
// Ground-truth expectations live separately in fixtures/scenarios/*/labels.json.
export interface FixtureResource {
  address: string;
  mode: string;
  type: string;
  name: string;
  values: Record<string, any>;
}
export function resource(
  address: string,
  values: Record<string, any>,
): FixtureResource {
  const [type, ...name] = address.split(".");
  return {
    address,
    mode: "managed",
    type: type!,
    name: name.join("."),
    values,
  };
}
export function plan(resources: FixtureResource[]) {
  return {
    format_version: "1.2",
    terraform_version: "1.15.9",
    planned_values: { root_module: { resources } },
  };
}
export function basicResources(publicIngress = true): FixtureResource[] {
  return [
    resource("aws_vpc.main", { id: "vpc-main" }),
    resource("aws_subnet.public", {
      id: "subnet-public",
      vpc_id: "vpc-main",
      map_public_ip_on_launch: true,
    }),
    resource("aws_internet_gateway.main", {
      id: "igw-main",
      vpc_id: "vpc-main",
    }),
    resource("aws_route_table.public", {
      id: "rt-public",
      route: [{ cidr_block: "0.0.0.0/0", gateway_id: "igw-main" }],
    }),
    resource("aws_route_table_association.public", {
      subnet_id: "subnet-public",
      route_table_id: "rt-public",
    }),
    resource("aws_security_group.web", {
      id: "sg-web",
      vpc_id: "vpc-main",
      ingress: [
        {
          protocol: "tcp",
          from_port: 80,
          to_port: 80,
          cidr_blocks: [publicIngress ? "0.0.0.0/0" : "10.0.0.0/8"],
        },
      ],
      egress: [{ protocol: "-1", cidr_blocks: ["0.0.0.0/0"] }],
    }),
    resource("aws_instance.web", {
      id: "i-web",
      subnet_id: "subnet-public",
      associate_public_ip_address: true,
      vpc_security_group_ids: ["sg-web"],
      iam_instance_profile: "web-profile",
    }),
    resource("aws_iam_instance_profile.web", {
      name: "web-profile",
      role: "web-role",
    }),
    resource("aws_iam_role.web", {
      name: "web-role",
      arn: "arn:aws:iam::111111111111:role/web-role",
      assume_role_policy: JSON.stringify({
        Statement: [
          {
            Effect: "Allow",
            Action: "sts:AssumeRole",
            Principal: { Service: "ec2.amazonaws.com" },
          },
        ],
      }),
    }),
    resource("aws_iam_role_policy.read", {
      role: "web-role",
      policy: JSON.stringify({
        Statement: [
          {
            Effect: "Allow",
            Action: "s3:GetObject",
            Resource: "arn:aws:s3:::example-data/*",
          },
        ],
      }),
    }),
    resource("aws_s3_bucket.data", {
      bucket: "example-data",
      arn: "arn:aws:s3:::example-data",
      acl: "private",
    }),
  ];
}
