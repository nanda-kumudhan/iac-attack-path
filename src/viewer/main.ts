import type { Core, ElementDefinition } from "cytoscape";
import demoBase from "../../fixtures/scenarios/ec2_ssrf/base.json";
import demoHead from "../../fixtures/scenarios/ec2_ssrf/head.json";
import { MAX_PLAN_BYTES } from "../engine/plan";
import {
  counts,
  MAX_REPORT_BYTES,
  parseReport,
  type Report,
  type ReportPath,
} from "../report/schema";
import { formatMarkdown } from "../report/markdown";
import { formatSarif } from "../report/sarif";
import "./style.css";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
}

let report: Report | undefined;
let graph: Core | undefined;
let selectedId: string | undefined;
let fileRevision = 0;
let graphRevision = 0;
let analysisWorker: Worker | undefined;
const fileInput = element<HTMLInputElement>("report-file");
const changeFilter = element<HTMLSelectElement>("change-filter");
const certaintyFilter = element<HTMLSelectElement>("certainty-filter");
const search = element<HTMLInputElement>("search");

function paragraph(text: string, className?: string): HTMLParagraphElement {
  const item = document.createElement("p");
  item.textContent = text;
  if (className) item.className = className;
  return item;
}

async function renderSelection(path?: ReportPath) {
  const revision = ++graphRevision;
  graph?.destroy();
  graph = undefined;
  const detail = element("path-detail");
  detail.replaceChildren();
  element("graph-empty").hidden = Boolean(path);
  element<HTMLButtonElement>("fit").disabled = !path;
  element("selected-count").textContent = path
    ? `${path.steps.length} resources`
    : "No selection";
  if (!path) {
    element("graph").setAttribute("aria-label", "No matching path selected");
    element("empty-title").textContent = report
      ? "No matching paths"
      : "No path selected";
    element("empty-description").textContent = report
      ? "Adjust the filters or search to inspect another path."
      : "Open a report or load the demo to inspect a resource chain.";
    detail.append(
      paragraph(
        "No path selected. Adjust the filters or open a report.",
        "muted",
      ),
    );
    return;
  }
  const heading = document.createElement("h3");
  heading.textContent = path.id;
  const resourceHeading = document.createElement("h4");
  resourceHeading.textContent = "Resource sequence";
  detail.append(
    heading,
    paragraph(
      `${path.change} / ${path.certainty}`,
      `certainty ${path.certainty}`,
    ),
    paragraph(path.explanation, "evidence-copy"),
    resourceHeading,
  );
  const ordered = document.createElement("ol");
  ordered.className = "resource-sequence";
  path.steps.forEach((step) => {
    const li = document.createElement("li");
    li.textContent = step.resource;
    ordered.append(li);
  });
  detail.append(ordered);
  if (report?.cut) {
    detail.append(
      paragraph(
        `Minimum edit set: ${report.cut.cost} change(s) to block all introduced paths.`,
        "source",
      ),
    );
    const edits = document.createElement("ul");
    edits.className = "cut-list";
    for (const edit of report.cut.edits) {
      const li = document.createElement("li");
      li.textContent = `${edit.resource} / ${edit.attribute}: ${edit.description}`;
      edits.append(li);
    }
    detail.append(edits);
  }
  if (path.location)
    detail.append(
      paragraph(
        `Source: ${path.location.file}:${path.location.line}`,
        "source",
      ),
    );
  if (path.remediation) {
    const suggestion = document.createElement("div");
    suggestion.className = "suggestion";
    const title = document.createElement("strong");
    title.textContent = "Suggested change";
    suggestion.append(
      title,
      paragraph(path.remediation.description),
      paragraph(
        `${path.remediation.resource} / ${path.remediation.attribute}`,
        "source",
      ),
    );
    detail.append(suggestion);
  }
  const elements: ElementDefinition[] = [];
  // Display occurrences in supplied order. No analysis graph or path search here.
  path.steps.forEach((step, index) => {
    elements.push({
      data: {
        id: `step-${index}`,
        label:
          step.resource.length > 90
            ? `${step.resource.slice(0, 87)}…`
            : step.resource,
        start: index === 0 ? "yes" : "no",
        end: index === path.steps.length - 1 ? "yes" : "no",
      },
    });
    if (index > 0)
      elements.push({
        data: {
          id: `link-${index}`,
          source: `step-${index - 1}`,
          target: `step-${index}`,
        },
      });
  });
  element("graph").setAttribute(
    "aria-label",
    `${path.certainty} ${path.change} path: ${path.steps.map((step) => step.resource).join(" to ")}. The same sequence is listed in the evidence panel.`,
  );
  // Load the renderer only after a path is selected; all chunks remain local.
  const { default: cytoscape } = await import("cytoscape");
  if (revision !== graphRevision) return;
  graph = cytoscape({
    container: element("graph"),
    elements,
    layout: {
      name: "preset",
      positions: Object.fromEntries(
        path.steps.map((_, index) => [
          `step-${index}`,
          { x: 0, y: index * 76 },
        ]),
      ),
      padding: 28,
    },
    style: [
      {
        selector: "node",
        style: {
          "background-color": "#ffffff",
          "border-color": "#8092a8",
          "border-width": 1.25,
          shape: "rectangle",
          width: 240,
          height: 48,
          label: "data(label)",
          "font-family": "ui-monospace, monospace",
          "font-size": 11,
          color: "#29394e",
          "text-wrap": "wrap",
          "text-max-width": "220px",
          "text-valign": "center",
          "text-halign": "center",
        },
      },
      {
        selector: 'node[start = "yes"]',
        style: {
          "background-color": "#25354b",
          color: "#fff",
          "border-color": "#25354b",
        },
      },
      {
        selector: 'node[end = "yes"]',
        style: { "background-color": "#fff3f2", "border-color": "#b8615b" },
      },
      {
        selector: "edge",
        style: {
          width: 1.25,
          "line-color": "#8491a2",
          "target-arrow-color": "#8491a2",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          "line-style": path.certainty === "possible" ? "dashed" : "solid",
        },
      },
    ],
    minZoom: 0.05,
    maxZoom: 2,
    wheelSensitivity: 0.2,
  });
}

function renderPaths() {
  const list = element("path-list");
  list.replaceChildren();
  const query = search.value.trim().toLowerCase();
  const paths =
    report?.paths.filter(
      (path) =>
        (changeFilter.value === "all" || path.change === changeFilter.value) &&
        (certaintyFilter.value === "all" ||
          path.certainty === certaintyFilter.value) &&
        (!query ||
          `${path.id} ${path.steps.map((step) => step.resource).join(" ")}`
            .toLowerCase()
            .includes(query)),
    ) ?? [];
  element("path-count").textContent = String(paths.length);
  if (!paths.some((path) => path.id === selectedId)) selectedId = paths[0]?.id;
  for (const path of paths.slice(0, 200)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "path-card";
    button.dataset.change = path.change;
    button.setAttribute("aria-pressed", String(path.id === selectedId));
    const title = document.createElement("strong");
    title.textContent = path.steps.at(-1)!.resource;
    const label = document.createElement("span");
    label.className = `certainty ${path.certainty}`;
    label.textContent = `${path.change} · ${path.certainty}`;
    button.append(
      label,
      title,
      paragraph(`${path.steps.length} resources · ${path.id}`),
    );
    button.addEventListener("click", () => {
      selectedId = path.id;
      // Preserve the focused button for keyboard users.
      for (const option of list.querySelectorAll<HTMLButtonElement>("button"))
        option.setAttribute("aria-pressed", String(option === button));
      void renderSelection(path);
    });
    list.append(button);
  }
  if (!paths.length)
    list.append(
      paragraph(
        report
          ? "No paths match these filters."
          : "Load a report to explore its paths.",
        "muted",
      ),
    );
  if (paths.length > 200)
    list.append(
      paragraph(
        `Showing the first 200 of ${paths.length} matches. Search to narrow the list.`,
        "muted",
      ),
    );
  void renderSelection(paths.find((path) => path.id === selectedId));
}

function loadReport(next: Report, name: string) {
  report = next;
  selectedId = undefined;
  search.value = "";
  changeFilter.value = "introduced";
  certaintyFilter.value = "all";
  element("error").hidden = true;
  element("report-name").textContent = name;
  const total = counts(report);
  element("introduced-count").textContent = String(total.introduced);
  element("removed-count").textContent = String(total.removed);
  element("unchanged-count").textContent = String(total.unchanged);
  element("possible-count").textContent = String(total.possible);
  element("demo-notice").hidden = report.analysis.status !== "demo";
  const warnings = element("warning-list");
  warnings.replaceChildren();
  report.analysis.warnings.forEach((warning) => {
    const item = document.createElement("li");
    item.textContent = warning;
    warnings.append(item);
  });
  for (const id of ["clear", "export-json", "export-md", "export-sarif"])
    element<HTMLButtonElement>(id).disabled = false;
  element("status").textContent =
    `Loaded ${report.paths.length} paths from ${name}. ${total.introduced} introduced.`;
  renderPaths();
}

element("open-report").addEventListener("click", () => {
  analysisWorker?.terminate();
  setBusy(false);
  fileInput.click();
});
fileInput.addEventListener("change", async () => {
  const revision = ++fileRevision;
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_REPORT_BYTES)
      throw new Error("File exceeds the 5 MiB limit.");
    const parsed = parseReport(await file.text());
    if (revision === fileRevision) loadReport(parsed, file.name);
  } catch {
    if (revision !== fileRevision) return;
    element("error").textContent =
      "Could not open this file. Choose a valid v1 report under 5 MiB. Use the plan comparison controls for raw Terraform plans. Any previously loaded report is still displayed.";
    element("error").hidden = false;
  } finally {
    if (revision === fileRevision) fileInput.value = "";
  }
});
element("load-demo").addEventListener("click", () => {
  void analyze(
    JSON.stringify(demoBase),
    JSON.stringify(demoHead),
    "CloudGoat SSRF · normalized example",
    true,
  );
});
element("clear").addEventListener("click", () => {
  fileRevision++;
  analysisWorker?.terminate();
  setBusy(false);
  element<HTMLInputElement>("base-plan").value = "";
  element<HTMLInputElement>("head-plan").value = "";
  report = undefined;
  selectedId = undefined;
  fileInput.value = "";
  search.value = "";
  element("report-name").textContent = "No report loaded";
  for (const id of [
    "introduced-count",
    "removed-count",
    "unchanged-count",
    "possible-count",
  ])
    element(id).textContent = "—";
  for (const id of ["clear", "export-json", "export-md", "export-sarif"])
    element<HTMLButtonElement>(id).disabled = true;
  element("demo-notice").hidden = true;
  element("error").hidden = true;
  element("warning-list").replaceChildren();
  element("status").textContent = "Report cleared from the viewer.";
  renderPaths();
});
changeFilter.addEventListener("change", renderPaths);
certaintyFilter.addEventListener("change", renderPaths);
search.addEventListener("input", renderPaths);
element("fit").addEventListener("click", () => graph?.fit(undefined, 28));
new ResizeObserver(() => {
  graph?.resize();
  graph?.fit(undefined, 28);
}).observe(element("graph"));

function download(content: string, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
element("export-md").addEventListener("click", () => {
  if (report) download(formatMarkdown(report), "report.md", "text/markdown");
});
element("export-sarif").addEventListener("click", () => {
  if (report)
    download(
      JSON.stringify(formatSarif(report), null, 2),
      "report.sarif",
      "application/json",
    );
});

element("export-json").addEventListener("click", () => {
  if (report)
    download(
      JSON.stringify(report, null, 2),
      "report.json",
      "application/json",
    );
});
function setBusy(busy: boolean) {
  element<HTMLButtonElement>("analyze-plans").disabled = busy;
  element("cancel-analysis").hidden = !busy;
  element("analyze-plans").textContent = busy ? "Analyzing…" : "Analyze plans";
}
async function analyze(
  base: string | undefined,
  head: string,
  name: string,
  demo = false,
) {
  const revision = ++fileRevision;
  analysisWorker?.terminate();
  setBusy(true);
  element("error").hidden = true;
  element("status").textContent = "Analyzing locally in a worker…";
  try {
    const worker = new Worker(
      new URL("./analysis.worker.ts", import.meta.url),
      { type: "module" },
    );
    analysisWorker = worker;
    const finishError = (message: string) => {
      if (revision !== fileRevision) return;
      element("error").textContent = message;
      element("error").hidden = false;
      element("status").textContent =
        "Analysis failed; no new verdict. Previous report, if present, remains displayed.";
      setBusy(false);
      worker.terminate();
    };
    worker.onmessage = (event) => {
      if (revision !== fileRevision) return;
      if (!event.data.ok) {
        finishError(event.data.error);
        return;
      }
      try {
        loadReport(parseReport(JSON.stringify(event.data.report)), name);
      } catch {
        finishError(
          "Analysis output was invalid. No clean verdict was produced.",
        );
      } finally {
        setBusy(false);
        worker.terminate();
      }
    };
    worker.onerror = () =>
      finishError(
        "The analysis worker could not run. No clean verdict was produced.",
      );
    worker.postMessage({ base, head, demo });
  } catch {
    setBusy(false);
    element("error").textContent =
      "Browser workers are unavailable. Use the local CLI.";
    element("error").hidden = false;
  }
}
element("analyze-plans").addEventListener("click", async () => {
  const head = element<HTMLInputElement>("head-plan").files?.[0];
  const base = element<HTMLInputElement>("base-plan").files?.[0];
  if (!head) {
    element("error").textContent = "Choose a head plan to analyze.";
    element("error").hidden = false;
    return;
  }
  if (head.size > MAX_PLAN_BYTES || (base && base.size > MAX_PLAN_BYTES)) {
    element("error").textContent = "Each plan must be at most 50 MiB.";
    element("error").hidden = false;
    return;
  }
  const revision = ++fileRevision;
  try {
    const [baseText, headText] = await Promise.all([base?.text(), head.text()]);
    if (revision === fileRevision)
      await analyze(
        baseText,
        headText,
        `${base?.name ?? "Empty base"} → ${head.name}`,
      );
  } catch {
    element("error").textContent = "Could not read the selected plans.";
    element("error").hidden = false;
  }
});
element("cancel-analysis").addEventListener("click", () => {
  fileRevision++;
  analysisWorker?.terminate();
  setBusy(false);
  element("status").textContent = "Analysis cancelled; no new verdict.";
});
