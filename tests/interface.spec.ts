import { expect, test, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import thai from "../i18n/locales/th.json" with { type: "json" };

async function gotoReady(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(() => Boolean((document.querySelector("#__nuxt") as HTMLElement & { __vue_app__?: unknown })?.__vue_app__));
  await expect(page.locator("select, option")).toHaveCount(0);
}
async function chooseDropdown(page: Page, control: Locator, value: string) {
  await control.click();
  await page.getByRole("listbox").locator(`[role="option"][data-value="${value}"]`).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
}
async function navigate(page: Page, label: string) {
  const toggle = page.getByRole("button", { name: "Open navigation" });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("navigation", { name: "Dashboard navigation" }).getByRole("link", { name: label }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/wallet/evm/balance", async route => {
    const { wallet } = await (await page.request.get("/api/wallet/evm")).json();
    await route.fulfill({ json: { address: wallet.address, chainId: 80002, blockNumber: "100",
      native: { symbol: "POL", decimals: 18, balance: "0", balanceUnits: "0" }, token: null } });
  });
});

test("landing plan calculator, FAQ, and username/password dialog", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await gotoReady(page, "/");
  await expect(page.getByRole("heading", { name: "Your circle. All connected." })).toBeVisible();
  await page.locator("#rank-range").fill("8");
  await expect(page.locator(".calculator-total strong")).toContainText("3,328.00");
  await page.getByRole("button", { name: "Do I need a crypto wallet to get started?" }).click();
  await expect(page.locator("#faq-1")).toContainText("username and password");
  await page.getByRole("button", { name: "Start your loop", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Start your loop", exact: true })).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/landing-${testInfo.project.name}.png`, fullPage: true });
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("matrix, corrected ranks, referrals, and wallet preview on desktop and mobile", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await gotoReady(page, "/dashboard");
  await expect(page.getByRole("heading", { name: "Your network, at a glance." })).toBeVisible();
  await expect(page.getByRole("img", { name: /Example binary matrix/ })).toBeVisible();
  await chooseDropdown(page, page.getByLabel("Select matrix rank"), "8");
  await expect(page.locator(".matrix-layer-summary")).toContainText("1,280.00");
  await noOverflow(page);
  await page.screenshot({ path: `test-results/dashboard-${testInfo.project.name}.png`, fullPage: true });
  await navigate(page, "Ranks & commissions");
  await page.getByRole("button", { name: /^RANK 08/ }).click();
  await expect(page.locator("tfoot")).toContainText("3,328.00");
  await expect(page.locator(".unilevel-table tbody tr")).toHaveCount(15);
  await expect(page.locator(".rank-detail-grid tbody tr").first()).toContainText("1,280.00");
  await page.getByRole("button", { name: /^RANK 15/ }).click();
  await expect(page.locator("tfoot")).toContainText("425,984.00");
  await noOverflow(page);
  await navigate(page, "My referrals");
  await page.getByLabel("Search referrals").fill("jamie");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("jamie_chen");
  await page.getByLabel("Search referrals").fill("");
  await chooseDropdown(page, page.getByLabel("Filter referral status"), "Registered");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.getByRole("button", { name: "Tree view", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tree view", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-tree-node]")).toHaveCount(5);
  await expect(page.locator("[data-member='taylor_kim']")).toBeVisible();
  await chooseDropdown(page, page.getByLabel("Filter referral status"), "all");
  await expect(page.locator("[data-tree-node]")).toHaveCount(9);
  await expect(page.locator("[data-tree-edge]")).toHaveCount(8);
  await page.getByLabel("Search referrals").fill("casey");
  await expect(page.locator("[data-tree-node]")).toHaveCount(4);
  await expect(page.locator("[data-member='alex_morgan']")).toHaveAttribute("opacity", "0.5");
  await expect(page.locator("[data-member='casey_brooks']")).toHaveAttribute("opacity", "1");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("casey_brooks");
  await page.getByRole("button", { name: "Tree view", exact: true }).click();
  await page.getByLabel("Search referrals").fill("");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByRole("group", { name: "Tree zoom" })).toContainText("125%");
  await page.getByRole("button", { name: "Reset tree view", exact: true }).click();
  await expect(page.getByRole("group", { name: "Tree zoom" })).toContainText("100%");
  await chooseDropdown(page, page.getByLabel("Show levels", { exact: true }), "15");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download image", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("loop-referral-tree.svg");
  const svg = await readFile((await download.path())!, "utf8");
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain("@casey_brooks");
  await page.reload();
  await expect(page.getByRole("button", { name: "Tree view", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-tree-node]")).toHaveCount(9);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/referral-tree-${testInfo.project.name}.png`, fullPage: true });
  await page.getByLabel("Search referrals").fill("nobody_matches_this");
  await expect(page.getByRole("heading", { name: "No matching referrals" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download image", exact: true })).toBeDisabled();
  await navigate(page, "EVM wallet");
  await expect(page.getByTestId("wallet-balance")).toContainText("—");
  await page.getByRole("button", { name: "Receive", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Sign in");
  await page.keyboard.press("Escape");
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("create account and EVM wallet, restore session, and sign back in", async ({ page }, testInfo) => {
  const username = `ui_${testInfo.project.name}_${Date.now().toString(36)}`;
  const password = "A good local password 42!";
  await gotoReady(page, "/dashboard");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill("A different password");
  await page.getByRole("button", { name: "Create account & wallet" }).click();
  await expect(page.getByRole("alert")).toContainText("do not match");
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account & wallet" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".dashboard-greeting")).toContainText(username.toUpperCase());
  await expect(page.getByTestId("wallet-balance")).toContainText("0.00");
  await navigate(page, "My referrals");
  await page.getByRole("button", { name: "Tree view", exact: true }).click();
  await expect(page.locator("[data-tree-node]")).toHaveCount(1);
  await expect(page.locator(".referral-network-image")).toContainText("Your next connection starts this tree.");
  await navigate(page, "EVM wallet");
  await expect(page.getByTestId("wallet-balance")).toContainText("0.00");
  const address = (await page.getByTestId("evm-address").textContent())!;
  expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  await page.getByRole("button", { name: "Receive", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(address);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByTestId("evm-address")).toHaveText(address);
  await expect(page.getByTestId("wallet-balance")).toContainText("0.00");
  await navigate(page, "Account settings");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await page.getByLabel("Username", { exact: true }).fill(username.toUpperCase());
  await page.getByLabel("Password", { exact: true }).fill("wrong password");
  await page.getByRole("button", { name: "Sign in to UNXO", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in to UNXO", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".dashboard-greeting")).toContainText(username.toUpperCase());
  await navigate(page, "EVM wallet");
  await expect(page.getByTestId("evm-address")).toHaveText(address);
  await page.screenshot({ path: `test-results/wallet-${testInfo.project.name}.png`, fullPage: true });
  await noOverflow(page);
});

test("single theme icon toggles light/dark, persists, and exports themed trees", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "dark" });
  await gotoReady(page, "/dashboard");
  await expect(page.locator("html")).toHaveClass(/light/);
  await expect(page.locator("button.theme-toggle")).toHaveCount(1);
  await expect(page.locator("button.theme-toggle svg")).toHaveCount(1);
  await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Use light theme", exact: true }).press("Enter");
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/);
  expect(await page.evaluate(() => localStorage.getItem("loop-color-mode"))).toBe("light");
  await page.screenshot({ path: `test-results/gold-overview-light-${testInfo.project.name}.png`, fullPage: true });
  await gotoReady(page, "/");
  await expect(page.locator("html")).toHaveClass(/light/);
  await noOverflow(page);
  await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Start your loop", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const dialogBackground = await page.getByRole("dialog").evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(dialogBackground).toBe("rgb(21, 26, 35)");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `test-results/gold-landing-dark-${testInfo.project.name}.png`, fullPage: true });
  await gotoReady(page, "/dashboard?view=wallet");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByTestId("wallet-balance")).toContainText("—");
  await noOverflow(page);
  await page.screenshot({ path: `test-results/gold-wallet-dark-${testInfo.project.name}.png`, fullPage: true });
  await gotoReady(page, "/dashboard?view=referrals&layout=tree");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("[data-tree-node]")).toHaveCount(9);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download image", exact: true }).click();
  const svg = await readFile((await (await downloadEvent).path())!, "utf8");
  expect(svg).toContain('fill="#11161f"');
  expect(svg).not.toContain("var(--");
  await noOverflow(page);
  await page.screenshot({ path: `test-results/gold-tree-dark-${testInfo.project.name}.png`, fullPage: true });
  await gotoReady(page, "/dashboard?view=settings");
  const theme = page.getByLabel("Theme preference");
  await theme.click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("option", { name: "Light theme", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Dark theme", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await chooseDropdown(page, theme, "light");
  await expect(page.getByRole("button", { name: "Use dark theme", exact: true })).toBeVisible();
  await chooseDropdown(page, theme, "dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.evaluate(() => localStorage.setItem("loop-color-mode", "system"));
  await page.reload();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("loop-color-mode"))).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await gotoReady(page, "/dashboard");
  await page.screenshot({ path: `test-results/gold-overview-dark-${testInfo.project.name}.png`, fullPage: true });
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("Thai switching persists across pages, localizes forms and tree exports, and keeps the theme", async ({ page }, testInfo) => {
  const th = thai.ui;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "warning" && /i18n|hydration/i.test(message.text())) errors.push(message.text());
  });
  await gotoReady(page, "/dashboard");
  await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
  await chooseDropdown(page, page.getByLabel("Language", { exact: true }), "th");
  await expect(page.locator("html")).toHaveAttribute("lang", "th-TH");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("heading", { name: th.your_network_at_a_glance })).toBeVisible();
  expect((await page.context().cookies()).find((cookie) => cookie.name === "loop_locale")?.value).toBe("th");
  await noOverflow(page);
  await page.screenshot({ path: `test-results/thai-overview-dark-${testInfo.project.name}.png`, fullPage: true });

  await gotoReady(page, "/dashboard?view=referrals&layout=tree");
  await expect(page.locator("html")).toHaveAttribute("lang", "th-TH");
  await expect(page.locator("[data-tree-node]")).toHaveCount(9);
  await page.getByLabel(th.search_referrals).fill("casey");
  await chooseDropdown(page, page.getByLabel(th.language, { exact: true }), "en");
  await expect(page.getByLabel("Search referrals")).toHaveValue("casey");
  await expect(page.locator("[data-tree-node]")).toHaveCount(4);
  await chooseDropdown(page, page.getByLabel("Language", { exact: true }), "th");
  await page.getByLabel(th.search_referrals).fill("");
  await chooseDropdown(page, page.getByLabel(th.filter_referral_status), "Registered");
  await expect(page.locator("[data-tree-node]")).toHaveCount(5);
  await chooseDropdown(page, page.getByLabel(th.filter_referral_status), "all");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: th.download_image, exact: true }).click();
  const svg = await readFile((await (await downloadEvent).path())!, "utf8");
  expect(svg).toContain(th.your_account);
  expect(svg).toContain(th.username_s_referral_network.replace("{username}", th.you));
  expect(svg).not.toContain("var(--");
  await noOverflow(page);
  await page.screenshot({ path: `test-results/thai-tree-dark-${testInfo.project.name}.png`, fullPage: true });

  await gotoReady(page, "/dashboard?view=wallet");
  await expect(page.getByTestId("evm-wallet")).toContainText(th.in_app_wallet);
  await expect(page.locator(".wallet-transaction")).toHaveCount(0);
  await expect(page.getByTestId("wallet-balance")).toContainText("—");
  await noOverflow(page);
  await gotoReady(page, "/dashboard?view=settings");
  await expect(page.getByLabel(th.language, { exact: true })).toHaveCount(2);
  await chooseDropdown(page, page.getByLabel(th.language, { exact: true }).last(), "en");
  await expect(page.getByLabel("Language", { exact: true }).first()).toHaveAttribute("data-value", "en");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.locator("html")).toHaveClass(/dark/);

  await gotoReady(page, "/");
  await chooseDropdown(page, page.getByLabel("Language", { exact: true }), "th");
  await page.getByRole("button", { name: th.do_i_need_a_crypto_wallet_to_get_started }).click();
  await expect(page.locator("#faq-1")).toContainText(th.create_an_account_with_a_username_and_password_your_in_app_usdt_ledger_wallet_is_crea);
  await page.getByRole("button", { name: th.start_your_loop, exact: true }).click();
  await page.getByLabel(th.username, { exact: true }).fill(`missing_${Date.now().toString(36)}`);
  await page.getByLabel(th.password, { exact: true }).fill("A wrong password 42!");
  await page.getByRole("button", { name: th.sign_in_to_loop, exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(th.username_or_password_is_incorrect);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: th.use_light_theme, exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await noOverflow(page);
  await page.screenshot({ path: `test-results/thai-landing-light-${testInfo.project.name}.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("a first visit detects Thai from the browser", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One browser-language detection check is sufficient.");
  const context = await browser.newContext({ locale: "th-TH" });
  try {
    const page = await context.newPage();
    await gotoReady(page, "http://127.0.0.1:3100/");
    await expect(page.locator("html")).toHaveAttribute("lang", "th-TH");
    await expect(page.getByLabel(thai.ui.language, { exact: true })).toHaveAttribute("data-value", "th");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(thai.ui.your_circle);
  } finally {
    await context.close();
  }
});

test("custom dropdowns support keyboard selection, cancellation, and outside dismissal", async ({ page }, testInfo) => {
  await gotoReady(page, "/dashboard");
  const rank = page.getByRole("combobox", { name: "Select matrix rank", exact: true });
  await rank.focus();
  await rank.press("End");
  await expect(page.getByRole("option", { name: "15 · 163,840 USDT", exact: true })).toBeInViewport();
  await rank.press("Enter");
  await expect(rank).toHaveAttribute("data-value", "15");
  await expect(rank).toBeFocused();
  await rank.press("Home");
  await rank.press("Escape");
  await expect(rank).toHaveAttribute("data-value", "15");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await rank.press("ArrowUp");
  await rank.press("PageUp");
  await rank.press("Tab");
  await expect(rank).toHaveAttribute("data-value", "5");
  await expect(rank).not.toBeFocused();

  const language = page.getByRole("combobox", { name: "Language", exact: true });
  await language.click();
  await rank.click();
  await expect(page.getByRole("listbox")).toHaveCount(1);
  await expect(language).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("heading", { level: 1 }).click();
  await expect(rank).toHaveAttribute("aria-expanded", "false");
  await expect(rank).toHaveAttribute("data-value", "5");

  await gotoReady(page, "/dashboard?view=settings");
  const theme = page.getByRole("combobox", { name: "Theme preference", exact: true });
  await theme.focus();
  await theme.press("d");
  await theme.press("Enter");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(theme).toBeFocused();
  await theme.press(" ");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await page.screenshot({ path: `test-results/dropdown-theme-dark-${testInfo.project.name}.png` });
  await theme.press("Escape");
  await chooseDropdown(page, page.getByRole("combobox", { name: "Language", exact: true }).first(), "th");
  await page.getByRole("combobox", { name: thai.ui.theme_preference, exact: true }).click();
  await expect(page.getByRole("option", { name: thai.ui.dark_theme, exact: true })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: `test-results/dropdown-thai-dark-${testInfo.project.name}.png` });
  await page.keyboard.press("Escape");
  await chooseDropdown(page, page.getByRole("combobox", { name: thai.ui.theme_preference, exact: true }), "light");
  await page.getByRole("combobox", { name: thai.ui.language, exact: true }).first().click();
  await page.screenshot({ path: `test-results/dropdown-thai-light-${testInfo.project.name}.png` });
  await page.keyboard.press("Escape");
  await noOverflow(page);
});

test("page motion reveals content, preserves keyboard access, and respects reduced motion", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await gotoReady(page, "/");
  await expect(page.locator(".center-token")).toHaveCSS("animation-name", "token-drift");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("opacity", "1");
  await page.locator(".step").first().scrollIntoViewIfNeeded();
  await expect(page.locator(".step").first()).toHaveCSS("opacity", "1");
  const openModal = page.locator(".hero-copy .button").first();
  async function slideDirection() {
    return page.locator(".modal-card").evaluate(async (element) => {
      for (let frame = 0; frame < 5; frame++) {
        const animation = element.getAnimations().find(item => item.effect instanceof KeyframeEffect && item.effect.getKeyframes().some(keyframe => keyframe.translate !== undefined));
        if (animation?.effect instanceof KeyframeEffect) {
          const frames = animation.effect.getKeyframes();
          const y = (value: unknown) => value === "none" ? 0 : Number.parseFloat(String(value).trim().split(/\s+/).at(-1) || "0");
          return { direction: y(frames.at(-1)?.translate) - y(frames[0]?.translate), inert: (element as HTMLElement).inert, locked: document.body.style.overflow === "hidden" };
        }
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      return { direction: 0, inert: (element as HTMLElement).inert, locked: document.body.style.overflow === "hidden" };
    });
  }
  await openModal.click();
  expect((await slideDirection()).direction).toBeGreaterThan(0);
  await expect(page.getByRole("dialog")).toBeFocused();
  await page.locator(".modal-backdrop").evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
  await page.keyboard.press("Escape");
  const leaving = await slideDirection();
  expect(leaving.direction).toBeLessThan(0);
  expect(leaving.inert).toBe(true);
  expect(leaving.locked).toBe(true);
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  await expect(openModal).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  const finalAction = page.locator(".final-cta button");
  await finalAction.focus();
  await expect(finalAction).toBeFocused();
  await expect(page.locator(".final-cta")).toHaveCSS("opacity", "1");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  await expect(page.locator(".center-token")).toHaveCSS("animation-name", "none");
  await openModal.click();
  expect(await page.locator(".modal-backdrop").evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  await expect(openModal).toBeFocused();
  await gotoReady(page, "/dashboard?view=settings");
  await expect(page.locator(".account-settings")).toHaveCSS("opacity", "1");
  await chooseDropdown(page, page.getByRole("combobox", { name: "Theme preference", exact: true }), "dark");
  await navigate(page, "My referrals");
  await page.getByLabel("Search referrals").fill("casey");
  await page.getByRole("button", { name: "Tree view", exact: true }).click();
  await expect(page.getByLabel("Search referrals")).toHaveValue("casey");
  await expect(page.locator("[data-tree-node]")).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await navigate(page, "EVM wallet");
  await expect(page.getByTestId("wallet-balance")).toContainText("—");
  await expect(page.locator(".balance-card")).toHaveCSS("opacity", "1");
  const language = page.getByRole("combobox", { name: "Language", exact: true });
  await language.focus();
  await language.press(" ");
  await language.press("Escape");
  await language.press(" ");
  await expect(page.getByRole("option", { name: "English", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await noOverflow(page);
  expect(errors).toEqual([]);
});
