import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import "dotenv/config";
import postgres from "postgres";
const credentials = Object.fromEntries(
  readFileSync(".local-credentials", "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split), line.slice(split + 1)];
    }),
);
test("private daily workflow, timer, offline delivery, mobile and logout", async ({
  page,
  context,
}) => {
  const createdLogs: string[] = [],
    createdFocus: string[] = [];
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", async (response) => {
    if (response.request().method() !== "POST" || response.status() >= 300)
      return;
    try {
      const json = await response.json();
      if (response.url().endsWith("/logs") && json.log?.id)
        createdLogs.push(json.log.id);
      if (
        (response.url().endsWith("/focus") ||
          response.url().endsWith("/focus/import")) &&
        json.session?.id
      )
        createdFocus.push(json.session.id);
    } catch {}
  });
  try {
    await page.goto("/");
    await page.getByLabel("E-mail", { exact: true }).fill(credentials.EMAIL);
    await page
      .getByLabel("Lozinka", { exact: true })
      .fill(credentials.PASSWORD);
    await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /Dobro došao/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Dodaj zapis", exact: true })
      .click();
    await page.getByLabel("Težina (kg)", { exact: true }).fill("81.2");
    await page
      .getByRole("button", { name: "Spremi zapis", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("Zapis je spremljen.");
    await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
    await page.getByRole("button", { name: "Učenje", exact: true }).click();
    await page.getByLabel("Što ćeš učiti?").fill("E2E učenje");
    await page.getByRole("button", { name: /Počni učiti/ }).click();
    await expect(
      page.getByText("Sesija je u tijeku", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Pauza/ }).click();
    await expect(
      page.getByText("Sesija je na pauzi", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Učenje", exact: true }).click();
    await expect(
      page.getByText("Sesija je na pauzi", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Završi sesiju", exact: true })
      .click();
    await expect(page.getByLabel("Što ćeš učiti?")).toBeVisible();
    await page.getByRole("button", { name: "Danas", exact: true }).click();
    await context.setOffline(true);
    await page
      .getByRole("button", { name: "Dodaj zapis", exact: true })
      .click();
    await page.getByLabel("Što bilježiš?").selectOption("workout");
    await page
      .getByLabel("Vrsta treninga", { exact: true })
      .fill("E2E offline trening");
    await page.getByLabel("Trajanje (minute)", { exact: true }).fill("35");
    await page
      .getByRole("button", { name: "Spremi zapis", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Zapis je spremljen na ovom uređaju i čeka slanje.",
    );
    await page.getByRole("button", { name: "Postavke", exact: true }).click();
    page.once("dialog", dialog => dialog.accept());
    const failedRestore = page.waitForEvent("requestfailed", request => request.url().endsWith("/restore"));
    await page.getByLabel("Vrati osobni JSON izvoz").setInputFiles({name:"invalid.json",mimeType:"application/json",buffer:Buffer.from("{}")});
    await failedRestore;
    await expect.poll(() => page.evaluate(() => new Promise<number>((resolve) => {
      const request = indexedDB.open("personal-private-v1");
      request.onsuccess = () => {
        const count = request.result.transaction("queue").objectStore("queue").count();
        count.onsuccess = () => resolve(count.result);
      };
    }))).toBe(1);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /Dobro došao/ }),
    ).toBeVisible();
    await context.setOffline(false);
    await expect(
      page.getByText("E2E offline trening · 35 min", { exact: true }),
    ).toBeVisible();
    const pending = await page.evaluate(async () => {
      return new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("personal-private-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const get = request.result
            .transaction("queue")
            .objectStore("queue")
            .count();
          get.onsuccess = () => resolve(get.result);
        };
      });
    });
    expect(pending).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
    await page.getByRole("button", { name: "Postavke", exact: true }).click();
    await expect(page.getByLabel("Ime", { exact: true })).toBeVisible();
    await expect(page.getByLabel(/Dopuštam slanje/)).not.toBeChecked();
    const otherTab = await context.newPage();
    await otherTab.goto("/");
    await expect(
      otherTab.getByRole("heading", { name: /Dobro došao/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Odjava", exact: true })
      .last()
      .click();
    await expect(
      page.getByRole("button", { name: "Prijavi se", exact: true }),
    ).toBeVisible();
    await expect(
      otherTab.getByRole("button", { name: "Prijavi se", exact: true }),
    ).toBeVisible();
    expect(browserErrors).toEqual([]);
  } finally {
    await context.setOffline(false);
    // Remove only UUIDs created by this scenario; never clear a personal account's existing records.
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    if (createdLogs.length)
      await sql`DELETE FROM logs WHERE id IN ${sql([...new Set(createdLogs)])}`;
    if (createdFocus.length)
      await sql`DELETE FROM focus_sessions WHERE id IN ${sql([...new Set(createdFocus)])}`;
    await sql.end();
  }
});
