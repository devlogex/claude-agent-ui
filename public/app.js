"use strict";

const state = { config: null, agents: [], editing: null, pollTimer: null, pollGen: 0, lastRunsJson: null, detailsOpen: new Map(), prompts: new Map() };
const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

// ---- recent working directories (per-browser convenience) ----
const RECENT_KEY = "claude-agent-ui.recentCwds";
function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function rememberCwd(cwd) {
  const list = [cwd, ...loadRecent().filter((c) => c !== cwd)].slice(0, 10);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable; recent list just won't persist
  }
  renderRecent();
}
function renderRecent() {
  $("recent-cwds").replaceChildren(...loadRecent().map((c) => el("option", { value: c })));
}

const UNATTENDED_KEY = "claude-agent-ui.unattended";
function initUnattended() {
  const box = $("unattended");
  try {
    box.checked = localStorage.getItem(UNATTENDED_KEY) !== "false";
  } catch {
    // storage unavailable; keep the default (on)
  }
  box.addEventListener("change", () => {
    try {
      localStorage.setItem(UNATTENDED_KEY, String(box.checked));
    } catch {
      // storage unavailable; the choice just won't persist
    }
  });
}

// ---- agents ----
async function loadAgents() {
  state.agents = await api("GET", "/api/agents");
  renderAgents();
}

function renderAgents() {
  const q = $("filter").value.trim().toLowerCase();
  const visible = state.agents.filter(
    (a) => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.runName.toLowerCase().includes(q),
  );
  const groups = new Map();
  for (const a of visible) {
    if (!groups.has(a.source)) groups.set(a.source, []);
    groups.get(a.source).push(a);
  }
  const order = [...groups.keys()].sort((x, y) => (x === "global" ? -1 : y === "global" ? 1 : x.localeCompare(y)));
  const list = $("agent-list");
  if (!visible.length) {
    list.replaceChildren(el("p", { class: "muted" }, state.agents.length ? "No agents match the filter." : "No agents found. Create one with New agent."));
    return;
  }
  list.replaceChildren(
    ...order.flatMap((source) => [
      el("div", { class: "group-title" }, source === "global" ? "Global (~/.claude/agents)" : source),
      ...groups.get(source).map(agentCard),
    ]),
  );
}

function agentCard(agent) {
  const error = el("p", { class: "error", hidden: true });
  // Kept in state (not the DOM) so the draft survives filter/reload re-renders; it stays after a run for re-use.
  const draft = state.prompts.get(agent.id) || { open: false, text: "" };
  state.prompts.set(agent.id, draft);
  const promptBox = el("textarea", { class: "prompt", rows: 3, placeholder: state.config.starterPrompt, hidden: !draft.open });
  promptBox.value = draft.text;
  promptBox.addEventListener("input", () => (draft.text = promptBox.value));
  const promptBtn = el("button", { class: "btn" }, draft.open ? "− prompt" : "+ prompt");
  promptBtn.addEventListener("click", () => {
    draft.open = !draft.open;
    promptBox.hidden = !draft.open;
    promptBtn.textContent = draft.open ? "− prompt" : "+ prompt";
    if (draft.open) promptBox.focus();
  });
  const runBtn = el("button", { class: "btn primary", disabled: !agent.valid }, "Run");
  runBtn.addEventListener("click", async () => {
    const cwd = $("cwd").value.trim();
    // A closed box means a plain run with the starter prompt, even if a draft is kept.
    const prompt = draft.open ? draft.text : "";
    error.hidden = true;
    runBtn.disabled = true;
    runBtn.textContent = "Starting…";
    try {
      await api("POST", "/api/runs", { agentId: agent.id, cwd, prompt, unattended: $("unattended").checked });
      rememberCwd(cwd);
      state.lastRunsJson = null;
      await refreshRuns();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      runBtn.disabled = !agent.valid;
      runBtn.textContent = "Run";
    }
  });
  return el(
    "div",
    { class: "card" },
    el(
      "div",
      { class: "card-head" },
      el("span", { class: "name" }, agent.runName),
      agent.model && el("span", { class: "badge" }, agent.model),
      !agent.valid && el("span", { class: "badge danger" }, "invalid frontmatter"),
      el("span", { class: "spacer" }),
      el("div", { class: "actions" }, el("button", { class: "btn", onclick: () => openEditor(agent.id) }, agent.editable ? "Edit" : "View"), promptBtn, runBtn),
    ),
    el("div", { class: "desc" }, agent.valid ? agent.description : agent.error),
    promptBox,
    error,
  );
}

// ---- editor ----
function showEditor({ title, content, readOnly, mode }) {
  state.editing = mode;
  $("editor-title").textContent = title;
  $("editor-content").value = content;
  $("editor-content").readOnly = readOnly;
  $("editor-readonly").hidden = !readOnly;
  $("editor-copy").hidden = !readOnly;
  $("editor-save").hidden = readOnly;
  $("editor-error").hidden = true;
  $("editor").showModal();
}

async function openEditor(id) {
  try {
    const agent = await api("GET", `/api/agents/${encodeURIComponent(id)}`);
    showEditor({
      title: agent.runName,
      content: agent.content,
      readOnly: !agent.editable,
      mode: agent.editable ? { kind: "update", id } : { kind: "view" },
    });
  } catch (err) {
    alert(err.message);
  }
}

function openNew(content) {
  showEditor({ title: "New agent", content, readOnly: false, mode: { kind: "create" } });
}

async function saveEditor() {
  const content = $("editor-content").value;
  const mode = state.editing;
  const errorBox = $("editor-error");
  errorBox.hidden = true;
  try {
    if (mode.kind === "create") await api("POST", "/api/agents", { content });
    else if (mode.kind === "update") await api("PUT", `/api/agents/${encodeURIComponent(mode.id)}`, { content });
    $("editor").close();
    await loadAgents();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
}

// ---- runs ----
function fmtDuration(ms) {
  if (ms === null || ms === undefined || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function runCard(run) {
  const error = el("p", { class: "error", hidden: true });
  const act = (label, fn) =>
    el("button", {
      class: "btn",
      onclick: async (e) => {
        e.target.disabled = true;
        error.hidden = true;
        try {
          await fn();
          state.lastRunsJson = null;
          await refreshRuns();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          e.target.disabled = false;
        }
      },
    }, label);

  // Running cards are not re-rendered every poll, so only show a duration once the run has ended.
  const end = run.status === "running" ? null : run.endedAt;
  const copyBtn = el("button", { class: "btn" }, "Copy");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(run.attachCommand);
      copyBtn.textContent = "Copied";
    } catch {
      copyBtn.textContent = "Copy failed";
    }
    setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
  });

  return el(
    "div",
    { class: "card" },
    el(
      "div",
      { class: "card-head" },
      el("span", { class: "name" }, run.agent),
      el("span", { class: `badge ${run.status}` }, run.status),
      el("span", { class: "spacer" }),
      el(
        "div",
        { class: "actions" },
        (run.status === "running" || run.status === "finished") && act("Stop", () => api("POST", `/api/runs/${run.runId}/stop`)),
        act("Remove", () => api("DELETE", `/api/runs/${run.runId}`)),
      ),
    ),
    el(
      "div",
      { class: "run-meta" },
      `${run.runId} · ${run.cwd} · started ${new Date(run.startedAt).toLocaleString()}`,
      end ? ` · ${fmtDuration(end - run.startedAt)}` : "",
    ),
    el("div", { class: "attach" }, el("code", {}, run.attachCommand), copyBtn),
    run.finalText && finalTextDetails(run),
    run.status === "missing" && el("p", { class: "muted" }, "Session no longer exists (removed outside the UI)."),
    error,
  );
}

function finalTextDetails(run) {
  // Open by default once finished; afterwards respect the user's own toggle.
  const open = state.detailsOpen.has(run.runId) ? state.detailsOpen.get(run.runId) : run.status === "finished";
  const details = el("details", { class: "final", open: open || undefined }, el("summary", {}, "Final text"), el("pre", {}, run.finalText));
  details.addEventListener("toggle", () => state.detailsOpen.set(run.runId, details.open));
  return details;
}

function renderRuns({ runs, warning }) {
  const children = runs.length ? runs.map(runCard) : [el("p", { class: "muted" }, "No runs yet.")];
  if (warning) children.unshift(el("p", { class: "error" }, warning));
  $("run-list").replaceChildren(...children);
}

async function refreshRuns() {
  // Only the latest call may schedule the next poll, so overlapping calls can't fork extra loops.
  const gen = ++state.pollGen;
  clearTimeout(state.pollTimer);
  let runs = [];
  try {
    const data = await api("GET", "/api/runs");
    runs = data.runs;
    const json = JSON.stringify(data);
    // Re-rendering resets buttons and inline errors, so skip it when nothing changed.
    if (gen === state.pollGen && json !== state.lastRunsJson) {
      state.lastRunsJson = json;
      renderRuns(data);
    }
  } catch (err) {
    state.lastRunsJson = null;
    $("run-list").replaceChildren(el("p", { class: "error" }, `Could not load runs: ${err.message}`));
  }
  if (gen !== state.pollGen) return;
  const anyRunning = runs.some((r) => r.status === "running" || r.status === "unknown");
  state.pollTimer = setTimeout(refreshRuns, anyRunning ? state.config.pollIntervalMs : 15000);
}

// ---- init ----
async function init() {
  state.config = await api("GET", "/api/config");
  $("cwd").value = loadRecent()[0] || state.config.defaultCwd;
  renderRecent();
  initUnattended();
  $("filter").addEventListener("input", renderAgents);
  $("new-agent").addEventListener("click", () => openNew(state.config.template));
  $("editor-cancel").addEventListener("click", () => $("editor").close());
  $("editor-save").addEventListener("click", saveEditor);
  $("editor-copy").addEventListener("click", () => openNew($("editor-content").value));
  $("stop-finished").addEventListener("click", async () => {
    try {
      await api("POST", "/api/runs/stop-finished");
    } catch (err) {
      alert(err.message);
    }
    await refreshRuns();
  });
  await Promise.all([loadAgents(), refreshRuns()]);
}

init().catch((err) => {
  document.body.prepend(el("p", { class: "error" }, `Failed to start: ${err.message}`));
});
