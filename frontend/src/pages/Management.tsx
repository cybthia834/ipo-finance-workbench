import { useState } from "react";
import { TemplateEditor } from "./TemplateEditor";
import { ScopeEditor } from "./ScopeEditor";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tabs,
} from "antd";
import {
  CameraOutlined,
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useWork } from "../App";
import { api, roleNames } from "../api";
import { LoadState, NoData, PageTitle, useAction, useData } from "../shared";

export function Reports() {
  const { ctx, me } = useWork();
  const [rev, setRev] = useState(0);
  const [modal, setModal] = useState("");
  const [target, setTarget] = useState<any>();
  const {
    data: snapshots,
    loading,
    error,
  } = useData(`/projects/${ctx.project.id}/snapshots`, rev);
  const { data: approvals } = useData(
    `/projects/${ctx.project.id}/approvals`,
    rev,
  );
  const { data: metrics } = useData(`/projects/${ctx.project.id}/metrics`, rev);
  const { run, busy } = useAction(() => setRev((x) => x + 1));
  const { message } = App.useApp();
  const download = async (id: string) => {
    const response = await fetch(`/api/v1/exports/${id}/download`, {
      credentials: "same-origin",
    });
    if (!response.ok) {
      const x = await response.json();
      message.error(x.error?.message || "下载失败");
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = "财务目录快照.zip";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <PageTitle
        title="报表与阶段快照"
        subtitle="冻结当前口径与版本，在授权范围内复现当时的资料进展。"
        action={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => setRev((x) => x + 1)}
            >
              刷新状态
            </Button>
            <Button
              type="primary"
              icon={<CameraOutlined />}
              onClick={() => setModal("snapshot")}
            >
              冻结新快照
            </Button>
          </Space>
        }
      />
      <Tabs
        items={[
          {
            key: "snapshots",
            label: "阶段快照",
            children: (
              <Card>
                <LoadState loading={loading} error={error}>
                  <Table<any>
                    rowKey="id"
                    dataSource={snapshots}
                    columns={[
                      {
                        title: "快照时间",
                        render: (_: any, r: any) =>
                          new Date(r.as_of).toLocaleString("zh-CN"),
                      },
                      {
                        title: "适用 / 已接受",
                        render: (_: any, r: any) =>
                          `${r.counts.applicable} / ${r.counts.accepted}`,
                      },
                      {
                        title: "未关整改",
                        render: (_: any, r: any) => r.counts.open_issues,
                      },
                      {
                        title: "内容摘要",
                        render: (_: any, r: any) => (
                          <code>{r.manifest_hash.slice(0, 16)}…</code>
                        ),
                      },
                      {
                        title: "操作",
                        render: (_: any, r: any) => (
                          <Space>
                            <Button
                              type="link"
                              onClick={() =>
                                run(async () => {
                                  setTarget(await api(`/snapshots/${r.id}`));
                                  setModal("view");
                                }, "已读取冻结内容")
                              }
                            >
                              查看
                            </Button>
                            <Button
                              type="link"
                              onClick={() => {
                                setTarget(r);
                                setModal("export");
                              }}
                            >
                              申请导出
                            </Button>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </LoadState>
              </Card>
            ),
          },
          {
            key: "approvals",
            label: "审批与导出",
            children: (
              <Card>
                <Alert
                  className="mb16"
                  type="info"
                  title="导出需独立批准，下载时仍检查当前权限"
                />
                <Table<any>
                  rowKey="id"
                  dataSource={approvals || []}
                  columns={[
                    {
                      title: "申请类型",
                      dataIndex: "kind",
                      render: (v) =>
                        (
                          ({
                            export: "目录导出",
                            extension: "整改延期",
                            applicability: "不适用审批",
                          }) as any
                        )[v],
                    },
                    { title: "用途或理由", dataIndex: "reason" },
                    {
                      title: "状态",
                      dataIndex: "state",
                      render: (v) => (
                        <Tag color={v === "approved" ? "green" : "default"}>
                          {
                            (
                              {
                                pending: "待审批",
                                approved: "已批准",
                                rejected: "已退回",
                              } as any
                            )[v]
                          }
                        </Tag>
                      ),
                    },
                    {
                      title: "操作",
                      render: (_: any, r: any) => (
                        <Space>
                          {r.state === "pending" &&
                            r.author_id !== me.user.id &&
                            ctx.roles.includes("cfo") && (
                              <>
                                <Button
                                  type="link"
                                  onClick={() => {
                                    setTarget(r);
                                    setModal("approve");
                                  }}
                                >
                                  审批
                                </Button>
                              </>
                            )}
                          {r.export ? (
                            <Button
                              icon={<DownloadOutlined />}
                              onClick={() => download(r.export.id)}
                            >
                              下载目录包
                            </Button>
                          ) : r.state === "approved" && r.kind === "export" ? (
                            <span className="muted">后台生成中，请刷新</span>
                          ) : null}
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: "metrics",
            label: "效率与工时",
            children: (
              <Card
                title="按同类任务对比人工工时"
                extra={
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => setModal("metric")}
                  >
                    记录工时样本
                  </Button>
                }
              >
                <p className="muted">
                  净收益扣除实际工时和新增维护成本；负值保留，缺少基线时不计算。
                </p>
                <Table
                  rowKey="task_type"
                  dataSource={metrics || []}
                  columns={[
                    { title: "任务类型", dataIndex: "task_type" },
                    { title: "基线样本", dataIndex: "baseline_count" },
                    { title: "实际完成量", dataIndex: "actual_count" },
                    {
                      title: "净节省工时",
                      dataIndex: "net_minutes",
                      render: (v: number | null) =>
                        v === null ? "暂无可计算基线" : `${v.toFixed(1)} 分钟`,
                    },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />
      <Modal
        title={
          modal === "snapshot"
            ? "冻结当前阶段"
            : modal === "export"
              ? "申请目录导出"
              : modal === "approve"
                ? "独立审批"
                : modal === "metric"
                  ? "记录人工工时"
                  : "冻结快照"
        }
        open={!!modal}
        onCancel={() => setModal("")}
        footer={null}
        destroyOnHidden
        width={modal === "view" ? 900 : 560}
      >
        {modal === "view" ? (
          <>
            <Descriptions
              items={[
                {
                  key: "time",
                  label: "截至时间",
                  children: target?.manifest.as_of,
                },
                {
                  key: "hash",
                  label: "内容摘要",
                  children: <code>{target?.manifest_hash}</code>,
                },
              ]}
              column={1}
            />
            <Table
              size="small"
              rowKey="id"
              dataSource={target?.manifest.items}
              columns={[
                { title: "编号", dataIndex: "topic_code" },
                { title: "资料需求", dataIndex: "title" },
                { title: "当时状态", dataIndex: "state" },
                { title: "当时经办", dataIndex: "owner_name" },
              ]}
            />
          </>
        ) : (
          <Form
            layout="vertical"
            onFinish={(v) =>
              run(
                async () => {
                  if (modal === "snapshot")
                    await api(`/projects/${ctx.project.id}/snapshots`, v);
                  if (modal === "export")
                    await api(`/snapshots/${target.id}/export-requests`, v);
                  if (modal === "approve")
                    await api(`/approvals/${target.id}/decisions`, v);
                  if (modal === "metric")
                    await api(`/projects/${ctx.project.id}/metric-samples`, v);
                  setModal("");
                },
                modal === "snapshot" ? "快照已冻结" : "处理已提交",
              )
            }
          >
            {modal === "snapshot" ? (
              <Form.Item
                name="purpose"
                label="快照用途"
                rules={[{ required: true, min: 3 }]}
              >
                <Input.TextArea placeholder="例如：第1周财务准备进度" />
              </Form.Item>
            ) : modal === "metric" ? (
              <>
                <Form.Item
                  name="task_type"
                  label="同类任务名称"
                  rules={[{ required: true }]}
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  name="group"
                  label="样本类别"
                  rules={[{ required: true }]}
                >
                  <Select
                    options={[
                      { value: "baseline", label: "试点前基线工时" },
                      { value: "actual", label: "试点实际工时" },
                      { value: "maintenance", label: "新增维护与复核成本" },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  name="minutes"
                  label="合计人工分钟"
                  rules={[{ required: true }]}
                >
                  <InputNumber min={0} />
                </Form.Item>
                <Form.Item
                  name="count"
                  label="任务完成量"
                  initialValue={1}
                  rules={[{ required: true }]}
                >
                  <InputNumber min={1} />
                </Form.Item>
              </>
            ) : (
              <>
                <Form.Item
                  name="reason"
                  label={modal === "export" ? "用途及范围说明" : "审批理由"}
                  rules={[{ required: true, min: 3 }]}
                >
                  <Input.TextArea />
                </Form.Item>
                {modal === "approve" && (
                  <Form.Item
                    name="approve"
                    label="独立决定"
                    rules={[{ required: true }]}
                  >
                    <Select
                      options={[
                        { value: true, label: "批准" },
                        { value: false, label: "退回" },
                      ]}
                    />
                  </Form.Item>
                )}
              </>
            )}
            <Button type="primary" htmlType="submit" loading={busy}>
              确认提交
            </Button>
          </Form>
        )}
      </Modal>
    </>
  );
}

export function Settings() {
  const { ctx, me, refresh } = useWork();
  const [scopeOpen, setScopeOpen] = useState(false);
  const [modal, setModal] = useState("");
  const [target, setTarget] = useState<any>();
  const [template, setTemplate] = useState<any>();
  const { run, busy } = useAction(refresh);
  const { run: readTemplate } = useAction();
  return (
    <>
      <PageTitle
        title="项目设置"
        subtitle="管理范围、模板和目录准入。范围变动与审批记录保持可追溯。"
      />
      <Tabs
        items={[
          {
            key: "scope",
            label: "项目范围",
            children: (
              <Card
                extra={
                  ctx.roles.includes("cfo") && (
                    <Button onClick={() => setScopeOpen(true)}>
                      更新项目范围
                    </Button>
                  )
                }
              >
                <Descriptions
                  column={2}
                  items={[
                    { key: "n", label: "项目名称", children: ctx.project.name },
                    {
                      key: "e",
                      label: "目标交易所",
                      children:
                        ctx.project.exchange === "unknown"
                          ? "未确定 · 主板通用模板"
                          : ctx.project.exchange,
                    },
                    {
                      key: "v",
                      label: "范围版本",
                      children: `V${ctx.project.scope_version}`,
                    },
                    { key: "m", label: "资料准入", children: "A · 目录模式" },
                  ]}
                />
                <h3>项目主体</h3>
                <Table
                  rowKey="id"
                  dataSource={ctx.organizations}
                  pagination={false}
                  columns={[
                    { title: "主体名称", dataIndex: "name" },
                    {
                      title: "当前范围",
                      dataIndex: "current",
                      render: (v) => (v ? "是" : "历史主体"),
                    },
                  ]}
                />
                <h3>报告期间</h3>
                <Table
                  rowKey="id"
                  dataSource={ctx.periods}
                  pagination={false}
                  columns={[
                    { title: "期间", dataIndex: "label" },
                    { title: "开始", dataIndex: "start" },
                    { title: "结束", dataIndex: "end" },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: "people",
            label: "人员与分工",
            children: (
              <Card
                extra={
                  <Button onClick={() => setModal("member")}>
                    调整人员授权
                  </Button>
                }
              >
                <Table
                  rowKey="id"
                  dataSource={ctx.users}
                  pagination={false}
                  columns={[
                    { title: "人员", dataIndex: "display_name" },
                    {
                      title: "业务角色",
                      dataIndex: "roles",
                      render: (roles) => (
                        <Space>
                          {roles.map((r: string) => (
                            <Tag key={r}>{roleNames[r]}</Tag>
                          ))}
                        </Space>
                      ),
                    },
                    {
                      title: "状态",
                      dataIndex: "active",
                      render: (v) => (v ? "可用" : "已停用"),
                    },
                  ]}
                />
                <Alert
                  className="mt16"
                  type="info"
                  title="兼任角色不会解除同一对象的职责分离要求"
                />
              </Card>
            ),
          },
          {
            key: "templates",
            label: "模板版本",
            children: (
              <Card
                extra={
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() =>
                      run(
                        () => api(`/templates/${ctx.project.id}/versions`, {}),
                        "模板草稿已创建",
                      )
                    }
                  >
                    创建模板草稿
                  </Button>
                }
              >
                <Table
                  rowKey="id"
                  dataSource={ctx.templates}
                  columns={[
                    {
                      title: "版本",
                      dataIndex: "number",
                      render: (n) => `V${n}`,
                    },
                    {
                      title: "状态",
                      dataIndex: "state",
                      render: (v) => (
                        <Tag color={v === "published" ? "green" : "default"}>
                          {v === "published" ? "已发布" : "待独立审核"}
                        </Tag>
                      ),
                    },
                    {
                      title: "操作",
                      render: (_: any, r: any) => (
                        <Space>
                          <Button
                            type="link"
                            onClick={() =>
                              readTemplate(async () => {
                                setTemplate(
                                  await api(`/template-versions/${r.id}`),
                                );
                                setModal("template");
                              }, "已读取模板")
                            }
                          >
                            查看条目
                          </Button>
                          {r.state === "draft" &&
                            r.author_id !== me.user.id &&
                            ctx.roles.includes("cfo") && (
                              <Button
                                type="link"
                                onClick={() => {
                                  setTarget(r);
                                  setModal("publish");
                                }}
                              >
                                独立发布
                              </Button>
                            )}
                        </Space>
                      ),
                    },
                  ]}
                />
                <p className="muted">
                  33项种子是内部准备候选，不等同法定申报文件目录。
                </p>
              </Card>
            ),
          },
          {
            key: "policies",
            label: "目录准入依据",
            children: (
              <Card
                extra={
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => setModal("policy")}
                  >
                    登记准入依据
                  </Button>
                }
              >
                <Table
                  rowKey="id"
                  dataSource={ctx.policies}
                  columns={[
                    { title: "依据编号", dataIndex: "reference" },
                    {
                      title: "有效期",
                      dataIndex: "expires_at",
                      render: (v) => new Date(v).toLocaleDateString("zh-CN"),
                    },
                    {
                      title: "状态",
                      dataIndex: "state",
                      render: (v) => (
                        <Tag color={v === "active" ? "green" : "default"}>
                          {
                            (
                              {
                                active: "有效",
                                pending: "待核验",
                                revoked: "已撤销",
                              } as any
                            )[v]
                          }
                        </Tag>
                      ),
                    },
                    {
                      title: "操作",
                      render: (_: any, r: any) => (
                        <Space>
                          {r.state === "pending" &&
                            r.author_id !== me.user.id &&
                            ctx.roles.includes("cfo") && (
                              <Button
                                type="link"
                                onClick={() => {
                                  setTarget(r);
                                  setModal("verify");
                                }}
                              >
                                核验依据
                              </Button>
                            )}
                          {r.state === "active" &&
                            ctx.roles.includes("cfo") && (
                              <Button
                                danger
                                type="link"
                                onClick={() => {
                                  setTarget(r);
                                  setModal("revoke");
                                }}
                              >
                                撤销准入
                              </Button>
                            )}
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />
      <Modal
        title="更新项目范围"
        open={scopeOpen}
        onCancel={() => setScopeOpen(false)}
        footer={null}
        destroyOnHidden
        width={850}
      >
        <ScopeEditor
          context={ctx}
          onSaved={() => {
            setScopeOpen(false);
            refresh();
          }}
        />
      </Modal>
      <Modal
        title={
          modal === "template"
            ? "模板条目"
            : modal === "member"
              ? "调整授权"
              : modal === "policy"
                ? "登记公司已有准入依据"
                : modal === "publish"
                  ? "独立发布模板"
                  : modal === "revoke"
                    ? "撤销目录准入"
                    : "核验准入依据"
        }
        open={!!modal}
        onCancel={() => setModal("")}
        footer={null}
        destroyOnHidden
        width={modal === "template" ? 950 : 600}
      >
        {modal === "template" ? (
          <TemplateEditor initial={template} />
        ) : (
          <Form
            layout="vertical"
            onFinish={(v) =>
              run(async () => {
                if (modal === "member")
                  await api(`/projects/${ctx.project.id}/memberships`, v);
                if (modal === "policy")
                  await api(`/projects/${ctx.project.id}/admission-policies`, {
                    ...v,
                    expires_at: new Date(
                      v.expires_at + "T23:59:59+08:00",
                    ).toISOString(),
                    allowed_fields: [
                      "document_type",
                      "department",
                      "location_code",
                      "acquisition",
                      "note",
                    ],
                  });
                if (modal === "publish")
                  await api(`/template-versions/${target.id}/publish`, v);
                if (["verify", "revoke"].includes(modal))
                  await api(`/admission-policies/${target.id}/${modal}`, v);
                setModal("");
              })
            }
          >
            {modal === "member" ? (
              <>
                <Form.Item
                  name="user_id"
                  label="人员"
                  rules={[{ required: true }]}
                >
                  <Select
                    options={ctx.users.map((u) => ({
                      value: u.id,
                      label: u.display_name,
                    }))}
                  />
                </Form.Item>
                <Form.Item
                  name="roles"
                  label="角色"
                  rules={[{ required: true }]}
                >
                  <Select
                    mode="multiple"
                    options={Object.entries(roleNames)
                      .filter(
                        ([k]) =>
                          ctx.roles.includes("cfo") ||
                          ["owner", "reviewer"].includes(k),
                      )
                      .map(([value, label]) => ({ value, label }))}
                  />
                </Form.Item>
                <Form.Item
                  name="org_ids"
                  label="主体范围"
                  rules={[{ required: true }]}
                >
                  <Select
                    mode="multiple"
                    options={ctx.organizations.map((o) => ({
                      value: o.id,
                      label: o.name,
                    }))}
                  />
                </Form.Item>
              </>
            ) : modal === "policy" ? (
              <>
                <Alert
                  className="mb16"
                  type="info"
                  title="本操作仅登记已完成的公司批准，不在系统内认定保密等级。"
                />
                <Form.Item
                  name="reference"
                  label="公司批准依据编号"
                  rules={[{ required: true, min: 3 }]}
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  name="org_id"
                  label="主体"
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
                  name="expires_at"
                  label="有效期至"
                  rules={[{ required: true }]}
                >
                  <Input type="date" />
                </Form.Item>
                <p className="muted">
                  本期字段：资料类型、保管部门、位置代号、取得状态、获准目录说明。
                </p>
              </>
            ) : (
              <>
                <Form.Item
                  name="reason"
                  label="处理依据及理由"
                  rules={[{ required: true, min: 3 }]}
                >
                  <Input.TextArea />
                </Form.Item>
                {modal === "revoke" && (
                  <Alert
                    className="mb16"
                    type="warning"
                    title="撤销后相关目录和导出将立即失去当前访问许可，已接受统计会重新计算。"
                  />
                )}
              </>
            )}
            <Button type="primary" htmlType="submit" loading={busy}>
              确认提交
            </Button>
          </Form>
        )}
      </Modal>
    </>
  );
}

export function AuditPage() {
  const { ctx } = useWork();
  const { data, loading, error } = useData(`/projects/${ctx.project.id}/audit`);
  return (
    <>
      <PageTitle
        title="审计记录"
        subtitle="查看最近100次项目操作。审计仅追加，业务账号不能修改或删除。"
      />
      <Card>
        <LoadState loading={loading} error={error}>
          <Table
            rowKey="id"
            dataSource={data}
            columns={[
              {
                title: "时间",
                dataIndex: "created_at",
                render: (v) => new Date(v).toLocaleString("zh-CN"),
              },
              { title: "动作", dataIndex: "action" },
              {
                title: "对象编号",
                dataIndex: "object_id",
                render: (v) => <code>{v.slice(0, 12)}</code>,
              },
              {
                title: "结果",
                dataIndex: "result",
                render: (v) => (
                  <Tag color={v === "success" ? "green" : "orange"}>
                    {v === "success" ? "成功" : "拒绝"}
                  </Tag>
                ),
              },
              {
                title: "追踪号",
                dataIndex: "trace_id",
                render: (v) => <code>{v.slice(0, 12)}</code>,
              },
            ]}
          />
        </LoadState>
      </Card>
    </>
  );
}
