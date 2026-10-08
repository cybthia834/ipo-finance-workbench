import { useEffect, useRef, useState } from "react";
import { Alert, Button, Space, Tag } from "antd";
import { ApiError, api, errorMessage } from "../../api";
import {
  jobIsActive,
  jobLabels,
  parseJob,
  type GenerationJob,
} from "./contracts";

export function GenerationTask({
  id,
  projectId,
  onCompleted,
  onDismiss,
}: {
  id: string;
  projectId: string;
  onCompleted: () => void;
  onDismiss: () => void;
}) {
  const [job, setJob] = useState<GenerationJob>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [paused, setPaused] = useState(false);
  const completed = useRef("");
  const callback = useRef(onCompleted);
  useEffect(() => {
    callback.current = onCompleted;
  }, [onCompleted]);
  useEffect(() => {
    let disposed = false,
      inFlight = false,
      terminal = false,
      failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    setError("");
    const poll = async () => {
      if (disposed || paused || inFlight || terminal || document.hidden) return;
      clearTimeout(timer);
      inFlight = true;
      controller = new AbortController();
      try {
        const next = parseJob(
          await api<unknown>(
            `/jobs/${encodeURIComponent(id)}`,
            undefined,
            undefined,
            { signal: controller.signal },
          ),
        );
        if (disposed) return;
        if (next.project_id !== projectId || next.kind !== "generate")
          throw new ApiError(
            "JOB_MISMATCH",
            "该任务不属于当前项目的清单生成，请返回清单。",
            403,
          );
        setJob(next);
        setError("");
        failures = 0;
        terminal = !jobIsActive(next.state);
        if (next.state === "succeeded" && completed.current !== id) {
          completed.current = id;
          callback.current();
        }
      } catch (e: unknown) {
        if (disposed || (e instanceof DOMException && e.name === "AbortError"))
          return;
        setError(errorMessage(e));
        failures++;
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          terminal = true;
          setJob(undefined);
        }
      } finally {
        inFlight = false;
        if (!disposed && !terminal && !paused && !document.hidden)
          timer = setTimeout(
            poll,
            Math.min(2000 * 2 ** Math.min(failures, 3), 16000),
          );
      }
    };
    const resume = () => {
      if (!document.hidden) void poll();
      else clearTimeout(timer);
    };
    void poll();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [id, projectId, revision, paused]);
  return (
    <section className="job-panel" aria-label="清单生成任务">
      <div className="job-panel-heading">
        <Space>
          <strong>清单生成</strong>
          <Tag>
            {paused
              ? "已停止等待"
              : job
                ? jobLabels[job.state] || "状态待确认"
                : error
                  ? "连接待恢复"
                  : "正在查询"}
          </Tag>
        </Space>
        <Space wrap>
          <Button
            onClick={() => {
              setPaused(false);
              setRevision((n) => n + 1);
            }}
          >
            查询进度
          </Button>
          {!paused && (!job || jobIsActive(job.state)) && (
            <Button onClick={() => setPaused(true)}>停止等待</Button>
          )}
          <Button type="text" onClick={onDismiss}>
            关闭面板
          </Button>
        </Space>
      </div>
      <p>
        任务 {id.slice(0, 8)} · 刷新页面后可继续查看，关闭面板不会取消后台任务。
      </p>
      {job?.result && (
        <div aria-live="polite">
          新增 {job.result.new} 项，已存在 {job.result.existing}{" "}
          项，待确认适用性 {job.result.pending} 项。
        </div>
      )}
      {job?.state === "retry_wait" && (
        <p>后台正在安排第 {job.attempts + 1} 次执行，请等待查询结果。</p>
      )}
      {job?.state === "failed" && (
        <Alert
          type="error"
          showIcon
          title="生成任务未完成"
          description={`请联系项目管理员核对后处理。错误码：${job.error_code || "未知"}`}
        />
      )}
      {error && (
        <Alert
          role="alert"
          type="warning"
          showIcon
          title="暂时无法确认任务状态"
          description={error}
        />
      )}
    </section>
  );
}
