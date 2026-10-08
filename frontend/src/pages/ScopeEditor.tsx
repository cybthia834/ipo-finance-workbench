import { Alert, Button, Form, Input, Select, Space } from "antd";
import { api } from "../api";
import { useAction, useData } from "../shared";

export function ScopeEditor({
  context,
  onSaved,
}: {
  context?: any;
  onSaved: () => void;
}) {
  const { run, busy } = useAction();
  const { data: accounts } = useData<any[]>(context ? null : "/users");
  const initial = context
    ? {
        name: context.project.name,
        exchange: context.project.exchange,
        organizations: context.organizations
          .filter((o: any) => o.current)
          .map(({ code, name }: any) => ({ code, name })),
        periods: context.periods
          .filter((p: any) => p.current)
          .map(({ label, start, end }: any) => ({ label, start, end })),
      }
    : { exchange: "unknown", organizations: [{}], periods: [{}] };
  return (
    <Form
      layout="vertical"
      initialValues={initial}
      onFinish={(value) =>
        run(
          async () => {
            await api(
              context
                ? `/projects/${context.project.id}/scope-versions`
                : "/projects",
              value,
            );
            onSaved();
          },
          context ? "新范围已保存，请预检生成新增清单" : "项目已创建",
        )
      }
    >
      {context && (
        <Alert
          className="mb16"
          type="info"
          title="移出当前范围的主体与期间仍保留历史记录。新增主体还需分配人员权限和目录准入。"
        />
      )}
      <Form.Item name="name" label="项目名称" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item
        name="exchange"
        label="目标交易所"
        rules={[{ required: true }]}
      >
        <Select
          options={[
            { value: "unknown", label: "未确定" },
            { value: "sse", label: "上交所主板" },
            { value: "szse", label: "深交所主板" },
          ]}
        />
      </Form.Item>
      {!context && (
        <Form.Item
          name="initial_cfo_id"
          label="项目财务负责人"
          rules={[{ required: true }]}
        >
          <Select
            options={accounts
              ?.filter((u) => u.active)
              .map((u) => ({ value: u.id, label: u.display_name }))}
          />
        </Form.Item>
      )}
      <h3>项目主体</h3>
      <Form.List
        name="organizations"
        rules={[
          {
            validator: async (_, value) => {
              if (!value?.length) throw new Error("至少保留一个主体");
            },
          },
        ]}
      >
        {(fields, { add, remove }, { errors }) => (
          <>
            {fields.map((field) => (
              <Space key={field.key} align="start">
                <Form.Item
                  name={[field.name, "code"]}
                  label="稳定主体代号"
                  rules={[{ required: true }]}
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  name={[field.name, "name"]}
                  label="主体名称"
                  rules={[{ required: true }]}
                >
                  <Input />
                </Form.Item>
                <Button type="text" onClick={() => remove(field.name)}>
                  移出范围
                </Button>
              </Space>
            ))}
            <Button onClick={() => add()}>添加主体</Button>
            <Form.ErrorList errors={errors} />
          </>
        )}
      </Form.List>
      <h3>报告期间</h3>
      <Form.List
        name="periods"
        rules={[
          {
            validator: async (_, value) => {
              if (!value?.length) throw new Error("至少保留一个期间");
            },
          },
        ]}
      >
        {(fields, { add, remove }, { errors }) => (
          <>
            {fields.map((field) => (
              <div key={field.key} className="form-grid">
                <Form.Item
                  name={[field.name, "label"]}
                  label="期间名称"
                  rules={[{ required: true }]}
                >
                  <Input />
                </Form.Item>
                <Space>
                  <Form.Item
                    name={[field.name, "start"]}
                    label="开始日期"
                    rules={[{ required: true }]}
                  >
                    <Input type="date" />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "end"]}
                    label="结束日期"
                    rules={[{ required: true }]}
                  >
                    <Input type="date" />
                  </Form.Item>
                  <Button type="text" onClick={() => remove(field.name)}>
                    移出
                  </Button>
                </Space>
              </div>
            ))}
            <Button onClick={() => add()}>添加期间</Button>
            <Form.ErrorList errors={errors} />
          </>
        )}
      </Form.List>
      <div className="mt16">
        <Button type="primary" htmlType="submit" loading={busy}>
          保存项目范围
        </Button>
      </div>
    </Form>
  );
}
