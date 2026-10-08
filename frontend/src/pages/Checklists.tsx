import { useState } from "react";
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
} from "react-router-dom";
import { useWork } from "../App";
import { api, domainNames, stateNames } from "../api";
import {
  ApplicabilityTag,
  LoadState,
  NoData,
  PageTitle,
  StateTag,
  useAction,
  useData,
} from "../shared";

export function Dashboard() {
  const { ctx, me, base } = useWork();
  const [org, setOrg] = useState<string>();
  const { data, loading, error } = useData(
    `/projects/${ctx.project.id}/dashboard${org ? `?org_id=${org}` : ""}`,
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
              placeholder="全部授权主体"
              allowClear
              value={org}
              onChange={setOrg}
              style={{ width: 170 }}
              options={ctx.organizations.map((o) => ({
                value: o.id,
                label: o.name,
              }))}
            />
            <Button
              icon={<UnorderedListOutlined />}
              onClick={() => navigate(`${base}/checklists`)}
            >
              查看清单
            </Button>
          </Space>
        }
      />
      <LoadState loading={loading} error={error}>
        {data && (
          <>
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
                  strokeColor="#a9d5b2"
                  railColor="rgba(255,255,255,.14)"
                  format={() => (
                    <CheckCircleOutlined
                      style={{ color: "#cce8d1", fontSize: 32 }}
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
                        ? `${base}/issues?state=open${org ? `&org_id=${org}` : ""}`
                        : filter === "overdue"
                          ? `${base}/issues?overdue=true${org ? `&org_id=${org}` : ""}`
                          : `${base}/checklists?${filter}${org ? `&org_id=${org}` : ""}`,
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
                  <Link to={`${base}/checklists`}>
                    查看全部 <ArrowRightOutlined />
                  </Link>
                }
              >
                <div className="domain-list">
                  {data.domains.map((d: any) => (
                    <button
                      key={d.domain}
                      onClick={() =>
                        navigate(
                          `${base}/checklists?domain=${d.domain}${org ? `&org_id=${org}` : ""}`,
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
                  <Link to={`${base}/issues`}>
                    整改台账 <ArrowRightOutlined />
                  </Link>
                }
              >
                {data.urgent_issues.length ? (
                  <div className="urgent-list">
                    {data.urgent_issues.slice(0, 4).map((r: any) => (
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
              extra={<Link to={`${base}/checklists?mine=true`}>查看全部</Link>}
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
                    render: (_: any, r: any) => (
                      <Link to={`${base}/checklists/${r.id}`}>
                        <span className="code">{r.topic_code}</span>
                        {r.title}
                      </Link>
                    ),
                  },
                  {
                    title: "主体 / 期间",
                    render: (_: any, r: any) => (
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
                    render: (_: any, r: any) => (
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
  const [preview, setPreview] = useState<any>();
  const [job, setJob] = useState<any>();
  const reload = () => setRev((x) => x + 1);
  const { run, busy } = useAction(reload);
  const manager = ctx.roles.some((r) => ["pmo", "cfo"].includes(r));
  const { data, loading, error } = useData(
    `/projects/${ctx.project.id}/checklists?${params}`,
    rev,
  );
  const change = (key: string, value?: string) => {
    setSelected([]);
    const p = new URLSearchParams(params);
    if (value) p.set(key, value);
    else p.delete(key);
    p.set("page", "1");
    setParams(p);
  };
  const generation = {
    template_version_id: ctx.project.template_version_id,
    scope_version: ctx.project.scope_version,
  };
  return (
    <>
      <PageTitle
        title="财务资料清单"
        subtitle="按主体与期间跟踪适用性、责任分工和当前资料版本。"
        action={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={reload}>
              刷新
            </Button>
            {manager && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                loading={busy}
                onClick={() =>
                  run(async () => {
                    setPreview(
                      await api(
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
            defaultValue={params.get("q") || ""}
            onSearch={(v) => change("q", v)}
            style={{ width: 270 }}
          />
          <Select
            placeholder="全部主体"
            allowClear
            value={params.get("org_id") || undefined}
            onChange={(v) => change("org_id", v)}
            options={ctx.organizations.map((o) => ({
              value: o.id,
              label: o.name,
            }))}
          />
          <Select
            placeholder="全部领域"
            allowClear
            value={params.get("domain") || undefined}
            onChange={(v) => change("domain", v)}
            options={Object.entries(domainNames).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Select
            placeholder="适用性"
            allowClear
            value={params.get("applicability") || undefined}
            onChange={(v) => change("applicability", v)}
            options={[
              { value: "pending", label: "待确认" },
              { value: "applicable", label: "适用" },
              { value: "not_applicable", label: "不适用" },
            ]}
          />
          <Select
            placeholder="全部进度"
            allowClear
            value={params.get("state") || undefined}
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
          <Button type="text" onClick={() => setParams({})}>
            清空筛选
          </Button>
        </div>
        <div className="list-toolbar">
          <Space>
            <strong>{data?.total || 0} 项资料需求</strong>
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
        <LoadState loading={loading} error={error}>
          <Table<any>
            rowKey="id"
            scroll={{ x: 1080 }}
            dataSource={data?.items}
            rowSelection={
              manager
                ? { selectedRowKeys: selected, onChange: setSelected }
                : undefined
            }
            pagination={{
              current: Number(params.get("page") || 1),
              pageSize: Number(params.get("page_size") || 20),
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
                render: (_: any, r: any) => (
                  <Link
                    className="item-title"
                    to={`${base}/checklists/${r.id}`}
                  >
                    <span className="code">{r.topic_code}</span>
                    <strong>{r.title}</strong>
                  </Link>
                ),
              },
              {
                title: "主体 / 期间",
                width: 190,
                render: (_: any, r: any) => (
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
                render: (_: any, r: any) => (
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
                render: (_: any, r: any) => (
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
        onOk={() =>
          run(async () => {
            const j = await api(
              `/projects/${ctx.project.id}/checklist-jobs`,
              generation,
            );
            setJob(j);
            setPreview(undefined);
          }, "生成任务已提交")
        }
      >
        <Descriptions
          column={2}
          items={
            preview
              ? ["total", "new", "existing", "pending"].map((key, i) => ({
                  key,
                  label: ["预计总项数", "新增", "已存在", "待确认适用性"][i],
                  children: preview[key],
                }))
              : []
          }
        />
        <p className="muted">
          已有复核及整改记录保留。新增项需要人工确认适用性。
        </p>
      </Modal>
      {job && (
        <Alert
          className="mt16"
          type={job.state === "failed" ? "error" : "info"}
          title={`生成任务：${({ queued: "等待处理", running: "处理中", retry_wait: "等待重试", succeeded: "已完成", failed: "失败" } as any)[job.state] || job.state}`}
          description={
            job.result
              ? `新增 ${job.result.new} 项，已存在 ${job.result.existing} 项`
              : job.error_code || "可刷新查询当前进度"
          }
          action={
            <Button
              onClick={() =>
                run(
                  async () => setJob(await api(`/jobs/${job.id}`)),
                  "任务状态已更新",
                )
              }
            >
              查询进度
            </Button>
          }
        />
      )}
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
              const result = await api("/checklists/assignments", {
                rows: (data?.items || [])
                  .filter((r: any) => selected.includes(r.id))
                  .map((r: any) => ({
                    item_id: r.id,
                    expected_version: r.row_version,
                    ...v,
                  })),
              });
              const failed = result.results.filter((r: any) => !r.success);
              if (failed.length) {
                reload();
                setSelected(failed.map((r: any) => r.id));
              }
              if (failed.length)
                throw new Error(failed.map((r: any) => r.message).join("；"));
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
    </>
  );
}

export function ChecklistDetail() {
  const { id } = useParams();
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
          <Link className="backlink" to={`${base}/checklists`}>
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
                                  {new Date(r.verified_at).toLocaleString(
                                    "zh-CN",
                                  )}
                                </p>
                              )}
                              <small className="muted">
                                {new Date(r.created_at).toLocaleString("zh-CN")}{" "}
                                · 提交 {r.submission_id.slice(0, 8)}
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
