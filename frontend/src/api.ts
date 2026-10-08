export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public trace?: string,
    public resultUncertain = false,
  ) {
    super(message);
  }
}

export type ApiEnvelope<T> = { data: T; as_of: string; trace_id: string };
export type RequestOptions = { signal?: AbortSignal; timeout?: number };
const pendingKeys = new Map<string, string>();
const activeRequests = new Set<AbortController>();
let sessionRevision = 0;
export const clearPendingRequests = () => {
  sessionRevision++;
  pendingKeys.clear();
  activeRequests.forEach((controller) => controller.abort());
  activeRequests.clear();
};
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError)
    return `${error.resultUncertain && !/确认|核对/.test(error.message) ? "操作结果尚未确认。" : ""}${error.message}${error.trace ? `（追踪号 ${error.trace.slice(0, 12)}）` : ""}`;
  return error instanceof Error ? error.message : "暂时无法完成，请稍后重试";
}
async function request(
  path: string,
  body: unknown,
  method: string | undefined,
  options: RequestOptions,
  binary = false,
): Promise<{ response: Response; value: unknown }> {
  const verb = method || (body === undefined ? "GET" : "POST");
  const write = !["GET", "HEAD", "OPTIONS"].includes(verb);
  const csrf = sessionStorage.getItem("csrf") || "";
  const revision = sessionRevision;
  const fingerprint = write
    ? Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify([verb, path, body, csrf])),
          ),
        ),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    : "";
  if (revision !== sessionRevision || options.signal?.aborted)
    throw new DOMException("请求已停止等待", "AbortError");
  const key = write ? pendingKeys.get(fingerprint) || crypto.randomUUID() : "";
  if (write) pendingKeys.set(fingerprint, key);
  const controller = new AbortController();
  activeRequests.add(controller);
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = window.setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    options.timeout ?? (write ? 30000 : 15000),
  );
  try {
    const response = await fetch(`/api/v1${path}`, {
      method: verb,
      credentials: "same-origin",
      signal: controller.signal,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(write ? { "X-CSRF-Token": csrf, "Idempotency-Key": key } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401 && path !== "/auth/login" && path !== "/me")
      window.dispatchEvent(new Event("session-expired"));
    let value: unknown;
    if (binary && response.ok) value = await response.blob();
    else {
      try {
        value = await response.json();
      } catch {
        throw new ApiError(
          "INVALID_RESPONSE",
          write
            ? "返回结果无法确认，请先核对记录，勿重复创建。"
            : "服务返回格式异常，请重试或联系管理员。",
          response.status,
          response.headers.get("X-Trace-ID") || undefined,
          write,
        );
      }
    }
    if (!response.ok) {
      const problem = object(value) && object(value.error) ? value.error : {};
      const trace =
        object(value) && typeof value.trace_id === "string"
          ? value.trace_id
          : response.headers.get("X-Trace-ID") || undefined;
      if (response.status < 500) pendingKeys.delete(fingerprint);
      throw new ApiError(
        typeof problem.code === "string" ? problem.code : "REQUEST_FAILED",
        typeof problem.message === "string"
          ? problem.message
          : "请求暂时失败，请稍后重试",
        response.status,
        trace,
        write && response.status >= 500,
      );
    }
    if (
      !binary &&
      (!object(value) ||
        !("data" in value) ||
        typeof value.as_of !== "string" ||
        typeof value.trace_id !== "string")
    ) {
      throw new ApiError(
        "INVALID_RESPONSE",
        "响应缺少必要字段，请刷新后核对结果。",
        response.status,
        undefined,
        write,
      );
    }
    pendingKeys.delete(fingerprint);
    return { response, value };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted && !timedOut)
      throw new DOMException("请求已停止等待", "AbortError");
    throw new ApiError(
      write ? "NETWORK_UNCERTAIN" : "NETWORK_ERROR",
      write
        ? "连接中断或等待超时，结果尚未确认。请先核对记录；同页保持内容不变重试会沿用原请求编号。"
        : "暂时无法连接服务，请检查网络后重试。",
      0,
      undefined,
      write,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    activeRequests.delete(controller);
  }
}
// Legacy callers retain their existing generic until migrated domain by domain.
export async function apiEnvelope<T = any>(
  path: string,
  body?: unknown,
  method?: string,
  options: RequestOptions = {},
): Promise<ApiEnvelope<T>> {
  const { value } = await request(path, body, method, options);
  return value as ApiEnvelope<T>;
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
  options: RequestOptions = {},
): Promise<T> {
  return (await apiEnvelope<T>(path, body, method, options)).data;
}
export async function downloadExport(id: string): Promise<void> {
  const { value } = await request(
    `/exports/${encodeURIComponent(id)}/download`,
    undefined,
    "GET",
    { timeout: 60000 },
    true,
  );
  if (!(value instanceof Blob) || !value.type.includes("zip"))
    throw new ApiError(
      "INVALID_FILE",
      "导出文件格式异常，请联系管理员核对。",
      0,
    );
  const url = URL.createObjectURL(value);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "财务目录快照.zip";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
