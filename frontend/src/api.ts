export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public trace?: string,
  ) {
    super(message);
  }
}

export async function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": sessionStorage.getItem("csrf") || "",
      "Idempotency-Key": crypto.randomUUID(),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/auth/login")
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(
      result.error?.code || "REQUEST_FAILED",
      result.error?.message || "请求暂时失败",
      response.status,
      result.trace_id,
    );
  }
  return result.data;
}

export type User = {
  id: string;
  display_name: string;
  username: string;
  must_change_password: boolean;
  identity_admin: boolean;
};
export type Me = {
  user: User;
  projects: { id: string; name: string; demo: boolean }[];
  memberships: { project_id: string; roles: string[] }[];
  demo_mode: boolean;
};
export type Context = {
  project: {
    id: string;
    name: string;
    exchange: string;
    scope_version: number;
    template_version_id: string;
  };
  organizations: { id: string; name: string; current: boolean }[];
  periods: { id: string; label: string; current: boolean }[];
  users: {
    id: string;
    display_name: string;
    roles: string[];
    org_ids: string[];
    active: boolean;
  }[];
  roles: string[];
  templates: any[];
  policies: any[];
};
export const stateNames: Record<string, string> = {
  not_started: "未开始",
  collecting: "待收集",
  submitted: "已提交",
  reviewing: "复核中",
  accepted: "已接受",
  returned: "退回补充",
  restricted_pending: "受限待核",
  restricted_verified: "受限已核",
  blocked: "阻塞",
  needs_review: "待重新复核",
  in_progress: "整改中",
  pending_verification: "待验证",
  closed: "已关闭",
  risk: "风险待决策",
};
export const domainNames: Record<string, string> = {
  FIN: "财务基础",
  REV: "收入与验收",
  AR: "应收账款",
  INV: "存货与成本",
  CASH: "资金管理",
  TAX: "税务资料",
  RP: "关联交易",
  IC: "内部控制",
};
export const roleNames: Record<string, string> = {
  cfo: "财务负责人",
  pmo: "财务PMO",
  owner: "资料经办",
  reviewer: "独立复核",
};
export const acquisitionNames: Record<string, string> = {
  not_collected: "未收集",
  located: "已定位",
  pending: "待取得",
  restricted: "受限待核",
  unavailable: "无法取得",
  nonexistent: "经核实不存在",
};
