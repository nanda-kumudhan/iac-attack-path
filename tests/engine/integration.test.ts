import { beforeAll, afterAll, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { evaluate } from "../../scripts/evaluation/run";
const execute = promisify(execFile);
let directory: string;
let cli: string;
let action: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "iac-engine-"));
  cli = join(directory, "cli.cjs");
  action = join(directory, "action.cjs");
  await Promise.all([
    build({
      entryPoints: ["src/cli/index.ts"],
      outfile: cli,
      bundle: true,
      platform: "node",
      target: "node24",
      format: "cjs",
    }),
    build({
      entryPoints: ["src/action/index.ts"],
      outfile: action,
      bundle: true,
      platform: "node",
      target: "node24",
      format: "cjs",
    }),
  ]);
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function run(file: string, args: string[], env = process.env) {
  try {
    return {
      code: 0,
      ...(await execute(process.execPath, [file, ...args], { env })),
    };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}
const base = resolve("fixtures/terraform-generated/base.json"),
  head = resolve("fixtures/terraform-generated/head.json");
it("CLI exits 1 for introduced paths and writes JSON, SARIF, Markdown and graph", async () => {
  const out = join(directory, "finding");
  const result = await run(cli, [
    "--base",
    base,
    "--head",
    head,
    "--out-dir",
    out,
    "--json",
  ]);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout).paths[0].change).toBe("introduced");
  for (const name of ["report.json", "report.sarif", "report.md", "graph.json"])
    expect((await readFile(join(out, name), "utf8")).length).toBeGreaterThan(0);
});
it("CLI exits 0 for an unchanged plan and 2 for missing or malformed input", async () => {
  expect(
    (
      await run(cli, [
        "--base",
        head,
        "--head",
        head,
        "--out-dir",
        join(directory, "unchanged"),
      ])
    ).code,
  ).toBe(0);
  expect((await run(cli, ["--head", "/nonexistent/input.json"])).code).toBe(2);
  const invalid = join(directory, "invalid.json");
  await writeFile(invalid, "PRIVATE-CONTENT");
  const result = await run(cli, ["--head", invalid]);
  expect(result.code).toBe(2);
  expect(result.stderr).not.toContain("PRIVATE-CONTENT");
});
it("Action directly compares plans, fails its gate and exports reports before failure", async () => {
  const out = join(directory, "action-output");
  const outputs = join(directory, "outputs");
  await writeFile(outputs, "");
  const result = await run(action, [], {
    ...process.env,
    "INPUT_BASE-PLAN": base,
    "INPUT_HEAD-PLAN": head,
    "INPUT_REPORT-FILE": "",
    "INPUT_ALLOW-DEMO": "false",
    "INPUT_FAIL-ON-INTRODUCED": "true",
    "INPUT_POST-COMMENT": "false",
    "INPUT_OUTPUT-DIRECTORY": out,
    GITHUB_OUTPUT: outputs,
  });
  expect(result.code).toBe(1);
  expect(result.stdout).toContain("1 introduced attack path(s)");
  expect(result.stdout).not.toContain("aws_s3_bucket");
  expect(await readFile(outputs, "utf8")).toContain("report-file");
  expect(
    JSON.parse(await readFile(join(out, "report.json"), "utf8")).cut.cost,
  ).toBe(1);
});
it("evaluation counts a documented miss instead of hiding unsupported chains", async () => {
  const result = await evaluate();
  expect(result.totals).toEqual({ found: 2, missed: 1, falsePaths: 0 });
  expect(
    result.results.find((r) => r.scenario === "rce_web_app")?.missedChains,
  ).toHaveLength(1);
  expect(result.results.every((r) => !r.independentReview)).toBe(true);
});
