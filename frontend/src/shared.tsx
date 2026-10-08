import { useEffect, useRef, useState } from "react";
import { Alert, App as AntApp, Button, Empty, Spin, Tag } from "antd";
import { apiEnvelope, errorMessage, stateNames } from "./api";

export function useData<T = any>(
  path: string | null,
  revision = 0,
  decode?: (value: unknown) => T,
) {
  const [result, setResult] = useState<{
    path: string | null;
    revision: number;
    data?: T;
    error: string;
    loading: boolean;
    asOf?: string;
  }>({ path, revision, error: "", loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setResult({ path, revision, error: "", loading: !!path });
    if (path)
      apiEnvelope<T>(path, undefined, undefined, { signal: controller.signal })
        .then(({ data, as_of }) => {
          if (active)
            setResult({
              path,
              revision,
              data: decode ? decode(data) : data,
              asOf: as_of,
              error: "",
              loading: false,
            });
        })
        .catch((error: unknown) => {
          if (
            active &&
            !(error instanceof DOMException && error.name === "AbortError")
          )
            setResult({
              path,
              revision,
              error: errorMessage(error),
              loading: false,
            });
        });
    return () => {
      active = false;
      controller.abort();
    };
  }, [path, revision, attempt, decode]);
  // Never paint data from the preceding project or filter, even for one render.
  const current = result.path === path && result.revision === revision;
  return {
    data: current ? result.data : undefined,
    error: current ? result.error : "",
    loading: current ? result.loading : !!path,
    asOf: current ? result.asOf : undefined,
    retry: () => setAttempt((n) => n + 1),
  };
}
export const formatDateTime = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
export function DataStamp({ asOf }: { asOf?: string }) {
  return asOf ? (
    <div className="data-stamp">
      数据截至 {formatDateTime(asOf)} <span>· 当前授权范围 · 上海时间</span>
    </div>
  ) : null;
}
export function LoadState({
  loading,
  error,
  children,
  retry,
}: {
  loading: boolean;
  error: string;
  children: React.ReactNode;
  retry?: () => void;
}) {
  if (loading)
    return (
      <div className="loading" role="status">
        <Spin />
        <span>正在读取当前资料…</span>
      </div>
    );
  if (error)
    return (
      <Alert
        role="alert"
        type="error"
        showIcon
        title="暂时无法读取"
        description={error}
        action={
          <Button onClick={retry || (() => window.location.reload())}>
            重新读取
          </Button>
        }
      />
    );
  return <>{children}</>;
}
export function StateTag({ value }: { value: string }) {
  const color = ["accepted", "closed", "restricted_verified"].includes(value)
    ? "green"
    : ["returned", "risk", "needs_review"].includes(value)
      ? "orange"
      : ["submitted", "pending_verification", "reviewing"].includes(value)
        ? "blue"
        : "default";
  return (
    <Tag className="state-tag" color={color}>
      {stateNames[value] || "状态待确认"}
    </Tag>
  );
}
export function ApplicabilityTag({ value }: { value: string }) {
  return (
    <Tag color={value === "applicable" ? "green" : "default"}>
      {(
        {
          applicable: "适用",
          pending: "待确认",
          not_applicable: "不适用",
        } as Record<string, string>
      )[value] || "状态待确认"}
    </Tag>
  );
}
export function PageTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="page-actions">{action}</div>
    </div>
  );
}
export function useAction(reload?: () => void) {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const run = async <T,>(
    fn: () => Promise<T>,
    success: string | false = "已保存",
  ): Promise<T | undefined> => {
    if (locked.current) return undefined;
    locked.current = true;
    setBusy(true);
    try {
      const result = await fn();
      if (success) message.success(success);
      reload?.();
      return result;
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        message.error(errorMessage(error), 6);
      return undefined;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return { run, busy };
}
export function NoData({ text = "暂无记录" }: { text?: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} />;
}
