import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { comparePlans, emptyPlan } from "../engine";
import { writeArtifacts } from "../action/artifacts";
import { readPlanFile } from "./input";
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "iac-attack-path --head head.json [--base base.json] [--out-dir iac-report] [--json] [--no-fail]\nExit: 0 no introduced paths; 1 introduced paths (including possible); 2 invalid/incomplete analysis.\nWithout --base, compare against empty infrastructure. Analysis is entirely offline.",
    );
    return;
  }
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (["--json", "--no-fail"].includes(key)) {
      flags.add(key);
      continue;
    }
    if (
      !["--base", "--head", "--out-dir"].includes(key) ||
      !args[i + 1] ||
      args[i + 1]!.startsWith("--") ||
      values.has(key)
    )
      throw new Error("Invalid CLI arguments; use --help");
    values.set(key, args[++i]!);
  }
  if (!values.has("--head")) throw new Error("--head is required; use --help");
  const [base, head] = await Promise.all([
    values.has("--base")
      ? readPlanFile(values.get("--base")!)
      : Promise.resolve(emptyPlan()),
    readPlanFile(values.get("--head")!),
  ]);
  const result = comparePlans(base, head);
  const directory = resolve(values.get("--out-dir") ?? "iac-report");
  await mkdir(directory, { recursive: true });
  await writeArtifacts(result.report, directory);
  await writeFile(
    resolve(directory, "report.json"),
    `${JSON.stringify(result.report, null, 2)}\n`,
  );
  await writeFile(
    resolve(directory, "graph.json"),
    `${JSON.stringify(result.headGraph, null, 2)}\n`,
  );
  if (flags.has("--json")) console.log(JSON.stringify(result.report));
  else {
    const introduced = result.report.paths.filter(
      (p) => p.change === "introduced",
    );
    console.log(
      `${introduced.length} introduced · ${result.report.paths.filter((p) => p.change === "removed").length} removed · ${result.report.paths.filter((p) => p.change === "unchanged").length} unchanged`,
    );
    for (const p of introduced) {
      console.log(
        `\n${p.certainty}: ${p.steps.map((s) => s.resource).join(" → ")}\n${p.explanation}`,
      );
    }
    console.log(`\nMinimum edit set (${result.cut.cost}):`);
    for (const e of result.cut.edits)
      console.log(`  ${e.resource} / ${e.attribute}: ${e.description}`);
    console.log(
      `\nReports: ${directory}\n${result.report.analysis.warnings.join("\n")}`,
    );
  }
  if (
    !flags.has("--no-fail") &&
    result.report.paths.some((p) => p.change === "introduced")
  )
    process.exitCode = 1;
}
void main().catch(() => {
  console.error(
    "Analysis failed: invalid arguments/input, unsupported plan format, malformed policy, or an analysis limit. Use --help and docs/limits.md. No clean verdict was produced.",
  );
  process.exitCode = 2;
});
