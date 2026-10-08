import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
} from "antd";
import { PlusOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useWork } from "../App";
import { acquisitionNames, api } from "../api";
import { LoadState, PageTitle, StateTag, useAction, useData } from "../shared";

function MetadataFields() {
  return (
    <>
      <Form.Item
        name={["metadata", "document_type"]}
        label="资料类型"
        rules={[{ required: true }]}
      >
        <Input placeholder="例如：财务报表目录" />
      </Form.Item>
      <div className="form-grid">
        <Form.Item
          name={["metadata", "department"]}
          label="保管部门"
          rules={[{ required: true }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name={["metadata", "location_code"]}
          label="获准位置代号"
          rules={[{ required: true }]}
        >
          <Input placeholder="只填获准代号" />
        </Form.Item>
      </div>
      <Form.Item
        name={["metadata", "acquisition"]}
        label="取得状态"
        rules={[{ required: true }]}
      >
        <Select
          options={Object.entries(acquisitionNames).map(([value, label]) => ({
            value,
            label,
          }))}
        />
      </Form.Item>
      <Form.Item name={["metadata", "note"]} label="获准的目录说明">
        <Input.TextArea
          maxLength={300}
          showCount
          placeholder="不填客户名称、财务金额或原件正文"
        />
      </Form.Item>
    </>
  );
}

export function EvidenceList() {
  const { ctx, base } = useWork();
  const [rev, setRev] = useState(0);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const { data, loading, error } = useData(
    `/projects/${ctx.project.id}/evidence?q=${encodeURIComponent(q)}&page=${page}`,
    rev,
  );
  const { run, busy } = useAction(() => setRev((x) => x + 1));
  const canCreate = ctx.roles.some((r) => ["owner", "pmo", "cfo"].includes(r));
  const [form] = Form.useForm();
  const org = Form.useWatch("org_id", form);
  return (
    <>
      <PageTitle
        title="资料目录"
        subtitle="记录获准的非敏感目录信息，保留每次提交的版本。"
        action={
          canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined aria-hidden />}
              onClick={() => setOpen(true)}
            >
              登记目录
            </Button>
          )
        }
      />
      <Alert
        className="mb16"
        type="info"
        showIcon
        icon={<SafetyCertificateOutlined />}
        title="A 模式 · 原件不入库"
        description="仅登记获准代号、保管位置与取得状态。文件上传、预览、OCR与AI处理均未开放。"
      />
      <Card>
        <div className="filters">
          <Input.Search
            placeholder="搜索目录代号"
            allowClear
            onSearch={(v) => {
              setQ(v);
              setPage(1);
            }}
            style={{ width: 300 }}
          />
          <span className="muted">当前有权目录 {data?.total || 0} 份</span>
        </div>
        <LoadState loading={loading} error={error}>
          <Table<any>
            rowKey="id"
            dataSource={data?.items}
            pagination={{
              current: page,
              pageSize: 20,
              total: data?.total,
              showSizeChanger: false,
              onChange: setPage,
            }}
            columns={[
              {
                title: "目录代号",
                dataIndex: "code",
                render: (v: string, r: any) => (
                  <Link className="item-title" to={`${base}/evidence/${r.id}`}>
                    <strong>{v}</strong>
                  </Link>
                ),
              },
              {
                title: "资料类型",
                render: (_: any, r: any) => r.version.content.document_type,
              },
              {
                title: "主体",
                render: (_: any, r: any) =>
                  ctx.organizations.find((o) => o.id === r.org_id)?.name,
              },
              {
                title: "版本",
                render: (_: any, r: any) => <Tag>V{r.version.number}</Tag>,
              },
              {
                title: "保管部门 / 位置",
                render: (_: any, r: any) => (
                  <>
                    {r.version.content.department}
                    <div className="table-secondary">
                      {r.version.content.location_code}
                    </div>
                  </>
                ),
              },
              {
                title: "取得状态",
                render: (_: any, r: any) => (
                  <Tag>{acquisitionNames[r.version.content.acquisition]}</Tag>
                ),
              },
              {
                title: "操作",
                render: (_: any, r: any) => (
                  <Link to={`${base}/evidence/${r.id}`}>版本与记录</Link>
                ),
              },
            ]}
          />
        </LoadState>
      </Card>
      <Modal
        title="登记获准目录"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        destroyOnHidden
        width={650}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            mode: "A",
            metadata: { acquisition: "located", note: "" },
          }}
          onFinish={(v) =>
            run(async () => {
              await api(`/projects/${ctx.project.id}/evidence`, {
                ...v,
                mode: "A",
              });
              setOpen(false);
              form.resetFields();
            }, "目录已登记")
          }
        >
          <Form.Item
            name="code"
            label="获准目录代号"
            rules={[{ required: true }]}
          >
            <Input placeholder="不使用敏感原件标题" />
          </Form.Item>
          <div className="form-grid">
            <Form.Item
              name="org_id"
              label="所属主体"
              rules={[{ required: true }]}
            >
              <Select
                options={ctx.organizations.map((o) => ({
                  value: o.id,
                  label: o.name,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="period_id"
              label="覆盖期间"
              rules={[{ required: true }]}
            >
              <Select
                options={ctx.periods.map((p) => ({
                  value: p.id,
                  label: p.label,
                }))}
              />
            </Form.Item>
          </div>
          <Form.Item
            name="policy_id"
            label="有效目录准入依据"
            rules={[{ required: true }]}
          >
            <Select
              options={ctx.policies
                .filter(
                  (p) =>
                    p.state === "active" &&
                    p.org_id === org &&
                    new Date(p.expires_at) > new Date(),
                )
                .map((p) => ({ value: p.id, label: p.reference }))}
            />
          </Form.Item>
          <MetadataFields />
          <Form.Item
            name="reason"
            label="登记原因"
            rules={[{ required: true, min: 3 }]}
          >
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>
            保存目录
          </Button>
        </Form>
      </Modal>
    </>
  );
}

export function EvidenceDetail() {
  const { id } = useParams();
  const { me, base } = useWork();
  const [rev, setRev] = useState(0);
  const [open, setOpen] = useState(false);
  const { data, loading, error } = useData(`/evidence/${id}`, rev);
  const { run, busy } = useAction(() => setRev((x) => x + 1));
  const e = data?.evidence;
  const latest = data?.versions[0];
  return (
    <LoadState loading={loading} error={error}>
      {e && (
        <>
          <Link className="backlink" to={`${base}/evidence`}>
            ← 返回资料目录
          </Link>
          <PageTitle
            title={e.code}
            subtitle="固定元数据版本 · 完整保留历史"
            action={
              e.owner_id === me.user.id && (
                <Button type="primary" onClick={() => setOpen(true)}>
                  提交新版本
                </Button>
              )
            }
          />
          <div className="detail-columns">
            <Card title={`当前目录 · V${latest.number}`}>
              <Descriptions
                column={1}
                items={Object.entries(latest.content).map(([key, value]) => ({
                  key,
                  label:
                    (
                      {
                        document_type: "资料类型",
                        department: "保管部门",
                        location_code: "位置代号",
                        acquisition: "取得状态",
                        note: "目录说明",
                        date: "日期",
                        voucher_code: "凭证索引",
                      } as any
                    )[key] || key,
                  children:
                    key === "acquisition"
                      ? acquisitionNames[value as string]
                      : String(value || "—"),
                }))}
              />
              <div className="hash-box">
                版本摘要 <code>{latest.metadata_hash}</code>
              </div>
            </Card>
            <Card title="版本时间线">
              <Timeline
                items={data.versions.map((v: any) => ({
                  children: (
                    <>
                      <strong>V{v.number}</strong>
                      <p>{v.reason}</p>
                      <p className="muted">
                        {new Date(v.created_at).toLocaleString("zh-CN")}
                      </p>
                      <details>
                        <summary>查看当时目录</summary>
                        <Descriptions
                          column={1}
                          items={Object.entries(v.content).map(
                            ([key, value]) => ({
                              key,
                              label: key,
                              children: String(value || "—"),
                            }),
                          )}
                        />
                      </details>
                    </>
                  ),
                }))}
              />
            </Card>
          </div>
          <Modal
            title="提交新的目录版本"
            open={open}
            onCancel={() => setOpen(false)}
            footer={null}
            destroyOnHidden
          >
            <Alert
              className="mb16"
              type="warning"
              title="相关资料需求将进入待重新复核"
            />
            <Form
              layout="vertical"
              initialValues={{ metadata: latest.content }}
              onFinish={(v) =>
                run(async () => {
                  await api(`/evidence/${id}/versions`, {
                    ...v,
                    expected_version: e.row_version,
                  });
                  setOpen(false);
                }, "新版本已保存")
              }
            >
              <MetadataFields />
              <Form.Item
                name="reason"
                label="替换原因"
                rules={[{ required: true, min: 3 }]}
              >
                <Input.TextArea />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={busy}>
                提交新版本
              </Button>
            </Form>
          </Modal>
        </>
      )}
    </LoadState>
  );
}

export function Issues() {
  const { ctx, base } = useWork();
  const [params, setParams] = useSearchParams();
  const [rev, setRev] = useState(0);
  const [open, setOpen] = useState(false);
  const { data, loading, error } = useData(
    `/projects/${ctx.project.id}/issues?${params}`,
    rev,
  );
  const { run, busy } = useAction(() => setRev((x) => x + 1));
  const [gap, setGap] = useState<any>();
  const [issueForm] = Form.useForm();
  useEffect(() => {
    const item = params.get("item");
    const id = params.get("gap");
    if (item && id) {
      api(`/checklists/${item}`)
        .then((d) => {
          const g = d.gaps.find((g: any) => g.id === id);
          if (g) {
            setGap(g);
            issueForm.setFieldsValue({
              title: d.item.title + " · 整改",
              facts: g.facts,
              kind: g.kind,
              org_id: d.item.org_id,
            });
            setOpen(true);
          }
        })
        .catch(() => setGap(undefined));
    }
  }, [params.get("gap")]);
  return (
    <>
      <PageTitle
        title="整改台账"
        subtitle="从具体缺口到独立验证，每个事项都有责任、期限和证据。"
        action={
          ctx.roles.some((r) => ["cfo", "pmo", "reviewer"].includes(r)) && (
            <Button
              type="primary"
              icon={<PlusOutlined aria-hidden />}
              onClick={() => {
                setGap(undefined);
                issueForm.resetFields();
                setOpen(true);
              }}
            >
              新增整改
            </Button>
          )
        }
      />
      <Card>
        <div className="filters">
          <Select
            placeholder="全部状态"
            value={params.get("state") || undefined}
            allowClear
            onChange={(v) => setParams(v ? { state: v } : {})}
            options={[
              ["open", "全部未关闭"],
              ["in_progress", "整改中"],
              ["pending_verification", "待验证"],
              ["closed", "已关闭"],
              ["risk", "风险待决策"],
            ].map(([value, label]) => ({ value, label }))}
          />
          <Button
            type={params.has("overdue") ? "primary" : "default"}
            onClick={() =>
              setParams(params.has("overdue") ? {} : { overdue: "true" })
            }
          >
            只看逾期
          </Button>
          <Button type="text" onClick={() => setParams({})}>
            清空筛选
          </Button>
          <span className="muted">延期不会覆盖原截止日</span>
        </div>
        <LoadState loading={loading} error={error}>
          <Table<any>
            rowKey="id"
            dataSource={data?.items}
            pagination={{
              current: Number(params.get("page") || 1),
              pageSize: 20,
              total: data?.total,
              showSizeChanger: false,
              onChange: (p) => {
                const next = new URLSearchParams(params);
                next.set("page", String(p));
                setParams(next);
              },
            }}
            columns={[
              {
                title: "优先级",
                dataIndex: "severity",
                width: 90,
                render: (s) => (
                  <Tag
                    color={
                      s === "P0" ? "red" : s === "P1" ? "orange" : "default"
                    }
                  >
                    {s}
                  </Tag>
                ),
              },
              {
                title: "整改事项",
                render: (_: any, r: any) => (
                  <Link className="item-title" to={`${base}/issues/${r.id}`}>
                    <strong>{r.title}</strong>
                    {r.reassessment_required && (
                      <Tag color="orange">证据已变化</Tag>
                    )}
                  </Link>
                ),
              },
              {
                title: "Owner / 验证人",
                render: (_: any, r: any) => (
                  <>
                    {r.owner_name?.split(" · ")[0]}
                    <div className="table-secondary">
                      验证：{r.verifier_name?.split(" · ")[0]}
                    </div>
                  </>
                ),
              },
              {
                title: "截止日期",
                render: (_: any, r: any) => (
                  <>
                    <span className={r.overdue ? "danger" : ""}>
                      {r.current_due}
                      {r.overdue ? " · 逾期" : ""}
                    </span>
                    <div className="table-secondary">原定 {r.original_due}</div>
                  </>
                ),
              },
              {
                title: "延期",
                dataIndex: "extension_count",
                render: (v) => `${v} 次`,
              },
              {
                title: "状态",
                dataIndex: "state",
                render: (s) => <StateTag value={s} />,
              },
            ]}
          />
        </LoadState>
      </Card>
      <Modal
        title="新增整改事项"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        destroyOnHidden
        width={620}
      >
        <Form
          form={issueForm}
          layout="vertical"
          onFinish={(v) =>
            run(async () => {
              await api(`/projects/${ctx.project.id}/issues`, {
                ...v,
                gap_ids: gap ? [gap.id] : [],
              });
              setOpen(false);
              setGap(undefined);
              setParams({});
            }, "整改已创建")
          }
        >
          <Form.Item
            name="title"
            label="事项标题"
            rules={[{ required: true, min: 3 }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="facts"
            label="可核实的差异事实"
            rules={[{ required: true, min: 3 }]}
          >
            <Input.TextArea />
          </Form.Item>
          <div className="form-grid">
            <Form.Item name="kind" label="类型" rules={[{ required: true }]}>
              <Select
                options={[
                  ["missing", "缺件"],
                  ["scope_mismatch", "主体期间不符"],
                  ["approval_missing", "审批缺失"],
                  ["control", "内控执行"],
                  ["other", "其他"],
                ].map(([value, label]) => ({ value, label }))}
              />
            </Form.Item>
            <Form.Item
              name="severity"
              label="内部优先级"
              rules={[{ required: true }]}
            >
              <Select
                options={["P0", "P1", "P2"].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </Form.Item>
          </div>
          <Form.Item
            name="org_id"
            label="所属主体"
            rules={[{ required: true }]}
          >
            <Select
              options={ctx.organizations.map((o) => ({
                value: o.id,
                label: o.name,
              }))}
            />
          </Form.Item>
          <div className="form-grid">
            <Form.Item
              name="owner_id"
              label="整改Owner"
              rules={[{ required: true }]}
            >
              <Select
                options={ctx.users
                  .filter((u) =>
                    u.roles.some((r) => ["owner", "cfo", "pmo"].includes(r)),
                  )
                  .map((u) => ({ value: u.id, label: u.display_name }))}
              />
            </Form.Item>
            <Form.Item
              name="verifier_id"
              label="独立验证人"
              rules={[{ required: true }]}
            >
              <Select
                options={ctx.users
                  .filter((u) =>
                    u.roles.some((r) => ["reviewer", "cfo"].includes(r)),
                  )
                  .map((u) => ({ value: u.id, label: u.display_name }))}
              />
            </Form.Item>
          </div>
          <Form.Item name="due" label="原截止日期" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>
            创建整改
          </Button>
        </Form>
      </Modal>
    </>
  );
}

export function IssueDetail() {
  const { id } = useParams();
  const { ctx, me, base } = useWork();
  const [rev, setRev] = useState(0);
  const [action, setAction] = useState("");
  const [evidence, setEvidence] = useState<any[]>([]);
  const { data, loading, error } = useData(`/issues/${id}`, rev);
  const { run, busy } = useAction(() => setRev((x) => x + 1));
  const row = data?.issue;
  const actionNames: Record<string, string> = {
    actions: "记录行动",
    "submit-verification": "申请独立验证",
    verifications: "验证通过并关闭",
    return: "退回整改",
    reopen: "重开整改",
    risk: "转风险待决策",
    resume: "批准恢复整改",
    "extension-requests": "申请延期",
  };
  const open = (key: string) =>
    run(async () => {
      if (["submit-verification", "verifications"].includes(key))
        setEvidence(
          (
            await api(
              `/projects/${ctx.project.id}/evidence?page_size=100&org_id=${row.org_id}`,
            )
          ).items,
        );
      setAction(key);
    }, "请填写处理意见");
  return (
    <LoadState loading={loading} error={error}>
      {row && (
        <>
          <Link className="backlink" to={`${base}/issues`}>
            ← 返回整改台账
          </Link>
          <PageTitle
            title={row.title}
            subtitle={`事项 ${row.id.slice(0, 8)} · ${row.owner_name}`}
            action={
              <Space>
                <Tag color={row.severity === "P0" ? "red" : "orange"}>
                  {row.severity}
                </Tag>
                <StateTag value={row.state} />
              </Space>
            }
          />
          <div className="detail-columns">
            <Card title="整改事实与行动">
              <p>{row.facts}</p>
              <Descriptions
                column={2}
                items={[
                  { key: "o", label: "整改Owner", children: row.owner_name },
                  {
                    key: "v",
                    label: "独立验证人",
                    children: row.verifier_name,
                  },
                  {
                    key: "d",
                    label: "当前批准截止日",
                    children: (
                      <span className={row.overdue ? "danger" : ""}>
                        {row.current_due}
                      </span>
                    ),
                  },
                  { key: "od", label: "原截止日", children: row.original_due },
                  {
                    key: "e",
                    label: "批准延期次数",
                    children: `${row.extension_count} 次`,
                  },
                ]}
              />
              <div className="detail-actions">
                {row.owner_id === me.user.id && row.state !== "closed" && (
                  <>
                    <Button onClick={() => open("actions")}>记录行动</Button>
                    <Button onClick={() => open("extension-requests")}>
                      申请延期
                    </Button>
                    {row.state === "in_progress" && (
                      <>
                        <Button onClick={() => open("risk")}>风险待决策</Button>
                        <Button
                          type="primary"
                          onClick={() => open("submit-verification")}
                        >
                          申请验证
                        </Button>
                      </>
                    )}
                  </>
                )}
                {row.verifier_id === me.user.id &&
                  row.state === "pending_verification" && (
                    <>
                      <Button onClick={() => open("return")}>退回整改</Button>
                      <Button
                        type="primary"
                        onClick={() => open("verifications")}
                      >
                        独立验证
                      </Button>
                    </>
                  )}
                {(row.verifier_id === me.user.id ||
                  ctx.roles.includes("cfo")) &&
                  row.state === "closed" && (
                    <Button onClick={() => open("reopen")}>重开事项</Button>
                  )}
                {(row.verifier_id === me.user.id ||
                  ctx.roles.includes("cfo")) &&
                  row.state === "risk" && (
                    <Button onClick={() => open("resume")}>恢复整改</Button>
                  )}
              </div>
              <h3>延期审批记录</h3>
              {data.approvals.length ? (
                data.approvals.map((a: any) => (
                  <div className="approval-row" key={a.id}>
                    <div>
                      <strong>申请延期至 {a.payload.new_due}</strong>
                      <p>{a.reason}</p>
                      <Tag>
                        {a.state === "pending"
                          ? "待批准"
                          : a.state === "approved"
                            ? "已批准"
                            : "已退回"}
                      </Tag>
                    </div>
                    {a.state === "pending" &&
                      ctx.roles.includes("cfo") &&
                      a.author_id !== me.user.id && (
                        <Button
                          onClick={() =>
                            run(
                              () =>
                                api(`/approvals/${a.id}/decisions`, {
                                  approve: true,
                                  reason: "已独立核对延期原因与影响",
                                }),
                              "延期已批准",
                            )
                          }
                        >
                          批准延期
                        </Button>
                      )}
                  </div>
                ))
              ) : (
                <p className="muted">暂无延期，仍按原截止日跟踪。</p>
              )}
            </Card>
            <Card title="处理时间线">
              <Timeline
                items={data.actions.map((a: any) => ({
                  children: (
                    <>
                      <strong>
                        {actionNames[a.action] ||
                          (
                            {
                              created: "事项创建",
                              extension_approved: "延期已批准",
                            } as any
                          )[a.action] ||
                          a.action}
                      </strong>
                      <p>{a.reason}</p>
                      <small className="muted">
                        {new Date(a.created_at).toLocaleString("zh-CN")}
                      </small>
                    </>
                  ),
                }))}
              />
            </Card>
          </div>
          <Modal
            title={actionNames[action]}
            open={!!action}
            onCancel={() => setAction("")}
            footer={null}
            destroyOnHidden
          >
            <Form
              layout="vertical"
              onFinish={(v) =>
                run(async () => {
                  await api(`/issues/${id}/${action}`, {
                    ...v,
                    expected_version: row.row_version,
                  });
                  setAction("");
                }, "处理记录已保存")
              }
            >
              <Form.Item
                name="reason"
                label="行动结果或处理意见"
                rules={[{ required: true, min: 3 }]}
              >
                <Input.TextArea />
              </Form.Item>
              {action === "extension-requests" && (
                <Form.Item
                  name="new_due"
                  label="申请新截止日"
                  rules={[{ required: true }]}
                >
                  <Input type="date" />
                </Form.Item>
              )}
              {["submit-verification", "verifications"].includes(action) && (
                <Form.Item
                  name="evidence_version_ids"
                  label="当前有效的目录版本证据"
                  rules={[{ required: true }]}
                >
                  <Select
                    mode="multiple"
                    showSearch
                    filterOption={false}
                    onSearch={(q) =>
                      api(
                        `/projects/${ctx.project.id}/evidence?page_size=100&org_id=${row.org_id}&q=${encodeURIComponent(q)}`,
                      ).then((d) => setEvidence(d.items))
                    }
                    options={evidence
                      .filter(
                        (e) =>
                          e.org_id === row.org_id &&
                          (action !== "verifications" ||
                            data.version_ids.includes(e.current_version_id)),
                      )
                      .map((e) => ({
                        value: e.current_version_id,
                        label: `${e.code} · V${e.version.number}`,
                      }))}
                  />
                </Form.Item>
              )}
              <Button type="primary" htmlType="submit" loading={busy}>
                确认处理
              </Button>
            </Form>
          </Modal>
        </>
      )}
    </LoadState>
  );
}
