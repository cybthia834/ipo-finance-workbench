export type ChecklistRow = {
  id: string;
  project_id: string;
  topic_code: string;
  title: string;
  org_id: string;
  org_name: string;
  period_id: string;
  period_label: string;
  applicability: string;
  state: string;
  workflow_state: string;
  owner_id: string | null;
  owner_name: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  due: string | null;
  row_version: number;
  overdue: boolean;
  standard: string;
  checks: string[];
  domain: string;
};
export type ChecklistPage = {
  items: ChecklistRow[];
  total: number;
  page: number;
  page_size: number;
};
export type GenerationPreview = {
  total: number;
  new: number;
  existing: number;
  pending: number;
  exchange_pending: boolean;
};
export type GenerationJob = {
  id: string;
  project_id: string;
  actor_id: string;
  kind: string;
  state: string;
  attempts: number;
  error_code: string | null;
  result: GenerationPreview | null;
};
export type PersonalView = {
  id: string;
  project_id: string;
  name: string;
  filters: Record<string, string>;
};
export type AssignmentResult = {
  results: {
    id?: string;
    success: boolean;
    code?: string;
    message?: string;
    row_version?: number;
  }[];
};
export type DashboardData = {
  counts: {
    total: number;
    applicable: number;
    accepted: number;
    pending: number;
    restricted: number;
    restricted_verified: number;
    open_issues: number;
    overdue: number;
    completion: number | null;
    coverage: number | null;
    assignment_exceptions: number;
  };
  domains: {
    domain: string;
    total: number;
    accepted: number;
    pending: number;
  }[];
  todo: ChecklistRow[];
  urgent_issues: {
    id: string;
    title: string;
    severity: string;
    state: string;
    owner_name: string | null;
    current_due: string;
    overdue: boolean;
  }[];
};
const enums: Record<string, readonly string[]> = {
  applicability: ["pending", "applicable", "not_applicable"],
  state: [
    "not_started",
    "collecting",
    "submitted",
    "reviewing",
    "accepted",
    "returned",
    "restricted_pending",
    "restricted_verified",
    "blocked",
    "needs_review",
    "overdue",
    "restricted",
  ],
  domain: ["FIN", "REV", "AR", "INV", "CASH", "TAX", "RP", "IC"],
  mine: ["true"],
};
const keys = [
  "q",
  "org_id",
  "period_id",
  "applicability",
  "state",
  "domain",
  "mine",
  "page",
  "page_size",
];
export function checklistFilters(
  input: URLSearchParams,
  scope?: { organizations: { id: string }[]; periods: { id: string }[] },
): URLSearchParams {
  const result = new URLSearchParams();
  for (const key of keys) {
    const value = input.get(key)?.trim();
    if (!value) continue;
    if (key in enums && !enums[key].includes(value)) continue;
    if (
      key === "page" &&
      (!/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) < 1)
    )
      continue;
    if (key === "page_size" && !["20", "50", "100"].includes(value)) continue;
    if (
      key === "org_id" &&
      scope &&
      !scope.organizations.some((x) => x.id === value)
    )
      continue;
    if (
      key === "period_id" &&
      scope &&
      !scope.periods.some((x) => x.id === value)
    )
      continue;
    result.set(key, key === "q" ? value.slice(0, 160) : value);
  }
  return result;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function parseChecklistPage(value: unknown): ChecklistPage {
  if (
    !record(value) ||
    !Array.isArray(value.items) ||
    !Number.isInteger(value.total) ||
    Number(value.total) < 0 ||
    !Number.isInteger(value.page) ||
    Number(value.page) < 1 ||
    !Number.isInteger(value.page_size) ||
    Number(value.page_size) < 1
  )
    throw new Error("清单响应格式异常，请重新读取。");
  for (const row of value.items) {
    if (
      !record(row) ||
      ![
        "id",
        "project_id",
        "topic_code",
        "title",
        "org_id",
        "org_name",
        "period_id",
        "period_label",
        "applicability",
        "state",
        "workflow_state",
        "domain",
        "standard",
      ].every((key) => typeof row[key] === "string") ||
      !["owner_id", "owner_name", "reviewer_id", "reviewer_name", "due"].every(
        (key) => row[key] === null || typeof row[key] === "string",
      ) ||
      !Number.isInteger(row.row_version) ||
      Number(row.row_version) < 1 ||
      typeof row.overdue !== "boolean" ||
      !Array.isArray(row.checks) ||
      !row.checks.every((x) => typeof x === "string")
    )
      throw new Error("清单记录缺少必要字段，请重新读取。");
  }
  return value as ChecklistPage;
}
export function parseJob(value: unknown): GenerationJob {
  if (
    !record(value) ||
    !["id", "project_id", "actor_id", "kind", "state"].every(
      (key) => typeof value[key] === "string",
    ) ||
    !Number.isInteger(value.attempts)
  )
    throw new Error("任务响应格式异常，请重新查询。");
  if (value.error_code !== null && typeof value.error_code !== "string")
    throw new Error("任务错误信息格式异常。");
  if (
    value.result !== null &&
    (!record(value.result) ||
      !["total", "new", "existing", "pending"].every(
        (key) =>
          typeof (value.result as Record<string, unknown>)[key] === "number",
      ))
  )
    throw new Error("任务结果格式异常。");
  return value as GenerationJob;
}
export const jobLabels: Record<string, string> = {
  queued: "等待处理",
  running: "正在生成",
  retry_wait: "后台等待重试",
  succeeded: "生成完成",
  failed: "生成失败",
};
export function jobIsActive(state: string): boolean {
  return ["queued", "running", "retry_wait"].includes(state);
}
