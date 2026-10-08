import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";

const credentials: Record<string, string> = JSON.parse(
  readFileSync(".runtime/phase1/demo-credentials.json", "utf8"),
);
mkdirSync(".runtime/frontend-phase2", { recursive: true });

async function login(page: Page, role = "pmo") {
  await page.goto("/");
  await page.getByPlaceholder("请输入独立账号").fill(role);
  await page
    .getByPlaceholder("请输入密码", { exact: true })
    .fill(credentials[role]);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(
    page.getByRole("heading", { name: "财务工作首页", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".metric")).toHaveCount(6);
  return new URL(page.url()).pathname.replace(/\/dashboard$/, "");
}
async function settled(page: Page) {
  await expect(page.locator(".page-title h1")).toBeVisible();
  await expect(page.locator(".loading")).toHaveCount(0);
  await expect(page.getByText("暂时无法读取", { exact: true })).toHaveCount(0);
}
async function noOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
}

for (const [width, height] of [
  [1440, 1050],
  [1280, 800],
  [768, 1024],
  [390, 844],
]) {
  test(`real pages fit ${width}px with usable navigation and dialogs`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const base = await login(page);
    await settled(page);
    await expect(page.locator(".ant-message-notice")).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({
      path: `.runtime/frontend-phase2/dashboard-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    if (width <= 900) {
      await page.getByRole("button", { name: "打开导航" }).click();
      await expect(
        page.getByRole("button", { name: "关闭导航" }),
      ).toBeVisible();
      await page
        .locator("nav")
        .getByRole("link", { name: "财务清单", exact: true })
        .click();
      await expect(page.locator(".ant-drawer-body")).toHaveCount(0);
    } else
      await page
        .locator("nav")
        .getByRole("link", { name: "财务清单", exact: true })
        .click();
    await expect(
      page.getByRole("heading", { name: "财务资料清单", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".item-title").first()).toBeVisible();
    await settled(page);
    await noOverflow(page);
    if (width <= 768) {
      const moved = await page
        .locator(".ant-table-content")
        .first()
        .evaluate((element) => {
          element.scrollLeft = 200;
          const distance = element.scrollLeft;
          element.scrollLeft = 0;
          return distance;
        });
      expect(moved).toBeGreaterThan(0);
    }
    await page.screenshot({
      path: `.runtime/frontend-phase2/checklists-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.locator(".item-title").first().click();
    await expect(
      page.getByRole("link", { name: "← 返回资料清单" }),
    ).toBeVisible();
    await settled(page);
    await noOverflow(page);
    await page.screenshot({
      path: `.runtime/frontend-phase2/detail-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.goto(`${base}/evidence`);
    await settled(page);
    await noOverflow(page);
    await page.getByRole("button", { name: "登记目录", exact: true }).click();
    await expect(
      page.getByLabel("获准目录代号", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".ant-modal")).not.toHaveClass(
      /zoom-enter|zoom-appear/,
    );
    await noOverflow(page);
    const dialog = await page.getByRole("dialog").boundingBox();
    expect(dialog!.x).toBeGreaterThanOrEqual(0);
    expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `.runtime/frontend-phase2/register-${width}.png`,
      animations: "disabled",
    });
    const saveButton = page.getByRole("button", {
      name: "保存目录",
      exact: true,
    });
    await saveButton.scrollIntoViewIfNeeded();
    const saveBounds = await saveButton.boundingBox();
    expect(saveBounds!.y).toBeGreaterThanOrEqual(0);
    expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(height);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "登记目录", exact: true }),
    ).toBeFocused();
    for (const path of ["issues", "reports", "settings", "audit"]) {
      await page.goto(`${base}/${path}`);
      await settled(page);
      await noOverflow(page);
    }
    expect(errors).toEqual([]);
  });
}

test("filters, detail return, saved view and clear remain consistent", async ({
  page,
}) => {
  const base = await login(page);
  await page.goto(
    `${base}/checklists?domain=FIN&page_size=20&unexpected=ignored`,
  );
  await settled(page);
  const count = await page.locator(".filter-count").innerText();
  await page.locator(".item-title").first().click();
  await page.getByRole("tab", { name: /复核历史/ }).click();
  await page.reload();
  await expect(page.getByRole("tab", { name: /复核历史/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("link", { name: "← 返回资料清单" }).click();
  await expect(page).toHaveURL(/domain=FIN/);
  await expect(page.locator(".filter-count")).toHaveText(count);
  const name = `虚构视图-${Date.now()}`;
  await page.getByRole("button", { name: "另存个人视图" }).click();
  await page.getByLabel("视图名称").fill(name);
  await page.getByRole("button", { name: "保存个人视图", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "清空筛选" }).click();
  await expect(page.getByPlaceholder("搜索主题编号或资料需求")).toHaveValue("");
  await page.getByRole("combobox", { name: "个人视图" }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText(name, { exact: true })
    .click();
  await expect(page).toHaveURL(/domain=FIN/);
  await page.reload();
  await expect(page.locator(".filter-count")).toHaveText(count);
});

test("generation survives refresh and one confirmation submits one job", async ({
  page,
}) => {
  const base = await login(page);
  await page.goto(`${base}/checklists`);
  await settled(page);
  let submitted = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/checklist-jobs")
    )
      submitted++;
  });
  await page.getByRole("button", { name: "生成清单", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "确认生成", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page).toHaveURL(/job_id=/);
  const id = new URL(page.url()).searchParams.get("job_id");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "清单生成任务" }),
  ).toBeVisible();
  await expect(page.getByText("生成完成", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  expect(new URL(page.url()).searchParams.get("job_id")).toBe(id);
  expect(submitted).toBe(1);
  await page.getByRole("button", { name: "关闭面板" }).click();
  await expect(page).not.toHaveURL(/job_id=/);
});

test("a lost generation response retries the original operation without a duplicate job", async ({
  page,
}) => {
  const base = await login(page);
  await page.goto(`${base}/checklists`);
  await settled(page);
  let committedId = "";
  const keys: string[] = [];
  await page.route("**/api/v1/projects/*/checklist-jobs", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (!committedId) {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      committedId = (await response.json()).data.id;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "生成清单", exact: true }).click();
  await page.getByRole("button", { name: "确认生成", exact: true }).click();
  await expect(
    page.getByText(/连接中断或等待超时，结果尚未确认/),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认生成", exact: true }),
  ).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "确认生成", exact: true }).click();
  await expect(page).toHaveURL(/job_id=/);
  expect(new URL(page.url()).searchParams.get("job_id")).toBe(committedId);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
});

test("session service failure stays retryable instead of pretending logged out", async ({
  page,
}) => {
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "STORAGE_UNAVAILABLE", message: "测试服务暂不可用" },
        trace_id: "fictional-trace",
      }),
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "暂时无法确认登录状态" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "进入工作台" })).toHaveCount(0);
  await page.unroute("**/api/v1/me");
  await page.getByRole("button", { name: "重新读取" }).click();
  await expect(page.getByRole("button", { name: "进入工作台" })).toBeVisible();
});

test("failed checklist and report panels never become successful empty tables", async ({
  page,
}) => {
  const base = await login(page);
  await page.route("**/api/v1/projects/*/checklists?*", (route) =>
    route.fulfill({
      status: 502,
      contentType: "text/html",
      body: "<h1>Fictional gateway failure</h1>",
    }),
  );
  await page.goto(`${base}/checklists`);
  await expect(
    page.getByText("服务返回格式异常，请重试或联系管理员。"),
  ).toBeVisible();
  await expect(page.locator(".filter-count")).not.toContainText("0 项");
  await page.unroute("**/api/v1/projects/*/checklists?*");
  await page.getByRole("button", { name: "重新读取" }).click();
  await settled(page);
  await page.route("**/api/v1/projects/*/metrics", (route) =>
    route.abort("failed"),
  );
  await page.goto(`${base}/reports`);
  await page.getByRole("tab", { name: "效率与工时" }).click();
  await expect(page.getByText("暂时无法读取", { exact: true })).toBeVisible();
  await page.unroute("**/api/v1/projects/*/metrics");
  await page.getByRole("button", { name: "重新读取" }).click();
  await settled(page);
});

test("period dashboard drilldown preserves the same underlying issue count", async ({
  page,
}) => {
  const base = await login(page);
  const pid = base.split("/").pop();
  const ctx = (
    await (await page.request.get(`/api/v1/projects/${pid}/context`)).json()
  ).data;
  const period = ctx.periods[0];
  await page.getByRole("combobox", { name: "首页期间" }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText(period.label, { exact: true })
    .click();
  await settled(page);
  const card = page.getByRole("button").filter({ hasText: "未关闭整改" });
  const count = Number(
    (await card.locator("strong").innerText()).replace(/\D/g, ""),
  );
  await card.click();
  await expect(page).toHaveURL(new RegExp(`period_id=${period.id}`));
  const data = (
    await (
      await page.request.get(
        `/api/v1/projects/${pid}/issues?state=open&period_id=${period.id}`,
      )
    ).json()
  ).data;
  expect(data.total).toBe(count);
  await expect(page.locator(".ant-table-tbody tr[data-row-key]")).toHaveCount(
    Math.min(count, 20),
  );
});
