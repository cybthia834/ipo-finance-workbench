import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Form,
  Input,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Tabs,
  Timeline,
} from "antd";
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileDoneOutlined,
  PlusOutlined,
  ReloadOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
  useLocation,
} from "react-router-dom";
import { useWork } from "../App";
import { api, domainNames, stateNames } from "../api";
import {
  ApplicabilityTag,
  DataStamp,
  formatDateTime,
  LoadState,
  NoData,
  PageTitle,
  StateTag,
  useAction,
  useData,
} from "../shared";

import {
  checklistFilters,
  parseChecklistPage,
  type ChecklistPage,
  type ChecklistRow,
  type GenerationPreview,
  type AssignmentResult,
  type DashboardData,
  type PersonalView,
} from "../features/checklists/contracts";
import { GenerationTask } from "../features/checklists/GenerationTask";

export function Dashboard() {
  const { ctx, me, base } = useWork();
  const [dashboardParams, setDashboardParams] = useSearchParams();
  const org = ctx.organizations.some(
    (o) => o.id === dashboardParams.get("org_id"),
  )
    ? dashboardParams.get("org_id") || undefined
    : undefined;
  const period = ctx.periods.some(
    (p) => p.id === dashboardParams.get("period_id"),
  )
    ? dashboardParams.get("period_id") || undefined
    : undefined;
  const range = new URLSearchParams();
  if (org) range.set("org_id", org);
  if (period) range.set("period_id", period);
  const rangeQuery = range.toString();
  const changeRange = (key: string, value?: string) => {
    const next = new URLSearchParams(range);
    if (value) next.set(key, value);
    else next.delete(key);
    setDashboardParams(next);
  };
  const { data, loading, error, asOf, retry } = useData<DashboardData>(
    `/projects/${ctx.project.id}/dashboard?${rangeQuery}`,
  );
  const navigate = useNavigate();
  const c = data?.counts;
  return (
    <>
      <PageTitle
        title="财务工作首页"
        subtitle="从当前资料到待办事项，掌握上市准备的每一步。"
        action={
          <Space>
            <Select
              aria-label="首页主体"
              placeholder="全部授权主体"
              allowClear
              value={org}
              onChange={(value) => changeRange("org_id", value)}
              style={{ width: 170 }}
              options={ctx.organizations.map((o) => ({
                value: o.id,
                label: o.name,
              }))}
            />
            <Select
              aria-label="首页期间"
              placeholder="全部期间"
              allowClear
              value={period}
              onChange={(value) => changeRange("period_id", value)}
              style={{ width: 150 }}
              options={ctx.periods.map((p) => ({
                value: p.id,
                label: p.label,
              }))}
            />
            <Button
              icon={<UnorderedListOutlined />}
              onClick={() => navigate(`${base}/checklists?${rangeQuery}`)}
            >
              查看清单
            </Button>
          </Space>
        }
      />
      <LoadState loading={loading} error={error} retry={retry}>
        {data && c && (
          <>
            <DataStamp asOf={asOf} />
            <div className="overview">
              <div className="overview-copy">
                <span className="eyebrow">PROJECT OVERVIEW</span>
                <h2>资料准备，进展有据</h2>
                <p>{ctx.project.name}</p>
                <Space>
                  <span className="overview-chip">A股主板</span>
                  <span className="overview-chip">
                    {ctx.project.exchange === "unknown"
                      ? "交易所待确定"
                      : ctx.project.exchange.toUpperCase()}
                  </span>
                  <span className="overview-chip">A · 目录模式</span>
                </Space>
              </div>
              <div className="overview-progress">
                <div>
                  <span>当前有效复核完成率</span>
                  <strong>
                    {c.completion === null ? "—" : c.completion}
                    <small>{c.completion === null ? "" : "%"}</small>
                  </strong>
                  <span>
                    {c.accepted} / {c.applicable} 项适用资料已接受
                  </span>
                </div>
                <Progress
                  type="circle"
                  percent={c.completion || 0}
                  size={100}
                  strokeColor="#5d2a1a"
                  railColor="rgba(93,42,26,.10)"
                  format={() => (
                    <CheckCircleOutlined
                      style={{ color: "#5d2a1a", fontSize: 32 }}
                    />
                  )}
                />
              </div>
            </div>
            <div className="metrics-grid">
              {[
                [
                  "适用资料项",
                  c.applicable,
                  "已人工确认适用",
                  "applicability=applicable",
                ],
                [
                  "有效已接受",
                  c.accepted,
                  "当前版本经独立复核",
                  "state=accepted&applicability=applicable",
                ],
                [
                  "适用性待确认",
                  c.pending,
                  "待财务专业判断",
                  "applicability=pending",
                ],
                [
                  "受限资料",
                  c.restricted,
                  "离线核查结果单列",
                  "state=restricted",
                ],
                ["未关闭整改", c.open_issues, "含风险待决策事项", "issues"],
                ["逾期整改", c.overdue, "按批准截止日计算", "overdue"],
              ].map(([label, count, note, filter], i) => (
                <button
                  className={`metric ${i === 5 && Number(count) > 0 ? "attention" : ""}`}
                  key={String(label)}
                  onClick={() =>
                    navigate(
                      filter === "issues"
                        ? `${base}/issues?state=open${rangeQuery ? `&${rangeQuery}` : ""}`
                        : filter === "overdue"
                          ? `${base}/issues?overdue=true${rangeQuery ? `&${rangeQuery}` : ""}`
                          : `${base}/checklists?${filter}${rangeQuery ? `&${rangeQuery}` : ""}`,
                    )
                  }
                >
                  <span>
                    {label}
                    <ArrowRightOutlined />
                  </span>
                  <strong>
                    {count}
                    <small>项</small>
                  </strong>
                  <small>{note}</small>
                </button>
              ))}
            </div>
            <div className="dashboard-columns">
              <Card
                title={
                  <>
                    <span className="section-dot" />
                    财务领域准备进展
                  </>
                }
                extra={
                  <Link to={`${base}/checklists?${rangeQuery}`}>
                    查看全部 <ArrowRightOutlined />
                  </Link>
                }
              >
                <div className="domain-list">
                  {data.domains.map((d) => (
                    <button
                      key={d.domain}
                      onClick={() =>
                        navigate(
                          `${base}/checklists?domain=${d.domain}${rangeQuery ? `&${rangeQuery}` : ""}`,
                        )
                      }
                    >
                      <span className="domain-icon">
                        {d.domain.slice(0, 2)}
                      </span>
                      <div>
                        <strong>{domainNames[d.domain]}</strong>
                        <Progress
                          percent={
                            d.total
                              ? Math.round((d.accepted * 100) / d.total)
                              : 0
                          }
                          showInfo={false}
                          size="small"
                        />
                      </div>
                      <span className="domain-count">
                        {d.accepted}
                        <small> / {d.total}</small>
                      </span>
                      <span className="muted">{d.pending} 待确认</span>
                    </button>
                  ))}
                </div>
              </Card>
              <Card
                title={
                  <>
                    <span className="section-dot amber" />
                    需关注的整改
                  </>
                }
                extra={
                  <Link to={`${base}/issues?${rangeQuery}`}>
                    整改台账 <ArrowRightOutlined />
                  </Link>
                }
              >
                {data.urgent_issues.length ? (
                  <div className="urgent-list">
                    {data.urgent_issues.slice(0, 4).map((r) => (
                      <Link to={`${base}/issues/${r.id}`} key={r.id}>
                        <Space>
                          <Tag color={r.severity === "P0" ? "red" : "orange"}>
                            {r.severity}
                          </Tag>
                          <StateTag value={r.state} />
                        </Space>
                        <strong>{r.title}</strong>
                        <div>
                          <span>{r.owner_name?.split(" · ")[0]}</span>
                          <span className={r.overdue ? "danger" : ""}>
                            <ClockCircleOutlined /> {r.current_due}{" "}
                            {r.overdue ? "已逾期" : "截止"}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <NoData text="暂无未关闭整改" />
                )}
              </Card>
            </div>
            <Card
              className="todo-card"
              title={
                <>
                  <span className="section-dot" />
                  我的待办 <Tag>{data.todo.length}</Tag>
                </>
              }
              extra={
                <Link to={`${base}/checklists?mine=true&${rangeQuery}`}>
                  查看全部
                </Link>
              }
            >
              <Table
                size="small"
                rowKey="id"
                dataSource={data.todo}
                pagination={false}
                locale={{ emptyText: "当前没有需要你处理的资料" }}
                columns={[
                  {
                    title: "资料需求",
                    render: (_: unknown, r: ChecklistRow) => (
                      <Link to={`${base}/checklists/${r.id}`}>
                        <span className="code">{r.topic_code}</span>
                        {r.title}
                      </Link>
                    ),
                  },
                  {
                    title: "主体 / 期间",
                    render: (_: unknown, r: ChecklistRow) => (
                      <span className="muted">
                        {r.org_name} · {r.period_label}
                      </span>
                    ),
                  },
                  {
                    title: "当前状态",
                    dataIndex: "state",
                    render: (s: string) => <StateTag value={s} />,
                  },
                  { title: "截止日期", dataIndex: "due" },
                  {
                    title: "下一步",
                    render: (_: unknown, r: ChecklistRow) => (
                      <Link to={`${base}/checklists/${r.id}`}>
                        {r.reviewer_id === me.user.id ? "去复核" : "去处理"}{" "}
                        <ArrowRightOutlined />
                      </Link>
                    ),
                  },
                ]}
              />
            </Card>
            <div className="footnote">
              <FileDoneOutlined />{" "}
              已接受仅表示目录满足当前验收条件，不代表上市合规或会计结论。
            </div>
          </>
        )}
      </LoadState>
    </>
  );
}

export function Checklists() {
  const { ctx, base } = useWork();
  const [params, setParams] = useSearchParams();
  const [rev, setRev] = useState(0);
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [preview, setPreview] = useState<GenerationPreview>();
  const [viewOpen, setViewOpen] = useState(false);
  const [viewsRevision, setViewsRevision] = useState(0);
  const {
    data: views,
    error: viewsError,
    loading: viewsLoading,
    retry: retryViews,
  } = useData<PersonalView[]>("/me/views", viewsRevision);
  const filterParams = checklistFilters(params, ctx);
  const filterQuery = filterParams.toString();
  const jobId = params.get("job_id");
  const [query, setQuery] = useState(filterParams.get("q") || "");
  useEffect(() => {
    setQuery(checklistFilters(params, ctx).get("q") || "");
  }, [params, ctx]);
  const reload = () => setRev((x) => x + 1);
  const { run, busy } = useAction(reload);
  const manager = ctx.roles.some((r) => ["pmo", "cfo"].includes(r));
  const { data, loading, error, asOf, retry } = useData<ChecklistPage>(
    `/projects/${ctx.project.id}/checklists?${filterQuery}`,
    rev,
    parseChecklistPage,
  );
  const replaceFilters = (values: URLSearchParams) => {
    const next = checklistFilters(values, ctx);
    if (jobId) next.set("job_id", jobId);
    setSelected([]);
    setParams(next);
  };
  const scopeLabel = `${ctx.organizations.filter((o) => o.current).length} 个主体 · ${ctx.periods.filter((p) => p.current).length} 个期间 · 范围 V${ctx.project.scope_version}`;
  useEffect(() => {
    if (data && data.page > 1 && !data.items.length) {
      const next = new URLSearchParams(params);
      next.set("page", "1");
      setParams(next, { replace: true });
    }
  }, [data, params, setParams]);
  const change = (key: string, value?: string) => {
    setSelected([]);
    const p = new URLSearchParams(filterParams);
    if (value) p.set(key, value);
    else p.delete(key);
    p.set("page", "1");
    replaceFilters(p);
  };
  const generation = {
    template_version_id: ctx.project.template_version_id,
    scope_version: ctx.project.scope_version,
  };
  return (
    <>
      <PageTitle
        title="财务资料清单"
        subtitle={`按主体与期间跟踪适用性、责任分工和当前资料版本。${scopeLabel}`}
        action={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={reload}>
              刷新
            </Button>
            {manager && (
              <Button
                type="primary"
                icon={<PlusOutlined aria-hidden />}
                loading={busy}
                onClick={() =>
                  run(async () => {
                    setPreview(
                      await api<GenerationPreview>(
                        `/projects/${ctx.project.id}/checklist-previews`,
                        generation,
                      ),
                    );
                  }, "预检完成")
                }
              >
                生成清单
              </Button>
            )}
          </Space>
        }
      />
      <div className="saved-views" aria-label="清单视图">
        {[
          ["全部资料", ""],
          ["我的待办", "mine=true"],
          ["待复核", "state=submitted"],
          ["逾期资料", "state=overdue"],
          ["受限资料", "state=restricted"],
        ].map(([label, value]) => (
          <Button
            key={label}
            type={filterQuery === value ? "primary" : "default"}
            onClick={() => replaceFilters(new URLSearchParams(value))}
          >
            {label}
          </Button>
        ))}
        <Select
          aria-label="个人视图"
          placeholder="个人视图"
          loading={viewsLoading}
          value={undefined}
          style={{ minWidth: 130 }}
          options={(views || [])
            .filter((v) => v.project_id === ctx.project.id)
            .map((v) => ({ value: v.id, label: v.name }))}
          onChange={(id) => {
            const view = views?.find(
              (v) => v.id === id && v.project_id === ctx.project.id,
            );
            if (view) replaceFilters(new URLSearchParams(view.filters));
          }}
        />
        <Button type="text" onClick={() => setViewOpen(true)}>
          另存个人视图
        </Button>
      </div>
      {viewsError && (
        <Alert
          className="mb16"
          type="warning"
          title="个人视图暂时无法读取"
          description={viewsError}
          action={<Button onClick={retryViews}>重试</Button>}
        />
      )}
      {jobId && (
        <GenerationTask
          key={jobId}
          id={jobId}
          projectId={ctx.project.id}
          onCompleted={reload}
          onDismiss={() => {
            const next = new URLSearchParams(params);
            next.delete("job_id");
            setParams(next, { replace: true });
          }}
        />
      )}
      {ctx.project.exchange === "unknown" && (
        <Alert
          className="mb16"
          type="info"
          showIcon
          title="目标交易所待确认"
          description="当前使用主板通用准备模板。交易所差异需要财务负责人后续确认。"
        />
      )}
      <Card>
        <div className="filters">
          <Input.Search
            placeholder="搜索主题编号或资料需求"
            allowClear
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onSearch={(v) => change("q", v)}
            style={{ width: 270 }}
          />
          <Select
            aria-label="主体筛选"
            placeholder="全部主体"
            allowClear
            value={filterParams.get("org_id") || undefined}
            onChange={(v) => change("org_id", v)}
            options={ctx.organizations.map((o) => ({
              value: o.id,
              label: o.name,
            }))}
          />
          <Select
            aria-label="报告期间"
            placeholder="全部期间"
            allowClear
            value={filterParams.get("period_id") || undefined}
            onChange={(v) => change("period_id", v)}
            options={ctx.periods.map((p) => ({ value: p.id, label: p.label }))}
          />
          <Select
            aria-label="财务领域"
            placeholder="全部领域"
            allowClear
            value={filterParams.get("domain") || undefined}
            onChange={(v) => change("domain", v)}
            options={Object.entries(domainNames).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Select
            aria-label="适用性筛选"
            placeholder="适用性"
            allowClear
            value={filterParams.get("applicability") || undefined}
            onChange={(v) => change("applicability", v)}
            options={[
              { value: "pending", label: "待确认" },
              { value: "applicable", label: "适用" },
              { value: "not_applicable", label: "不适用" },
            ]}
          />
          <Select
            aria-label="资料进度"
            placeholder="全部进度"
            allowClear
            value={filterParams.get("state") || undefined}
            onChange={(v) => change("state", v)}
            options={Object.entries(stateNames)
              .filter(
                ([k]) =>
                  ![
                    "in_progress",
                    "pending_verification",
                    "closed",
                    "risk",
                  ].includes(k),
              )
              .map(([value, label]) => ({ value, label }))}
          />
          <Button
            type="text"
            onClick={() => {
              setQuery("");
              replaceFilters(new URLSearchParams());
            }}
          >
            清空筛选
          </Button>
        </div>
        <div className="list-toolbar">
          <Space>
            <strong className="filter-count">
              {data
                ? `${data.total} 项资料需求`
                : loading
                  ? "正在读取资料需求…"
                  : "资料需求待读取"}
            </strong>
            <span className="muted">适用性与复核进度分别记录</span>
          </Space>
          {manager && (
            <Button
              disabled={!selected.length}
              onClick={() => setAssignOpen(true)}
            >
              批量分派 {selected.length ? `(${selected.length})` : ""}
            </Button>
          )}
        </div>
        <DataStamp asOf={asOf} />
        <LoadState loading={loading} error={error} retry={retry}>
          <Table<ChecklistRow>
            locale={{
              emptyText: (
                <NoData
                  text={
                    filterQuery
                      ? "没有符合筛选条件的资料，可清空筛选重试"
                      : "暂无资料需求，可由项目管理员生成清单"
                  }
                />
              ),
            }}
            rowKey="id"
            scroll={{ x: 1080 }}
            dataSource={data?.items}
            rowSelection={
              manager
                ? { selectedRowKeys: selected, onChange: setSelected }
                : undefined
            }
            pagination={{
              current: Number(filterParams.get("page") || 1),
              pageSize: Number(filterParams.get("page_size") || 20),
              total: data?.total,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100],
              onChange: (page, size) => {
                const p = new URLSearchParams(params);
                p.set("page", String(page));
                p.set("page_size", String(size));
                setParams(p);
                setSelected([]);
              },
            }}
            columns={[
              {
                title: "资料需求",
                width: 330,
                render: (_: unknown, r: ChecklistRow) => (
                  <Link
                    className="item-title"
                    to={`${base}/checklists/${r.id}`}
                    state={{ listSearch: `?${filterQuery}` }}
                  >
                    <span className="code">{r.topic_code}</span>
                    <strong>{r.title}</strong>
                  </Link>
                ),
              },
              {
                title: "主体 / 期间",
                width: 190,
                render: (_: unknown, r: ChecklistRow) => (
                  <div>
                    {r.org_name}
                    <div className="table-secondary">{r.period_label}</div>
                  </div>
                ),
              },
              {
                title: "适用性",
                dataIndex: "applicability",
                width: 100,
                render: (v) => <ApplicabilityTag value={v} />,
              },
              {
                title: "资料进度",
                dataIndex: "state",
                width: 120,
                render: (v) => <StateTag value={v} />,
              },
              {
                title: "经办 / 复核",
                width: 150,
                render: (_: unknown, r: ChecklistRow) => (
                  <div>
                    {r.owner_name?.split(" · ")[0] || "待分派"}
                    <div className="table-secondary">
                      {r.reviewer_name?.split(" · ")[0] || "未指定复核"}
                    </div>
                  </div>
                ),
              },
              {
                title: "截止日期",
                width: 120,
                render: (_: unknown, r: ChecklistRow) => (
                  <span className={r.overdue ? "danger" : ""}>
                    {r.due || "待确定"}
                  </span>
                ),
              },
            ]}
          />
        </LoadState>
      </Card>
      <Modal
        title="清单生成预检"
        open={!!preview}
        onCancel={() => setPreview(undefined)}
        confirmLoading={busy}
        okText="确认生成"
        okButtonProps={{ "aria-label": "确认生成", "aria-busy": busy }}
        onOk={() =>
          run(async () => {
            const j = await api<{ id: string }>(
              `/projects/${ctx.project.id}/checklist-jobs`,
              generation,
            );
            const next = new URLSearchParams(params);
            next.set("job_id", j.id);
            setParams(next);
            setPreview(undefined);
          }, "生成任务已提交")
        }
      >
        <Descriptions
          column={2}
          items={
            preview
              ? (["total", "new", "existing", "pending"] as const).map(
                  (key, i) => ({
                    key,
                    label: ["预计总项数", "新增", "已存在", "待确认适用性"][i],
                    children: preview[key],
                  }),
                )
              : []
          }
        />
        <p className="muted">
          已有复核及整改记录保留。新增项需要人工确认适用性。
        </p>
      </Modal>
      <Modal
        title="批量分派责任"
        open={assignOpen}
        onCancel={() => setAssignOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Form
          layout="vertical"
          onFinish={(v) =>
            run(async () => {
              const result = await api<AssignmentResult>(
                "/checklists/assignments",
                {
                  rows: (data?.items || [])
                    .filter((r) => selected.includes(r.id))
                    .map((r) => ({
                      item_id: r.id,
                      expected_version: r.row_version,
                      ...v,
                    })),
                },
              );
              const failed = result.results.filter((r) => !r.success);
              if (failed.length) {
                reload();
                setSelected(failed.flatMap((r) => (r.id ? [r.id] : [])));
              }
              if (failed.length)
                throw new Error(failed.map((r) => r.message).join("；"));
              setAssignOpen(false);
              setSelected([]);
            })
          }
        >
          <Form.Item name="owner_id" label="经办" rules={[{ required: true }]}>
            <Select
              options={ctx.users
                .filter(
                  (u) =>
                    u.active &&
                    u.roles.some((r) => ["owner", "pmo", "cfo"].includes(r)),
                )
                .map((u) => ({ value: u.id, label: u.display_name }))}
            />
          </Form.Item>
          <Form.Item
            name="reviewer_id"
            label="独立复核人"
            rules={[{ required: true }]}
          >
            <Select
              options={ctx.users
                .filter(
                  (u) =>
                    u.active &&
                    u.roles.some((r) => ["reviewer", "cfo"].includes(r)),
                )
                .map((u) => ({ value: u.id, label: u.display_name }))}
            />
          </Form.Item>
          <Form.Item name="due" label="截止日期" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>
            确认分派
          </Button>
        </Form>
      </Modal>
      <Modal
        title="另存个人视图"
        open={viewOpen}
        onCancel={() => setViewOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <p className="muted">只保存当前筛选，不保存资料副本；仅你本人可见。</p>
        <Form
          layout="vertical"
          onFinish={(v) =>
            run(async () => {
              const filters = Object.fromEntries(filterParams);
              delete filters.page;
              delete filters.page_size;
              await api("/me/views", {
                project_id: ctx.project.id,
                name: v.name,
                filters,
              });
              setViewsRevision((n) => n + 1);
              setViewOpen(false);
            }, "个人视图已保存")
          }
        >
          <Form.Item
            label="视图名称"
            name="name"
            rules={[
              { required: true, whitespace: true, max: 80 },
              {
                validator: async (_, value: string) => {
                  if (
                    views?.some(
                      (v) =>
                        v.project_id === ctx.project.id &&
                        v.name === value?.trim(),
                    )
                  )
                    throw new Error("已有同名个人视图，请使用其他名称");
                },
              },
            ]}
          >
            <Input placeholder="例如：本期收入资料" maxLength={80} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>
            保存个人视图
          </Button>
        </Form>
      </Modal>
    </>
  );
}

export function ChecklistDetail() {
  const { id } = useParams();
  const location = useLocation();
  const [detailParams, setDetailParams] = useSearchParams();
  const locationState = location.state as { listSearch?: string } | null;
  const listSearch = checklistFilters(
    new URLSearchParams(locationState?.listSearch || ""),
  ).toString();
  const { ctx, me, base } = useWork();
  const [rev, setRev] = useState(0);
  const reload = () => setRev((x) => x + 1);
  const { data, loading, error } = useData(`/checklists/${id}`, rev);
  const { run, busy } = useAction(reload);
  const [modal, setModal] = useState("");
  const [candidates, setCandidates] = useState<any[]>([]);
  const item = data?.item;
  const owner = item?.owner_id === me.user.id;
  const reviewer = item?.reviewer_id === me.user.id;
  const openLink = () =>
    run(async () => {
      setCandidates(
        (
          await api(
            `/projects/${ctx.project.id}/evidence?page_size=100&org_id=${item.org_id}&period_id=${item.period_id}`,
          )
        ).items,
      );
      setModal("link");
    }, "已读取可关联目录");
  return (
    <LoadState loading={loading} error={error}>
      {item && (
        <>
          <Link
            className="backlink"
            to={`${base}/checklists${listSearch ? `?${listSearch}` : ""}`}
          >
            ← 返回资料清单
          </Link>
          <PageTitle
            title={item.title}
            subtitle={`${item.topic_code} · ${item.org_name} · ${item.period_label}`}
            action={
              <Space>
                <ApplicabilityTag value={item.applicability} />
                <StateTag value={item.state} />
              </Space>
            }
          />
          <Card className="mb16">
            <Descriptions
              column={3}
              items={[
                {
                  key: "o",
                  label: "资料经办",
                  children: item.owner_name || "待分派",
                },
                {
                  key: "r",
                  label: "独立复核",
                  children: item.reviewer_name || "待分派",
                },
                { key: "d", label: "截止日期", children: item.due || "待确定" },
                {
                  key: "v",
                  label: "记录版本",
                  children: `第 ${item.row_version} 版`,
                },
                { key: "p", label: "资料模式", children: "A · 目录登记" },
                { key: "s", label: "验收依据", children: "项目内部准备模板" },
              ]}
            />
            <div className="detail-actions">
              {data.template_upgrade &&
                ctx.roles.some((r) => ["cfo", "pmo"].includes(r)) && (
                  <Button onClick={() => setModal("template")}>
                    评估新版标准
                  </Button>
                )}
              <Button onClick={() => setModal("applicability")}>
                确认适用性
              </Button>
              {owner && (
                <>
                  <Button onClick={openLink}>关联目录</Button>
                  <Button
                    type="primary"
                    disabled={[
                      "accepted",
                      "submitted",
                      "restricted_verified",
                    ].includes(item.workflow_state)}
                    onClick={() =>
                      run(
                        () =>
                          api(`/checklists/${id}/submissions`, {
                            expected_version: item.row_version,
                          }),
                        "已提交独立复核",
                      )
                    }
                  >
                    提交复核
                  </Button>
                </>
              )}
              {reviewer && item.workflow_state === "submitted" && (
                <Button type="primary" onClick={() => setModal("review")}>
                  开始独立复核
                </Button>
              )}
              {ctx.roles.some((r) =>
                ["cfo", "pmo", "reviewer"].includes(r),
              ) && <Button onClick={() => setModal("gap")}>登记缺口</Button>}
            </div>
          </Card>
          {item.state === "needs_review" && (
            <Alert
              className="mb16"
              type="warning"
              showIcon
              title="原复核依据已变化"
              description="历史结论已保留，当前版本需由经办重新提交并独立复核。"
            />
          )}
          <Tabs
            activeKey={
              ["evidence", "reviews", "gaps"].includes(
                detailParams.get("tab") || "",
              )
                ? detailParams.get("tab")!
                : "evidence"
            }
            onChange={(tab) =>
              setDetailParams({ tab }, { replace: true, state: location.state })
            }
            items={[
              {
                key: "evidence",
                label: `关联目录 (${data.evidence.length})`,
                children: (
                  <Card>
                    <p className="standard">
                      <strong>最小验收标准</strong>
                      {item.standard}
                    </p>
                    <div className="checks">
                      {item.checks.map((s: string) => (
                        <Tag key={s}>
                          <CheckCircleOutlined /> {s}
                        </Tag>
                      ))}
                    </div>
                    <Table
                      rowKey="id"
                      dataSource={data.evidence}
                      pagination={false}
                      columns={[
                        {
                          title: "目录代号",
                          dataIndex: "code",
                          render: (v: string, r: any) => (
                            <Link to={`${base}/evidence/${r.id}`}>{v}</Link>
                          ),
                        },
                        {
                          title: "当前版本",
                          render: (_: any, r: any) => `V${r.version.number}`,
                        },
                        {
                          title: "保管部门",
                          render: (_: any, r: any) =>
                            r.version.content.department,
                        },
                        {
                          title: "位置代号",
                          render: (_: any, r: any) =>
                            r.version.content.location_code,
                        },
                        {
                          title: "操作",
                          render: (_: any, r: any) => (
                            <Link to={`${base}/evidence/${r.id}`}>
                              查看版本
                            </Link>
                          ),
                        },
                      ]}
                    />
                  </Card>
                ),
              },
              {
                key: "reviews",
                label: `复核历史 (${data.reviews.length})`,
                children: (
                  <Card>
                    {data.reviews.length ? (
                      <Timeline
                        items={data.reviews.map((r: any) => ({
                          color: r.decision === "return" ? "orange" : "green",
                          children: (
                            <>
                              <strong>
                                {r.decision === "accept"
                                  ? "接受"
                                  : r.decision === "return"
                                    ? "退回补充"
                                    : "受限已核"}
                              </strong>
                              <p>{r.reason}</p>
                              {r.verification_method && (
                                <p>
                                  离线核查方式：{r.verification_method} ·{" "}
                                  {formatDateTime(r.verified_at)}
                                </p>
                              )}
                              <small className="muted">
                                {formatDateTime(r.created_at)} · 提交{" "}
                                {r.submission_id.slice(0, 8)}
                              </small>
                            </>
                          ),
                        }))}
                      />
                    ) : (
                      <NoData text="尚无独立复核记录" />
                    )}
                  </Card>
                ),
              },
              {
                key: "gaps",
                label: `缺口与审批 (${data.gaps.length})`,
                children: (
                  <Card>
                    <Table
                      rowKey="id"
                      dataSource={data.gaps}
                      pagination={false}
                      columns={[
                        { title: "缺口事实", dataIndex: "facts" },
                        { title: "类型", dataIndex: "kind" },
                        {
                          title: "后续处理",
                          render: (_: any, r: any) => (
                            <Link
                              to={`${base}/issues?gap=${r.id}&item=${item.id}`}
                            >
                              关联新整改
                            </Link>
                          ),
                        },
                      ]}
                    />
                    <h3>适用性审批</h3>
                    {data.approvals.map((a: any) => (
                      <div className="approval-row" key={a.id}>
                        <div>
                          {a.reason}
                          <Tag>
                            {a.state === "pending"
                              ? "待批准"
                              : a.state === "approved"
                                ? "已批准"
                                : "已退回"}
                          </Tag>
                        </div>
                        {a.state === "pending" &&
                          a.author_id !== me.user.id &&
                          ctx.roles.some((r) =>
                            ["cfo", "reviewer"].includes(r),
                          ) && (
                            <Button
                              onClick={() =>
                                run(
                                  () =>
                                    api(`/approvals/${a.id}/decisions`, {
                                      approve: true,
                                      reason: "已独立核对不适用原因与范围",
                                    }),
                                  "已批准不适用",
                                )
                              }
                            >
                              独立批准
                            </Button>
                          )}
                      </div>
                    ))}
                  </Card>
                ),
              },
            ]}
          />
          <Modal
            title={
              modal === "template"
                ? "评估新版验收标准"
                : modal === "applicability"
                  ? "确认适用性"
                  : modal === "link"
                    ? "关联目录版本"
                    : modal === "review"
                      ? "独立复核"
                      : "登记具体缺口"
            }
            open={!!modal}
            onCancel={() => setModal("")}
            footer={null}
            destroyOnHidden
          >
            <Form
              layout="vertical"
              onFinish={(v) =>
                run(async () => {
                  if (modal === "applicability")
                    await api(`/checklists/${id}/applicability-proposals`, {
                      ...v,
                      expected_version: item.row_version,
                    });
                  if (modal === "link")
                    await api(`/checklists/${id}/evidence-links`, {
                      ...v,
                      expected_version: item.row_version,
                    });
                  if (modal === "review")
                    await api(`/checklists/${id}/reviews`, {
                      ...v,
                      checks: v.checks || [],
                      expected_version: item.row_version,
                      evidence_version_ids: data.evidence.map(
                        (e: any) => e.current_version_id,
                      ),
                    });
                  if (modal === "template")
                    await api(`/checklists/${id}/template-decisions`, {
                      ...v,
                      expected_version: item.row_version,
                      new_template_item_id: data.template_upgrade.id,
                    });
                  if (modal === "gap")
                    await api(`/projects/${ctx.project.id}/gaps`, {
                      ...v,
                      item_id: id,
                    });
                  setModal("");
                })
              }
            >
              {modal === "template" && (
                <>
                  <Alert
                    type="info"
                    className="mb16"
                    title="采用后需按新标准重新提交复核；原有结论保持不变。"
                  />
                  <h4>当前标准</h4>
                  <p>{item.standard}</p>
                  <h4>新版标准</h4>
                  <p>{data.template_upgrade.standard}</p>
                  <p>检查点：{data.template_upgrade.checks.join("、")}</p>
                  <Form.Item
                    name="decision"
                    label="处理决定"
                    rules={[{ required: true }]}
                  >
                    <Select
                      options={[
                        { value: "adopt", label: "采用新版" },
                        { value: "retain", label: "保留原标准" },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item
                    name="reason"
                    label="判断依据"
                    rules={[{ required: true, min: 3 }]}
                  >
                    <Input.TextArea />
                  </Form.Item>
                  {data.template_decisions.map((d: any) => (
                    <p key={d.id}>
                      {d.decision === "adopt" ? "已采用" : "已保留"} ·{" "}
                      {d.reason}
                    </p>
                  ))}
                </>
              )}
              {modal === "applicability" && (
                <>
                  <Form.Item
                    name="value"
                    label="适用性"
                    rules={[{ required: true }]}
                  >
                    <Select
                      options={[
                        { value: "applicable", label: "适用" },
                        { value: "pending", label: "待确认" },
                        {
                          value: "not_applicable",
                          label: "不适用（提交独立批准）",
                        },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item
                    name="reason"
                    label="主体与期间层面的理由"
                    rules={[{ required: true, min: 3 }]}
                  >
                    <Input.TextArea />
                  </Form.Item>
                </>
              )}
              {modal === "link" && (
                <Form.Item
                  name="evidence_id"
                  label="当前有效目录"
                  rules={[{ required: true }]}
                >
                  <Select
                    showSearch
                    filterOption={false}
                    onSearch={(q) =>
                      api(
                        `/projects/${ctx.project.id}/evidence?page_size=100&org_id=${item.org_id}&period_id=${item.period_id}&q=${encodeURIComponent(q)}`,
                      ).then((d) => setCandidates(d.items))
                    }
                    options={candidates
                      .filter(
                        (e) =>
                          e.org_id === item.org_id &&
                          e.period_id === item.period_id,
                      )
                      .map((e) => ({
                        value: e.id,
                        label: `${e.code} · V${e.version.number}`,
                      }))}
                  />
                </Form.Item>
              )}
              {modal === "review" && (
                <>
                  <Form.Item
                    name="decision"
                    label="复核决定"
                    rules={[{ required: true }]}
                  >
                    <Select
                      options={[
                        { value: "accept", label: "接受" },
                        { value: "return", label: "退回补充" },
                        {
                          value: "restricted_verified",
                          label: "受限已核（离线核查）",
                        },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="checks" label="逐项验收">
                    <Checkbox.Group options={item.checks} />
                  </Form.Item>
                  <Form.Item
                    name="verification_method"
                    label="离线核查方式（受限已核必填）"
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item
                    name="reason"
                    label="结论及具体补充动作"
                    rules={[{ required: true, min: 3 }]}
                  >
                    <Input.TextArea />
                  </Form.Item>
                </>
              )}
              {modal === "gap" && (
                <>
                  <Form.Item
                    name="kind"
                    label="缺口类型"
                    rules={[{ required: true }]}
                  >
                    <Select
                      options={[
                        ["missing", "缺件"],
                        ["scope_mismatch", "主体期间不符"],
                        ["approval_missing", "审批缺失"],
                        ["wrong_version", "错版"],
                        ["control", "内控执行"],
                        ["restricted", "保密限制"],
                        ["other", "其他"],
                      ].map(([value, label]) => ({ value, label }))}
                    />
                  </Form.Item>
                  <Form.Item
                    name="facts"
                    label="可核实的具体差异"
                    rules={[{ required: true, min: 3 }]}
                  >
                    <Input.TextArea />
                  </Form.Item>
                </>
              )}
              <Button type="primary" htmlType="submit" loading={busy}>
                确认提交
              </Button>
            </Form>
          </Modal>
        </>
      )}
    </LoadState>
  );
}
