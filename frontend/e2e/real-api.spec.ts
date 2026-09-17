import { expect, test } from "@playwright/test";

test("真实代理链路展示 FastAPI 回答和教材引用", async ({ page }) => {
  await page.goto("/qa");

  await expect(page.getByText("真实接口模式")).toBeVisible();
  await page.getByRole("button", { name: "提交问题" }).click();

  await expect(page.getByRole("heading", { name: "回答" })).toBeVisible();
  await expect(page.getByText("具身智能强调身体、环境与认知之间的相互作用。")).toBeVisible();
  await expect(
    page.getByText("chunk_id: book_embodied_ai_intro_2024:1.1:chunk-001"),
  ).toBeVisible();
  await expect(page.getByLabel("请求诊断")).toContainText("请求完成");
});

test("真实 FastAPI 校验错误经 Next 代理保持 422", async ({ request }) => {
  const response = await request.post("/backend/api/qa", {
    data: { question: "", history: [], max_citations: 3 },
  });

  expect(response.status()).toBe(422);
  const body = await response.json();
  expect(Array.isArray(body.detail)).toBe(true);
});

test("真实 FastAPI 依赖错误经页面显示为 503", async ({ page }) => {
  await page.goto("/qa");
  await page.getByLabel("你的问题").fill("触发服务故障");
  await page.getByRole("button", { name: "提交问题" }).click();

  await expect(page.locator("main [role=alert]")).toContainText("HTTP 503");
  await expect(page.getByLabel("请求诊断")).toContainText("HTTP 错误");
});
