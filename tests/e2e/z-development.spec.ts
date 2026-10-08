import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const credentials = JSON.parse(
  readFileSync(".runtime/phase1/demo-credentials.json", "utf8"),
);

async function login(page: Page, role: string) {
  await page.goto("/");
  await page.getByPlaceholder("请输入独立账号").fill(role);
  await page
    .getByPlaceholder("请输入密码", { exact: true })
    .fill(credentials[role]);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(
    page.getByRole("heading", { name: "财务工作首页" }),
  ).toBeVisible();
}
async function switchUser(page: Page, role: string) {
  await page.getByRole("button", { name: "退出登录" }).click();
  await login(page, role);
}
async function choose(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option-content")
    .filter({ hasText: value })
    .first()
    .click();
}

test("directory registration, independent review and version invalidation through actual forms", async ({
  page,
}) => {
  test.setTimeout(60000);
  await login(page, "pmo");
  const me = await (await page.request.get("/api/v1/me")).json();
  const pid = me.data.projects[0].id;
  const ctx = (
    await (await page.request.get(`/api/v1/projects/${pid}/context`)).json()
  ).data;
  const items = (
    await (
      await page.request.get(`/api/v1/projects/${pid}/checklists?page_size=100`)
    ).json()
  ).data.items;
  const item = items.find(
    (i: any) => i.owner_id && i.workflow_state === "collecting",
  );
  expect(item).toBeTruthy();
  const code = `E2E-${Date.now()}`;
  await switchUser(page, "owner");
  await page.locator("nav").getByRole("link", { name: "资料目录" }).click();
  await page.getByRole("button", { name: "登记目录", exact: true }).click();
  await page.getByLabel("获准目录代号", { exact: true }).fill(code);
  await choose(page, "所属主体", item.org_name);
  await choose(page, "覆盖期间", item.period_label);
  const policy = ctx.policies.find(
    (p: any) => p.org_id === item.org_id && p.state === "active",
  );
  await choose(page, "有效目录准入依据", policy.reference);
  await page.getByLabel("资料类型", { exact: true }).fill("浏览器虚构目录");
  await page.getByLabel("保管部门", { exact: true }).fill("测试财务部");
  await page.getByLabel("获准位置代号", { exact: true }).fill("E2E-ARCHIVE");
  await page
    .getByLabel("登记原因", { exact: true })
    .fill("浏览器完整流程虚构样本");
  await page.getByRole("button", { name: "保存目录", exact: true }).click();
  await expect(page.locator(".ant-modal")).toHaveCount(0);
  await page.goto(`/projects/${pid}/checklists/${item.id}`);
  await page.getByRole("button", { name: "关联目录", exact: true }).click();
  await choose(page, "当前有效目录", code);
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.locator(".ant-modal")).toHaveCount(0);
  await page.getByRole("button", { name: "提交复核", exact: true }).click();
  await expect(page.getByText("已提交独立复核", { exact: true })).toBeVisible();
  await switchUser(page, "reviewer");
  await page.goto(`/projects/${pid}/checklists/${item.id}`);
  await page.getByRole("button", { name: "开始独立复核", exact: true }).click();
  await choose(page, "复核决定", "接受");
  for (const box of await page
    .locator(".ant-modal")
    .getByRole("checkbox")
    .all())
    await box.check();
  await page
    .getByLabel("结论及具体补充动作", { exact: true })
    .fill("逐项核查虚构目录，符合本项验收要求");
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.locator(".ant-modal")).toHaveCount(0);
  await expect(page.getByText("已接受", { exact: true })).toBeVisible();
  await switchUser(page, "owner");
  const list = (
    await (
      await page.request.get(`/api/v1/projects/${pid}/evidence?q=${code}`)
    ).json()
  ).data.items;
  await page.goto(`/projects/${pid}/evidence/${list[0].id}`);
  await page.getByRole("button", { name: "提交新版本", exact: true }).click();
  await page
    .getByLabel("替换原因", { exact: true })
    .fill("浏览器验证换版触发重新复核");
  await page
    .locator(".ant-modal")
    .getByRole("button", { name: "提交新版本", exact: true })
    .click();
  await expect(page.locator(".ant-modal")).toHaveCount(0);
  await page.goto(`/projects/${pid}/checklists/${item.id}`);
  await expect(page.getByText("待重新复核", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "复核历史 (1)" }).click();
  await expect(
    page.getByText("逐项核查虚构目录，符合本项验收要求", { exact: true }),
  ).toBeVisible();
});

test("IT can reach account administration without a finance project", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByPlaceholder("请输入独立账号").fill("it");
  await page
    .getByPlaceholder("请输入密码", { exact: true })
    .fill(credentials.it);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.getByRole("heading", { name: "账号管理" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "创建独立账号" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "创建独立账号" }).click();
  await expect(page.getByLabel("唯一人员编号")).toBeVisible();
  await expect(page.getByLabel("临时密码")).toHaveAttribute("type", "password");
  await page.locator("button.ant-modal-close").click();
  expect(await page.locator("nav").count()).toBe(0);
});
