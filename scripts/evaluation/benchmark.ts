import { performance } from "node:perf_hooks";
import { cpus, platform, arch } from "node:os";
import { writeFile } from "node:fs/promises";
import { comparePlans } from "../../src/engine";
import { basicResources, plan, resource } from "./fixtures";
export function generatedPair(size: number) {
  const resources = basicResources();
  // Fixed deterministic workload: one vulnerable chain and independent private
  // SG/instance pairs. Includes graph extraction; it is not a dense IAM benchmark.
  while (resources.length < size) {
    const i = resources.length;
    resources.push(
      resource(`aws_security_group.private_${i}`, {
        id: `sg-${i}`,
        ingress: [],
      }),
    );
    if (resources.length < size)
      resources.push(
        resource(`aws_instance.private_${i}`, {
          associate_public_ip_address: false,
          vpc_security_group_ids: [`sg-${i}`],
        }),
      );
  }
  const head = plan(resources);
  const base = structuredClone(head);
  base.planned_values.root_module.resources.find(
    (r) => r.type === "aws_security_group",
  )!.values.ingress = [];
  return { base, head };
}
const measurements = [];
for (const size of [500, 5000]) {
  const { base, head } = generatedPair(size);
  const baseJson = JSON.stringify(base),
    headJson = JSON.stringify(head);
  comparePlans(baseJson, headJson); // Warmup excluded.
  const times = [];
  let sample: ReturnType<typeof comparePlans> | undefined;
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    sample = comparePlans(baseJson, headJson);
    times.push(performance.now() - start);
  }
  const sorted = [...times].sort((a, b) => a - b);
  measurements.push({
    resourcesPerPlan: size,
    inputBytes: Buffer.byteLength(baseJson) + Buffer.byteLength(headJson),
    timesMs: times.map((t) => Number(t.toFixed(2))),
    medianMs: Number(sorted[2]!.toFixed(2)),
    headNodes: sample!.headGraph.nodes.length,
    headEdges: sample!.headGraph.edges.length,
    introduced: sample!.report.paths.filter((p) => p.change === "introduced")
      .length,
  });
}
const result = {
  node: process.version,
  platform: platform(),
  arch: arch(),
  cpu: cpus()[0]?.model,
  scope:
    "JSON parse, both graph extractions, path searches, diff, exact edit cut and report validation; excludes file I/O. Five runs after one warmup. Deterministic sparse graph, one exposed chain. Not representative of dense IAM graphs.",
  measurements,
};
await writeFile(
  "docs/benchmark-results.json",
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result, null, 2));
