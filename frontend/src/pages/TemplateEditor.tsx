import { useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from "antd";
import { api, domainNames } from "../api";
import { useWork } from "../App";
import { useAction } from "../shared";

export function TemplateEditor({ initial }: { initial: any }) {
  const { me } = useWork();
  const [template, setTemplate] = useState(initial);
  const [editing, setEditing] = useState<any>();
  const { run, busy } = useAction();
  const editable =
    template.version.state === "draft" &&
    template.version.author_id === me.user.id;
  return (
    <>
      <Alert
        className="mb16"
        type="info"
        title="新模板不会覆盖已有清单与历史复核。条目差异需独立审核后发布。"
      />
      {editable && (
        <Button className="mb16" onClick={() => setEditing({})}>
          新增内部准备条目
        </Button>
      )}
      <Tabs
        items={[
          {
            key: "items",
            label: `模板条目 (${template.items.length})`,
            children: (
              <Table<any>
                rowKey="id"
                dataSource={template.items}
                columns={[
                  { title: "编号", dataIndex: "code", width: 95 },
                  { title: "资料需求", dataIndex: "title" },
                  { title: "最小验收标准", dataIndex: "standard" },
                  {
                    title: "操作",
                    render: (_, row) =>
                      editable ? (
                        <Button type="link" onClick={() => setEditing(row)}>
                          编辑草稿
                        </Button>
                      ) : (
                        <Tag>固定版本</Tag>
                      ),
                  },
                ]}
              />
            ),
          },
          {
            key: "diff",
            label: `相对上版差异 (${template.changes.length})`,
            children: (
              <Table<any>
                rowKey="code"
                dataSource={template.changes}
                columns={[
                  { title: "编号", dataIndex: "code" },
                  {
                    title: "变化",
                    dataIndex: "kind",
                    render: (value) => (value === "added" ? "新增" : "修改"),
                  },
                  {
                    title: "变化前",
                    render: (_, r) =>
                      r.before
                        ? `${r.before.title}；${r.before.standard}`
                        : "—",
                  },
                  {
                    title: "变化后",
                    render: (_, r) => `${r.after.title}；${r.after.standard}`,
                  },
                ]}
              />
            ),
          },
        ]}
      />
      <Modal
        title={editing?.id ? "编辑模板草稿条目" : "新增模板条目"}
        open={!!editing}
        onCancel={() => setEditing(undefined)}
        footer={null}
        destroyOnHidden
      >
        {editing && (
          <Form
            key={editing.id || "new"}
            layout="vertical"
            initialValues={{
              ...editing,
              checks_text: editing.checks?.join("\n"),
            }}
            onFinish={(value) =>
              run(async () => {
                const { checks_text, ...fields } = value;
                const body = {
                  ...fields,
                  checks: checks_text
                    .split("\n")
                    .map((x: string) => x.trim())
                    .filter(Boolean),
                };
                if (editing.id)
                  await api(
                    `/template-items/${editing.id}`,
                    { ...body, expected_hash: editing.edit_hash },
                    "PATCH",
                  );
                else
                  await api(
                    `/template-versions/${template.version.id}/items`,
                    body,
                  );
                setTemplate(
                  await api(`/template-versions/${template.version.id}`),
                );
                setEditing(undefined);
              }, "草稿已保存，等待独立发布")
            }
          >
            <Space align="start">
              <Form.Item
                name="code"
                label="稳定主题编号"
                rules={[{ required: true, pattern: /^[A-Z]{2,8}-[0-9]{2,4}$/ }]}
              >
                <Input disabled={!!editing.id} placeholder="例如 FIN-99" />
              </Form.Item>
              <Form.Item
                name="domain"
                label="领域"
                rules={[{ required: true }]}
              >
                <Select
                  style={{ width: 180 }}
                  options={Object.entries(domainNames).map(
                    ([value, label]) => ({ value, label }),
                  )}
                />
              </Form.Item>
            </Space>
            <Form.Item
              name="title"
              label="资料需求"
              rules={[{ required: true, min: 3 }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="source"
              label="内部准备依据或来源"
              rules={[{ required: true, min: 3 }]}
            >
              <Input.TextArea />
            </Form.Item>
            <Form.Item
              name="standard"
              label="可执行的最小验收标准"
              rules={[{ required: true, min: 3 }]}
            >
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item
              name="checks_text"
              label="检查点（每行一项）"
              rules={[{ required: true }]}
            >
              <Input.TextArea rows={4} />
            </Form.Item>
            <Button htmlType="submit" type="primary" loading={busy}>
              保存草稿
            </Button>
          </Form>
        )}
      </Modal>
    </>
  );
}
