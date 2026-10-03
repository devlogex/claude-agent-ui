#!/usr/bin/env node
/**
 * WCAG AA contrast check over the semantic token layer, in both themes.
 *
 * It parses src/styles/tokens.css rather than taking a list of colours as input, so a token
 * someone changes next month is checked by the same run. Status badges are composited over
 * every surface they can land on — a badge that passes on the page background and fails on a
 * selected table row is still a failure.
 *
 *   node scripts/check-contrast.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tokensFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", "tokens.css");
const css = readFileSync(tokensFile, "utf8");

/** AA: 4.5:1 for text, 3:1 for large text, icons, borders and focus indicators. */
const TEXT = 4.5;
const NON_TEXT = 3;

function ruleBody(selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`no rule matching ${JSON.stringify(selector)} in tokens.css`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("\n}", open);
  return Object.fromEntries(
    [...css.slice(open, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

const primitives = ruleBody(":root {\n  /* --- Colour ramps");
const THEMES = {
  dark: ruleBody(':root,\n:root[data-theme="dark"]'),
  light: ruleBody(':root[data-theme="light"]'),
};

function resolve(value, theme) {
  let current = value;
  for (let i = 0; i < 8; i += 1) {
    const match = /^var\((--[\w-]+)\)$/.exec(current.trim());
    if (!match) return current.trim();
    current = theme[match[1]] ?? primitives[match[1]] ?? "";
  }
  throw new Error(`token reference loop at ${value}`);
}

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `color-mix(in oklab, X N%, transparent)` painted over `surface`, as a solid hex. */
function flatten(expr, theme, surface) {
  const mix = /color-mix\(in oklab,\s*(var\(--[\w-]+\)|#[0-9a-f]{6})\s*(\d+)%/i.exec(expr);
  if (!mix) return resolve(expr, theme);
  const alpha = Number(mix[2]) / 100;
  const base = channels(resolve(mix[1], theme));
  const over = channels(surface);
  return `#${base
    .map((c, i) =>
      Math.round(c * alpha + over[i] * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const SURFACES = [
  "--color-bg",
  "--color-surface",
  "--color-surface-raised",
  "--color-surface-sunken",
  "--color-surface-selected",
];

const ON_SURFACE = [
  ["--color-fg", TEXT],
  ["--color-fg-muted", TEXT],
  ["--color-fg-subtle", NON_TEXT],
  ["--color-accent-fg", TEXT],
  ["--color-danger-fg", TEXT],
  ["--color-focus-ring", NON_TEXT],
  ["--color-border-strong", 1.4],
];

const PAIRS = [
  ["--color-fg-on-accent", "--color-accent"],
  ["--color-fg-on-accent", "--color-accent-hover"],
  ["--color-fg-on-danger", "--color-danger"],
  ["--color-fg-on-danger", "--color-danger-hover"],
];

const STATUSES = ["running", "queued", "scheduled", "finished", "failed", "idle"];

const failures = [];
let checked = 0;

function assert(themeName, label, fg, bg, need) {
  checked += 1;
  const ratio = contrast(fg, bg);
  if (ratio < need) {
    failures.push(`${themeName.padEnd(5)} ${ratio.toFixed(2)} < ${need}  ${label}  (${fg} on ${bg})`);
  }
}

for (const [themeName, theme] of Object.entries(THEMES)) {
  const surfaces = SURFACES.map((key) => [key, resolve(theme[key], theme)]);

  for (const [fgKey, need] of ON_SURFACE) {
    const fg = resolve(theme[fgKey], theme);
    for (const [surfaceKey, surface] of surfaces) assert(themeName, `${fgKey} on ${surfaceKey}`, fg, surface, need);
  }

  for (const [fgKey, bgKey] of PAIRS) {
    assert(themeName, `${fgKey} on ${bgKey}`, resolve(theme[fgKey], theme), resolve(theme[bgKey], theme), TEXT);
  }

  for (const status of STATUSES) {
    const fg = resolve(theme[`--status-${status}-fg`], theme);
    for (const [surfaceKey, surface] of surfaces) {
      const bg = flatten(theme[`--status-${status}-bg`], theme, surface);
      assert(themeName, `${status} badge over ${surfaceKey}`, fg, bg, TEXT);
    }
  }
}

if (failures.length > 0) {
  console.error(`${failures.length} of ${checked} token pairs are below WCAG AA:\n`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`All ${checked} token pairs meet WCAG AA in both themes.`);
