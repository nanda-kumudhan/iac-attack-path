import { readFile, stat } from "node:fs/promises";
import { MAX_PLAN_BYTES } from "../engine/plan";
export async function readPlanFile(file: string): Promise<string> {
  if ((await stat(file)).size > MAX_PLAN_BYTES)
    throw new Error("Plan exceeds 50 MiB");
  return readFile(file, "utf8");
}
