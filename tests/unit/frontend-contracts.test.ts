import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checklistFilters,
  parseChecklistPage,
  parseJob,
  jobIsActive,
} from "../../frontend/src/features/checklists/contracts.ts";

test("URL parameters cannot smuggle navigation or unsupported filters to the API", () => {
  const query = checklistFilters(
    new URLSearchParams(
      "job_id=secret&tab=reviews&state=closed&mine=false&page=-2&page_size=1000&q=FIN-01&domain=FIN",
    ),
  );
  assert.equal(query.toString(), "q=FIN-01&domain=FIN");
});
test("filters retain valid scope and remove stale or unauthorized scope", () => {
  const query = checklistFilters(
    new URLSearchParams(
      "org_id=other&period_id=current&state=needs_review&applicability=applicable&page=2&page_size=50",
    ),
    { organizations: [{ id: "own" }], periods: [{ id: "current" }] },
  );
  assert.equal(query.has("org_id"), false);
  assert.equal(query.get("period_id"), "current");
  assert.equal(query.get("page_size"), "50");
  assert.equal(query.get("state"), "needs_review");
});
test("successful empty page is distinct from missing or corrupt payload", () => {
  assert.deepEqual(
    parseChecklistPage({ items: [], total: 0, page: 1, page_size: 20 }).items,
    [],
  );
  for (const bad of [
    null,
    {},
    { items: [], total: "0", page: 1, page_size: 20 },
    { items: [{ id: "partial" }], total: 1, page: 1, page_size: 20 },
  ])
    assert.throws(() => parseChecklistPage(bad));
});
test("malformed job result cannot be rendered as complete", () => {
  assert.throws(() =>
    parseJob({ id: "x", state: "succeeded", result: { new: 2 } }),
  );
  const job = {
    id: "j",
    project_id: "p",
    actor_id: "a",
    kind: "generate",
    state: "running",
    attempts: 1,
    error_code: null,
    result: null,
  };
  assert.equal(parseJob(job).state, "running");
});
test("unknown and terminal job states stop polling, retry_wait remains live", () => {
  assert.equal(jobIsActive("retry_wait"), true);
  for (const state of ["succeeded", "failed", "cancelled", "future_state"])
    assert.equal(jobIsActive(state), false);
});
