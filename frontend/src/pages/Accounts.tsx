import { useState } from "react";
import { Alert, Button, Form, Input, Modal, Space, Table, Tag } from "antd";
import { api } from "../api";
import { LoadState, useAction, useData } from "../shared";

type Account = {
  id: string;
  username: string;
  display_name: string;
  person_id: string;
  active: boolean;
  identity_admin: boolean;
  must_change_password: boolean;
  row_version: number;
};

export function Accounts({ currentUserId }: { currentUserId: string }) {
  const [revision, setRevision] = useState(0);
  const { data, loading, error } = useData<Account[]>("/users", revision);
  const { run, busy } = useAction(() => setRevision((v) => v + 1));
  const [action, setAction] = useState<
    "create" | "status" | "password-reset" | ""
  >("");
  const [selected, setSelected] = useState<Account>();
  return (
    <>
      <h2>账号管理</h2>
      <Alert
        className="mb16"
        type="info"
        showIcon
        title="账号与财务授权分别管理"
        description="最多 10 个活动账号。新账号需要首次改密，再由财务负责人授权项目和主体。停用或重置密码会撤销该账号全部会话。"
      />
      <Button
        type="primary"
        onClick={() => {
          setSelected(undefined);
          setAction("create");
        }}
      >
        创建独立账号
      </Button>
      <LoadState loading={loading} error={error}>
        <Table<Account>
          rowKey="id"
          dataSource={data}
          pagination={false}
          columns={[
            { title: "账号", dataIndex: "username" },
            { title: "姓名", dataIndex: "display_name" },
            { title: "人员编号", dataIndex: "person_id" },
            {
              title: "状态",
              render: (_, u) => (
                <Space>
                  <Tag color={u.active ? "green" : "default"}>
                    {u.active ? "活动" : "停用"}
                  </Tag>
                  {u.must_change_password && <Tag>待首次改密</Tag>}
                </Space>
              ),
            },
            {
              title: "操作",
              render: (_, u) =>
                u.id === currentUserId ? (
                  "当前账号"
                ) : (
                  <Space>
                    <Button
                      onClick={() => {
                        setSelected(u);
                        setAction("status");
                      }}
                    >
                      {u.active ? "停用" : "启用"}
                    </Button>
                    <Button
                      onClick={() => {
                        setSelected(u);
                        setAction("password-reset");
                      }}
                    >
                      重置密码
                    </Button>
                  </Space>
                ),
            },
          ]}
        />
      </LoadState>
      <Modal
        open={!!action}
        title={
          action === "create"
            ? "创建账号"
            : action === "status"
              ? `${selected?.active ? "停用" : "启用"} ${selected?.username}`
              : `重置 ${selected?.username} 的密码`
        }
        onCancel={() => setAction("")}
        footer={null}
        destroyOnHidden
      >
        <Form
          key={`${action}-${selected?.id}`}
          layout="vertical"
          onFinish={(values) =>
            run(async () => {
              if (action === "create") await api("/users", values);
              else
                await api(`/users/${selected!.id}/${action}`, {
                  ...values,
                  expected_version: selected!.row_version,
                  ...(action === "status" ? { active: !selected!.active } : {}),
                });
              setAction("");
            }, "账号已更新")
          }
        >
          {action === "create" && (
            <>
              <Form.Item
                name="username"
                label="登录账号"
                rules={[{ required: true, pattern: /^[a-zA-Z0-9_.-]{3,60}$/ }]}
              >
                <Input autoComplete="off" />
              </Form.Item>
              <Form.Item
                name="display_name"
                label="姓名"
                rules={[{ required: true, max: 80 }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="person_id"
                label="唯一人员编号"
                rules={[{ required: true, max: 36 }]}
              >
                <Input placeholder="同一人员使用同一编号" />
              </Form.Item>
            </>
          )}
          {action !== "status" && (
            <Form.Item
              name={action === "create" ? "password" : "new_password"}
              label="临时密码"
              rules={[{ required: true, min: 12, max: 200 }]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          )}
          {action !== "create" && (
            <Form.Item
              name="reason"
              label="变更原因"
              rules={[{ required: true, min: 3, max: 500 }]}
            >
              <Input.TextArea />
            </Form.Item>
          )}
          <Button type="primary" htmlType="submit" loading={busy}>
            保存账号变更
          </Button>
        </Form>
      </Modal>
    </>
  );
}
