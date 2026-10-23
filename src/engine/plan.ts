import { AnalysisError, list, object, strings, type Certainty } from "./model";
export const MAX_PLAN_BYTES = 50 * 1024 * 1024;
export interface Resource {
  address: string;
  type: string;
  values: Record<string, any>;
  unknown: Record<string, any>;
  expressions: Record<string, any>;
}
export interface Plan {
  resources: Resource[];
  warnings: string[];
}
export function parsePlan(input: unknown): Plan {
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > MAX_PLAN_BYTES)
      throw new AnalysisError("Plan exceeds 50 MiB");
    try {
      input = JSON.parse(input);
    } catch {
      throw new AnalysisError("Invalid Terraform plan JSON");
    }
  }
  const isObject = (value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const raw = object(input);
  if (
    typeof raw.format_version !== "string" ||
    !/^1\.\d+$/.test(raw.format_version)
  )
    throw new AnalysisError("Expected Terraform JSON format major version 1");
  if (
    !isObject(raw.planned_values) ||
    !isObject(raw.planned_values.root_module)
  )
    throw new AnalysisError(
      "Expected planned_values.root_module from terraform show -json (state files are not plans)",
    );
  if (raw.errored === true)
    throw new AnalysisError("Terraform reported an errored plan");
  if (raw.complete === false)
    throw new AnalysisError(
      "Incomplete/deferred Terraform plan cannot provide a complete comparison",
    );
  const warnings: string[] = [];
  const configs = new Map<string, Record<string, any>>();
  const walkConfig = (module: any, prefix = "", depth = 0) => {
    if (depth > 40)
      throw new AnalysisError("Terraform configuration nesting exceeds 40");
    for (const r of list(module?.resources))
      configs.set(`${prefix}${r.address}`, object(r.expressions));
    for (const [name, call] of Object.entries(object(module?.module_calls)))
      walkConfig(object(call).module, `${prefix}module.${name}.`, depth + 1);
  };
  walkConfig(object(raw.configuration).root_module);
  const changes = new Map<string, any>();
  if (
    raw.resource_changes !== undefined &&
    !Array.isArray(raw.resource_changes)
  )
    throw new AnalysisError("Invalid Terraform resource_changes");
  for (const c of list(raw.resource_changes)) {
    if (!isObject(c) || typeof c.address !== "string" || !isObject(c.change))
      throw new AnalysisError("Invalid Terraform resource change");
    if (
      c.change.after_unknown !== undefined &&
      !isObject(c.change.after_unknown)
    )
      throw new AnalysisError("Invalid Terraform resource unknown mask");
    changes.set(c.address, c.change);
  }
  const resources: Resource[] = [];
  const seen = new Set<string>();
  const walk = (module: any, depth = 0) => {
    if (depth > 40)
      throw new AnalysisError("Terraform module nesting exceeds 40");
    if (!Array.isArray(module?.resources) && module?.resources !== undefined)
      throw new AnalysisError("Invalid Terraform module resources");
    if (
      !isObject(module) ||
      (module.child_modules !== undefined &&
        !Array.isArray(module.child_modules))
    )
      throw new AnalysisError("Invalid Terraform module shape");
    for (const r of list(module?.resources)) {
      if (!isObject(r))
        throw new AnalysisError("Invalid Terraform resource shape");
      if (r.mode === "data") continue;
      if (
        typeof r.address !== "string" ||
        typeof r.type !== "string" ||
        !r.values ||
        !isObject(r.values)
      )
        throw new AnalysisError("Invalid Terraform resource shape");
      if (r.address.length > 1000)
        throw new AnalysisError("Resource address exceeds 1000 characters");
      if (seen.has(r.address))
        throw new AnalysisError("Duplicate Terraform resource address");
      seen.add(r.address);
      const change = object(changes.get(r.address));
      if (change.after === null) continue;
      const configAddress = r.address.replace(
        /\[(?:\d+|"(?:[^"\\]|\\.)*")\]/g,
        "",
      );
      resources.push({
        address: r.address,
        type: r.type,
        values: object(r.values),
        unknown: object(change.after_unknown),
        expressions: configs.get(r.address) ?? configs.get(configAddress) ?? {},
      });
    }
    for (const child of list(module?.child_modules)) walk(child, depth + 1);
  };
  walk(raw.planned_values.root_module);
  if (resources.length > 20000)
    throw new AnalysisError("Plan exceeds the 20,000-resource analysis limit");
  return { resources, warnings };
}
export class Resolver {
  private byValue = new Map<string, Resource[]>();
  constructor(readonly plan: Plan) {
    for (const r of plan.resources)
      for (const v of [
        r.address,
        r.values.id,
        r.values.name,
        r.values.arn,
        r.values.bucket,
        r.values.identifier,
      ])
        if (typeof v === "string") {
          const existing = this.byValue.get(v) ?? [];
          if (!existing.includes(r)) existing.push(r);
          this.byValue.set(v, existing);
        }
  }
  resolve(
    source: Resource,
    attribute: string,
    types: string[],
  ): { resource: Resource; certainty: Certainty }[] {
    const result = new Map<
      string,
      { resource: Resource; certainty: Certainty }
    >();
    for (const value of strings(source.values[attribute]))
      for (const r of this.byValue.get(value) ?? [])
        if (types.includes(r.type))
          result.set(r.address, { resource: r, certainty: "definite" });
    // References are evidence of dependency, not evaluated values. Keep ambiguity possible.
    if (!result.size) {
      const references = strings(
        object(source.expressions[attribute]).references,
      );
      const prefix = source.address.slice(
        0,
        source.address.lastIndexOf(`${source.type}.`),
      );
      for (const ref of references)
        for (const candidate of [
          prefix && !ref.startsWith(prefix) ? `${prefix}${ref}` : ref,
        ]) {
          for (const r of this.plan.resources)
            if (
              types.includes(r.type) &&
              (candidate === r.address ||
                candidate.startsWith(`${r.address}.`) ||
                r.address.startsWith(`${candidate}[`))
            )
              result.set(r.address, { resource: r, certainty: "possible" });
        }
    }
    return [...result.values()];
  }
}
