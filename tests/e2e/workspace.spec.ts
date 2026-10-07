import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const credentials = JSON.parse(
  readFileSync(".runtime/demo-credentials.json", "utf8"),
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

test("PMO navigates real business pages; all runtime requests stay local", async ({
  page,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith("http://127.0.0.1:5173/")
    )
      external.push(request.url());
  });
  await login(page, "pmo");
  await expect(page.locator(".metric").first()).toContainText("适用资料项");
  await page.screenshot({
    path: ".runtime/dashboard-preview.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button").filter({ hasText: "有效已接受" }).click();
  await expect(page).toHaveURL(/state=accepted.*applicability=applicable/);
  await expect(page.locator(".list-toolbar")).toContainText("4 项资料需求");
  for (const [nav, title] of [
    ["资料目录", "资料目录"],
    ["整改台账", "整改台账"],
    ["报表与快照", "报表与阶段快照"],
    ["项目设置", "项目设置"],
    ["审计记录", "审计记录"],
  ]) {
    await page.locator("nav").getByRole("link", { name: nav }).click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText("暂时无法读取", { exact: true })).toHaveCount(
      0,
    );
  }
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("owner sees assigned tasks and cannot open management data", async ({
  page,
}) => {
  await login(page, "owner");
  await expect(
    page.locator("nav").getByRole("link", { name: "项目设置" }),
  ).toHaveCount(0);
  await page.locator("nav").getByRole("link", { name: "财务清单" }).click();
  await expect(page.locator(".list-toolbar")).toContainText("10 项资料需求");
  const base = new URL(page.url()).pathname.replace(/\/checklists$/, "");
  await page.goto(base + "/reports");
  await expect(page.getByText("当前角色不能执行此操作")).toBeVisible();
});

test("PMO creates a frozen snapshot through the visible form", async ({
  page,
}) => {
  await login(page, "pmo");
  await page.locator("nav").getByRole("link", { name: "报表与快照" }).click();
  await page.getByRole("button", { name: "冻结新快照" }).click();
  await page.getByLabel("快照用途").fill("浏览器验收专用虚构快照");
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByText("快照已冻结", { exact: true })).toBeVisible();
  await expect(page.locator(".ant-modal")).toHaveCount(0);
  await page.getByRole("button", { name: "查看", exact: true }).first().click();
  await expect(page.getByText("冻结快照", { exact: true })).toBeVisible();
  await expect(page.getByText("当时状态", { exact: true })).toBeVisible();
});

test("CFO can inspect scope form and published template safely", async ({
  page,
}) => {
  await login(page, "cfo");
  await page.locator("nav").getByRole("link", { name: "项目设置" }).click();
  await page.getByRole("button", { name: "更新项目范围" }).click();
  await expect(page.getByLabel("项目名称")).toHaveValue(
    "精工制造 · 上市准备演示",
  );
  await page.locator("button.ant-modal-close").click();
  await page.getByRole("tab", { name: "模板版本" }).click();
  await page.getByRole("button", { name: "查看条目" }).first().click();
  await expect(page.getByRole("tab", { name: "模板条目 (33)" })).toBeVisible();
  await expect(
    page.getByText("固定版本", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator('.ant-modal')).toHaveCSS('opacity', '1');
  await page.screenshot({
    path: ".runtime/template-preview.png",
    fullPage: true,
    animations: "disabled",
  });
});
