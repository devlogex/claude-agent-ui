#!/usr/bin/env node
/**
 * Accessibility audit over the running app. Dev tool, not shipped.
 *
 * check-contrast.mjs proves the *token* pairs are AA. This proves the rendered page: that every
 * interactive element is reachable by Tab, that focus is always visible, that dialogs trap focus
 * and give it back, that no state is signalled by colour alone, and that reduced motion is
 * honoured. Those are properties of the DOM, so they can only be checked against a real one.
 *
 * Needs the dev server and the mock API:
 *   node scripts/mock-api.mjs --port 3000 &
 *   npm run dev &
 *   node scripts/a11y-audit.mjs
 */
import { chromium } from "playwright";

const base = "http://127.0.0.1:5174";
const SCREENS = ["/agents", "/skills", "/tasks", "/schedule"];

const browser = await chromium.launch({ channel: "chrome" });
const findings = [];
const fail = (screen, check, detail) => findings.push({ screen, check, detail });

async function withPage(opts, fn) {
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    colorScheme: opts.theme ?? "dark",
    reducedMotion: opts.reducedMotion,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.goto(base + (opts.url ?? "/"), { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  try {
    await fn(page, consoleErrors);
  } finally {
    await context.close();
  }
  return consoleErrors;
}

/** Everything a keyboard user should be able to land on, in DOM order. */
const INTERACTIVE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* ---------------------------------------------------------------------------------------
 * 1. Keyboard reachability + visible focus, per screen.
 * ------------------------------------------------------------------------------------ */
for (const url of SCREENS) {
  await withPage({ url }, async (page, consoleErrors) => {
    // What the DOM says should be reachable...
    const expected = await page.$$eval(INTERACTIVE, (els) =>
      els
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          // Offscreen-but-focusable (the skip link) counts; display:none does not.
          return cs.display !== "none" && cs.visibility !== "hidden" && (r.width > 0 || r.height > 0);
        })
        .map(
          (el) =>
            `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}`,
        ),
    );

    // ...and what Tab actually reaches.
    const reached = [];
    const focusRingMisses = [];
    await page.evaluate(() => document.body.focus());
    for (let i = 0; i < expected.length + 12; i += 1) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
        const ring = cs.boxShadow !== "none";
        const bordered = cs.borderColor !== cs.backgroundColor;
        return {
          key: `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}`,
          visible: outline || ring || bordered,
          outlineWidth: cs.outlineWidth,
          outlineColor: cs.outlineColor,
        };
      });
      if (!info) break;
      if (reached.includes(info.key) && reached[0] === info.key) break; // wrapped around
      reached.push(info.key);
      if (!info.visible) focusRingMisses.push(info.key);
    }

    const unreachable = expected.filter((e) => !reached.includes(e));
    if (unreachable.length) fail(url, "keyboard-reachable", `not reached by Tab: ${unreachable.join(", ")}`);
    if (focusRingMisses.length) fail(url, "focus-visible", `no visible focus: ${focusRingMisses.join(", ")}`);
    if (consoleErrors.length) fail(url, "console", consoleErrors.join(" | "));

    // Accessible name on every control.
    const unnamed = await page.$$eval(INTERACTIVE, (els) =>
      els
        .filter((el) => {
          const name = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim();
          const labelled =
            el.getAttribute("aria-labelledby") || (el.id && document.querySelector(`label[for="${el.id}"]`));
          return !name && !labelled;
        })
        .map((el) => el.outerHTML.slice(0, 120)),
    );
    if (unnamed.length) fail(url, "accessible-name", unnamed.join(" | "));
  });
}

/* ---------------------------------------------------------------------------------------
 * 2. No colour-only state. Every status badge must carry a word.
 * ------------------------------------------------------------------------------------ */
for (const url of SCREENS) {
  await withPage({ url }, async (page) => {
    const bare = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("span, div")) {
        const cs = getComputedStyle(el);
        const bg = cs.backgroundColor;
        // A tinted chip with no text is the failure mode we are hunting.
        if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.width > 320 || r.height > 40) continue;
        if (el.children.length > 2) continue;
        if (el.textContent.trim()) continue;
        // Decoration is exempt, but only when it is declared as such: `aria-hidden` means it
        // carries no information, so it cannot be the sole carrier of any. The brand dot and
        // the sidebar's active marker are this; the marker's state is also on `aria-current`.
        if (el.closest('[aria-hidden="true"]')) continue;
        // A control that exposes its own state to the platform is not colour-only: a `switch`
        // reports checked/unchecked, and moves its thumb. (The schedule rows additionally
        // print "Disabled — will not fire" next to it.)
        if (el.parentElement?.querySelector('[role="switch"], input[type="checkbox"], input[type="radio"]')) continue;
        out.push(`${el.className} ${bg} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    if (bare.length) fail(url, "colour-only", bare.join(" | "));
  });
}

/* ---------------------------------------------------------------------------------------
 * 3. Dialogs: focus trap, Escape, and focus restored to the opener.
 * ------------------------------------------------------------------------------------ */
const DIALOGS = [
  { url: "/tasks", open: /new task/i, name: "New task" },
  { url: "/schedule", open: /new schedule/i, name: "New schedule" },
];

for (const d of DIALOGS) {
  await withPage({ url: d.url }, async (page) => {
    const opener = page.getByRole("button", { name: d.open }).first();
    if (!(await opener.count())) return fail(d.url, "dialog", `no opener matching ${d.open}`);
    const openerKey = await opener.evaluate((el) => el.textContent.trim());
    await opener.click();
    await page.waitForTimeout(400);

    const dialog = page.getByRole("dialog");
    if (!(await dialog.count())) return fail(d.url, "dialog", `${d.name} did not open`);

    // Focus must have moved inside the panel.
    const inside = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"], [role="alertdialog"]');
      return dlg?.contains(document.activeElement) ?? false;
    });
    if (!inside) fail(d.url, "dialog-focus", `${d.name}: focus did not enter the panel`);

    // Tab 25 times; focus must never leave the panel.
    let escaped = null;
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press("Tab");
      const still = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"], [role="alertdialog"]');
        const el = document.activeElement;
        return {
          in: dlg?.contains(el) ?? false,
          at: `${el?.tagName}:${(el?.getAttribute("aria-label") || el?.textContent || "").trim().slice(0, 30)}`,
        };
      });
      if (!still.in) {
        escaped = still.at;
        break;
      }
    }
    if (escaped) fail(d.url, "dialog-trap", `${d.name}: focus escaped to ${escaped}`);

    // Escape closes, and focus goes back to the button that opened it.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    if (await page.getByRole("dialog").count()) fail(d.url, "dialog-escape", `${d.name}: Escape did not close`);
    const restored = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "<body>");
    if (restored !== openerKey) {
      fail(d.url, "dialog-restore", `${d.name}: focus went to "${restored}", expected "${openerKey}"`);
    }
  });
}

/* ---------------------------------------------------------------------------------------
 * 4. prefers-reduced-motion: nothing may animate.
 * ------------------------------------------------------------------------------------ */
await withPage({ url: "/tasks", reducedMotion: "reduce" }, async (page) => {
  const moving = await page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .filter((el) => {
        const cs = getComputedStyle(el);
        const dur = (s) => s.split(",").some((v) => parseFloat(v) > 0.05);
        return (cs.animationName !== "none" && dur(cs.animationDuration)) || dur(cs.transitionDuration);
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80)),
  );
  if (moving.length) fail("/tasks", "reduced-motion", moving.join(" | "));
});

/* ---------------------------------------------------------------------------------------
 * 5. Empty / loading / error states exist and carry copy, on all four screens.
 * ------------------------------------------------------------------------------------ */
for (const scenario of ["empty", "error"]) {
  for (const url of SCREENS) {
    await withPage({ url: `${url}?__scenario=${scenario}` }, async (page) => {
      // The mock is restarted per scenario by the caller; here we just assert the screen is
      // not blank and says something.
      const text = await page.locator("main").innerText();
      if (text.trim().length < 20) fail(url, `${scenario}-state`, "main is effectively blank");
    });
  }
}

await browser.close();

if (findings.length === 0) {
  console.log("a11y audit: no findings.");
} else {
  console.log(`a11y audit: ${findings.length} finding(s)\n`);
  for (const f of findings) console.log(`  [${f.screen}] ${f.check}\n      ${f.detail}\n`);
}
process.exit(findings.length ? 1 : 0);
