// R1 返工补充：验收缺口「缺/错 X-Base-Control-Token 的 HTTP 层字面负例」。
// 在真实浏览器（同源 cookie 会话 + x-csrf-token）里直发 POST /base/resource-nodes/:id/survey：
// 缺租约头 / 错租约头 → 409 CONTROL_EXPIRED 且无副作用；带有效租约 → 正常受理（阳性对照）。
// PG 侧等价覆盖见 landing-fix.integration #5；本用例补 HTTP 字面路径。
import { expect, test } from "@playwright/test";

const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
const email = `r1-neg-${runId}@example.test`;
const password = "r1-neg-password";

interface SnapshotShape {
  resourceNodes?: Array<{ nodeId: string; nodeKey: string }>;
  devices?: Array<{ operatorId: string; groupId: string }>;
  extractionJobs?: unknown[];
  controlLease?: { controlToken: string | null } | null;
}

test("控制租约 HTTP 负例：缺/错 X-Base-Control-Token 拒绝且无副作用，有效租约受理", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    // 与 landing-loop 相同披露：只补齐「窗口在前台」事实，让 UI 心跳正常获取租约；
    // 租约校验本身走服务端真实路径。
    Object.defineProperty(Document.prototype, "hasFocus", { value: () => true });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  const registerResponse = page.waitForResponse(
    (response) => response.url().includes("/base/playtest-register") && response.status() >= 200 && response.status() < 300
  );
  await page.goto("/");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "领取试玩基地" }).click();
  const register = (await (await registerResponse).json()) as { csrfToken: string; baseId: string };
  await expect(page.getByRole("region", { name: "当前目标" })).toContainText("安装首座太阳能");

  // API 在独立端口（VITE_API_BASE）；从 UI 自己的快照轮询响应取真实 origin，
  // 之后页面内 fetch 走与产品前端完全相同的跨端口 HTTP/CORS 通道。
  const snapshotResponse = page.waitForResponse(
    (response) => response.url().includes("/base/snapshot") && response.status() === 200
  );
  await page.bringToFront();
  const api = await page.evaluate(async ({ csrf, snapshotUrl }) => {
    const response = await fetch(snapshotUrl, {
      method: "GET",
      credentials: "include",
      headers: { "x-csrf-token": csrf }
    });
    const snapshot = (await response.json()) as SnapshotShape;
    return {
      apiOrigin: new URL(snapshotUrl).origin,
      nodeId: snapshot.resourceNodes?.find((node) => node.nodeKey === "iron_north")?.nodeId,
      surveyorId: snapshot.devices?.find((device) => device.groupId === "survey")?.operatorId,
      controlToken: snapshot.controlLease?.controlToken ?? null
    };
  }, { csrf: register.csrfToken, snapshotUrl: (await snapshotResponse).url() });
  expect(api.nodeId, "快照应含铁节点").toBeTruthy();
  expect(api.surveyorId, "快照应含望山操作员").toBeTruthy();
  expect(api.controlToken, "前台心跳应已取得控制租约").toBeTruthy();

  const survey = (headers: Record<string, string>) =>
    page.evaluate(
      async ({ origin, nodeId, operatorId, csrf, extraHeaders }) => {
        const response = await fetch(`${origin}/base/resource-nodes/${nodeId}/survey`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrf,
            ...extraHeaders
          },
          body: JSON.stringify({ operatorId, commandId: crypto.randomUUID() })
        });
        let code: string | null = null;
        try {
          const body = (await response.json()) as { error?: { code?: string } };
          code = body.error?.code ?? null;
        } catch {
          // 非 JSON 响应体
        }
        return { status: response.status, code };
      },
      { origin: api.apiOrigin, nodeId: api.nodeId!, operatorId: api.surveyorId!, csrf: register.csrfToken, extraHeaders: headers }
    );

  // ① 缺租约头 → 409 CONTROL_EXPIRED。
  const missing = await survey({});
  expect(missing.status).toBe(409);
  expect(missing.code).toBe("CONTROL_EXPIRED");

  // ② 错租约头 → 409 CONTROL_EXPIRED。
  const wrong = await survey({ "x-base-control-token": "e2e-wrong-lease-token" });
  expect(wrong.status).toBe(409);
  expect(wrong.code).toBe("CONTROL_EXPIRED");

  // ③ 两次被拒后无副作用：矿点仍无任何勘探单。
  const jobsAfterNegatives = await page.evaluate(async ({ origin, csrf }) => {
    const response = await fetch(`${origin}/base/snapshot`, {
      method: "GET",
      credentials: "include",
      headers: { "x-csrf-token": csrf }
    });
    const snapshot = (await response.json()) as SnapshotShape;
    return snapshot.extractionJobs?.length ?? 0;
  }, { origin: api.apiOrigin, csrf: register.csrfToken });
  expect(jobsAfterNegatives).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("01-negatives-rejected.png"), fullPage: true });

  // ④ 阳性对照：带页面心跳取得的有效租约 → 受理（勘探真实开工）。
  const valid = await survey({ "x-base-control-token": api.controlToken! });
  expect(valid.status).toBeLessThan(300);
  expect(valid.code).toBeNull();
  await expect(page.getByLabel("进行中的工作")).toContainText("勘探", { timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("02-valid-lease-accepted.png"), fullPage: true });
});
