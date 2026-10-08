import { useEffect, useState } from "react";
import { Alert, App as AntApp, Empty, Spin, Tag } from "antd";
import { api, stateNames } from "./api";

export function useData<T = any>(path: string | null, revision = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(undefined);
    setError("");
    if (!path) {
      setLoading(false);
      return;
    }
    api<T>(path)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, revision]);
  return { data, error, loading };
}
export function LoadState({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error: string;
  children: React.ReactNode;
}) {
  if (loading)
    return (
      <div className="loading">
        <Spin />
        <span>正在读取当前资料…</span>
      </div>
    );
  if (error)
    return (
      <Alert type="error" showIcon title="暂时无法读取" description={error} />
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
  return <Tag color={color}>{stateNames[value] || value}</Tag>;
}
export function ApplicabilityTag({ value }: { value: string }) {
  return (
    <Tag color={value === "applicable" ? "green" : "default"}>
      {
        (
          {
            applicable: "适用",
            pending: "待确认",
            not_applicable: "不适用",
          } as Record<string, string>
        )[value]
      }
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
  const run = async (fn: () => Promise<any>, success = "已保存") => {
    setBusy(true);
    try {
      const result = await fn();
      message.success(success);
      reload?.();
      return result;
    } catch (e: any) {
      message.error(e.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}
export function NoData({ text = "暂无记录" }: { text?: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} />;
}
