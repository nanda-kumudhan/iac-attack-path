import { comparePlans, emptyPlan } from "../engine";
self.onmessage = (
  event: MessageEvent<{ base?: string; head: string; demo?: boolean }>,
) => {
  try {
    const result = comparePlans(
      event.data.base ?? emptyPlan(),
      event.data.head,
    );
    if (event.data.demo) result.report.analysis.status = "demo";
    self.postMessage({ ok: true, report: result.report });
  } catch {
    self.postMessage({
      ok: false,
      error:
        "Analysis failed. Check that both files are terraform show -json plans (format 1.x), policies are valid, and inputs fit the documented limits. No clean verdict was produced.",
    });
  }
};
