// Detailed, print-ready Alumni Network report. Opens in a new tab; the browser's
// Print dialog turns it into paper or a PDF ("Save as PDF").
import {
  DEPARTMENTS,
  NETWORK_ACTIVITY_FIELDS,
  NETWORK_ACTIVITY_WILLINGNESS,
  NETWORK_CONNECT_STATUS,
  NETWORK_ORIGIN_KINDS,
  NETWORK_PRIORITY,
  PROGRAM_KINDS,
  PROGRAM_STATUS,
  escapeHtml,
} from "./constants.js?v=er37";

const esc = (v) => escapeHtml(v == null ? "" : String(v));
const labelOf = (options, value, fallback = "—") => options.find((o) => o.value === value)?.label || fallback;
const deptLabel = (code) => DEPARTMENTS.find((d) => d.value === code)?.label || code || "—";
const priorityOf = (p, key) => p?.priorities?.[key] || "";
const rankOf = (value) => NETWORK_PRIORITY.find((p) => p.value === value)?.rank || 0;

function millis(value) {
  return value?.toMillis?.() ?? (value?.seconds ? value.seconds * 1000 : value ? new Date(value).getTime() : 0);
}

function fmtDate(value, withTime = false) {
  const ms = typeof value === "number" ? value : millis(value);
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

function fmtProgramDate(value) {
  if (!value) return "Date not set";
  const d = new Date(String(value).length <= 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? String(value) : fmtDate(d.getTime());
}

function inr(amount) {
  const n = Number(amount) || 0;
  return n ? `₹${n.toLocaleString("en-IN")}` : "";
}

function remarksOf(p) {
  return (Array.isArray(p?.remarks) ? [...p.remarks] : []).sort((a, b) => millis(b.at) - millis(a.at));
}

const WILL_TONE = { willing: "good", undecided: "warn", not_willing: "bad", no_response: "muted" };
const RESPONSE_TONE = {
  responded: "good",
  contacted: "warn",
  follow_up: "warn",
  declined: "bad",
  not_contacted: "muted",
  no_response: "muted",
};

function pill(text, tone) {
  return `<span class="pill pill--${tone}">${esc(text)}</span>`;
}

function prioPill(value) {
  if (!value) return "";
  const label = labelOf(NETWORK_PRIORITY, value, "");
  return `<span class="prio prio--${value}">${value === "low" ? "" : "★ "}${esc(label)}</span>`;
}

function summarySection(people, programs, brought) {
  const count = (fn) => people.filter(fn).length;
  const kpis = [
    ["Alumni in network", people.length],
    ["Responded", count((p) => p.connectStatus === "responded")],
    ["Follow up", count((p) => ["follow_up", "contacted"].includes(p.connectStatus))],
    ["Not reached yet", count((p) => !p.connectStatus || ["not_contacted", "no_response"].includes(p.connectStatus))],
    ["Declined", count((p) => p.connectStatus === "declined")],
    ["High priority alumni", count((p) => NETWORK_ACTIVITY_FIELDS.some((f) => priorityOf(p, f.key) === "high"))],
    ["Brought in others", [...brought.values()].filter((l) => l.length).length],
    ["Programmes", programs.length],
  ];
  const rows = NETWORK_ACTIVITY_FIELDS.map((f) => {
    const w = (v) => count((p) => (p[f.key] || "no_response") === v);
    const pr = (v) => count((p) => priorityOf(p, f.key) === v);
    return `<tr>
      <th scope="row">${esc(f.label)}</th>
      <td class="num good">${w("willing")}</td>
      <td class="num warn">${w("undecided")}</td>
      <td class="num bad">${w("not_willing")}</td>
      <td class="num muted">${w("no_response")}</td>
      <td class="num">${pr("high") || ""}</td>
      <td class="num">${pr("medium") || ""}</td>
      <td class="num">${pr("low") || ""}</td>
    </tr>`;
  }).join("");
  return `
    <section class="block">
      <h2>1. Summary</h2>
      <div class="kpis">${kpis.map(([l, v]) => `<div class="kpi"><b>${v}</b><span>${esc(l)}</span></div>`).join("")}</div>
      <h3>Support from alumni</h3>
      <table class="grid">
        <thead>
          <tr><th>Support</th><th>Willing</th><th>Maybe</th><th>Not willing</th><th>No reply</th><th>★ High</th><th>★ Medium</th><th>Low</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="note">Willingness is what the alumni told us. Priority is our own judgement of who to pursue first for that support.</p>
    </section>`;
}

function actionSection(people) {
  const groups = NETWORK_ACTIVITY_FIELDS.map((f) => {
    const list = people
      .filter((p) => rankOf(priorityOf(p, f.key)) >= 2)
      .sort((a, b) => rankOf(priorityOf(b, f.key)) - rankOf(priorityOf(a, f.key)) || String(a.alumniName).localeCompare(String(b.alumniName)));
    if (!list.length) return "";
    return `
      <div class="action">
        <h3>${esc(f.label)} <small>${list.length}</small></h3>
        <table class="grid compact">
          <thead><tr><th>Priority</th><th>Alumni</th><th>Willingness</th><th>Phone</th><th>Works at</th></tr></thead>
          <tbody>${list
            .map(
              (p) => `<tr>
                <td>${prioPill(priorityOf(p, f.key))}</td>
                <td><b>${esc(p.alumniName)}</b><br><small>${esc(deptLabel(p.department))} · ${esc(p.batch || "—")}</small></td>
                <td>${pill(labelOf(NETWORK_ACTIVITY_WILLINGNESS, p[f.key] || "no_response"), WILL_TONE[p[f.key] || "no_response"])}</td>
                <td>${esc(p.whatsapp || p.mobile || "—")}</td>
                <td>${esc([p.jobRole, p.company].filter(Boolean).join(", ") || p.jobSector || "—")}</td>
              </tr>`
            )
            .join("")}</tbody>
        </table>
      </div>`;
  }).join("");
  return `
    <section class="block">
      <h2>2. Who to pursue first</h2>
      <p class="note">Alumni marked High or Medium priority, by support.</p>
      ${groups || '<p class="empty">No priorities have been marked yet.</p>'}
    </section>`;
}

function connectorSection(people, brought) {
  const list = people
    .map((p) => ({ p, others: brought.get(p.id) || [] }))
    .filter((x) => x.others.length || (x.p.connectorWillingness || "") === "willing" || priorityOf(x.p, "connectorWillingness"))
    .sort((a, b) => b.others.length - a.others.length || String(a.p.alumniName).localeCompare(String(b.p.alumniName)));
  return `
    <section class="block">
      <h2>3. Alumni connectors</h2>
      <p class="note">People who have brought others into the network, or who are willing to.</p>
      ${
        list.length
          ? `<table class="grid compact">
              <thead><tr><th>Alumni</th><th>Brought in</th><th>Connector</th><th>Who they brought in</th></tr></thead>
              <tbody>${list
                .map(
                  ({ p, others }) => `<tr>
                    <td><b>${esc(p.alumniName)}</b><br><small>${esc(p.whatsapp || p.mobile || "")}</small></td>
                    <td class="num"><b>${others.length}</b></td>
                    <td>${pill(labelOf(NETWORK_ACTIVITY_WILLINGNESS, p.connectorWillingness || "no_response"), WILL_TONE[p.connectorWillingness || "no_response"])} ${prioPill(priorityOf(p, "connectorWillingness"))}</td>
                    <td>${esc(others.map((o) => o.alumniName).join(", ") || "—")}</td>
                  </tr>`
                )
                .join("")}</tbody>
            </table>`
          : '<p class="empty">No connectors yet.</p>'
      }
    </section>`;
}

function programmesSection(programs) {
  const byKind = PROGRAM_KINDS.map((k) => {
    const rows = programs.filter((p) => p.kind === k.value);
    if (!rows.length) return "";
    const c = (s) => rows.filter((p) => p.status === s).length;
    const amount = rows.reduce((n, p) => n + (Number(p.amount) || 0), 0);
    return `<tr><th scope="row">${esc(k.label)}</th><td class="num">${rows.length}</td><td class="num">${c("planned")}</td><td class="num">${c("confirmed")}</td><td class="num">${c("completed")}</td><td class="num">${c("cancelled")}</td><td class="num">${inr(amount) || "—"}</td></tr>`;
  }).join("");
  const list = [...programs].sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")));
  return `
    <section class="block">
      <h2>4. Programmes</h2>
      ${
        programs.length
          ? `<table class="grid compact">
              <thead><tr><th>Type</th><th>Total</th><th>Planned</th><th>Confirmed</th><th>Completed</th><th>Cancelled</th><th>Amount</th></tr></thead>
              <tbody>${byKind}</tbody>
            </table>
            <h3>All programmes</h3>
            <table class="grid compact">
              <thead><tr><th>Date</th><th>Programme</th><th>Type</th><th>Alumni</th><th>Venue</th><th>Status</th><th>Amount</th></tr></thead>
              <tbody>${list
                .map(
                  (p) => `<tr>
                    <td>${esc(fmtProgramDate(p.date))}</td>
                    <td><b>${esc(p.title || "—")}</b>${p.notes ? `<br><small>${esc(p.notes)}</small>` : ""}</td>
                    <td>${esc(labelOf(PROGRAM_KINDS, p.kind))}</td>
                    <td>${esc(p.alumniName || "—")}</td>
                    <td>${esc(p.venue || "—")}</td>
                    <td>${esc(labelOf(PROGRAM_STATUS, p.status))}</td>
                    <td class="num">${inr(p.amount) || "—"}</td>
                  </tr>`
                )
                .join("")}</tbody>
            </table>`
          : '<p class="empty">No programmes recorded yet.</p>'
      }
    </section>`;
}

function profileCard(p, index, { brought, programs }) {
  const others = brought.get(p.id) || [];
  const progs = programs.filter((x) => x.alumniId === p.id);
  const remarks = remarksOf(p);
  const response = p.connectStatus || "not_contacted";
  const fact = (label, value) => (value ? `<div class="fact"><span>${esc(label)}</span><b>${esc(value)}</b></div>` : "");
  return `
    <article class="card">
      <header class="card__head">
        <div>
          <span class="card__no">${index}</span>
          <h3>${esc(p.alumniName || "—")}</h3>
          <p>${esc(deptLabel(p.department))} · Passout ${esc(p.batch || "—")}</p>
        </div>
        <div class="card__status">${pill(labelOf(NETWORK_CONNECT_STATUS, response), RESPONSE_TONE[response] || "muted")}</div>
      </header>
      <div class="facts">
        ${fact("Phone / WhatsApp", p.whatsapp || p.mobile)}
        ${fact("Email", p.email)}
        ${fact("Role", p.jobRole)}
        ${fact("Company", p.company)}
        ${fact("Sector", p.jobSector)}
        ${fact("Address", p.address)}
        ${fact("Source", labelOf(NETWORK_ORIGIN_KINDS, p.originKind))}
        ${fact("Connected via", [p.referredByName, p.referredByPhone].filter(Boolean).join(" · "))}
        ${fact("Brought in", others.length ? `${others.length}: ${others.map((o) => o.alumniName).join(", ")}` : "")}
        ${fact("Added by", p.createdByName)}
      </div>
      <table class="supports">
        <thead><tr>${NETWORK_ACTIVITY_FIELDS.map((f) => `<th>${esc(f.short)}</th>`).join("")}</tr></thead>
        <tbody><tr>${NETWORK_ACTIVITY_FIELDS.map((f) => {
          const v = p[f.key] || "no_response";
          return `<td>${pill(labelOf(NETWORK_ACTIVITY_WILLINGNESS, v), WILL_TONE[v])}${priorityOf(p, f.key) ? `<div>${prioPill(priorityOf(p, f.key))}</div>` : ""}</td>`;
        }).join("")}</tr></tbody>
      </table>
      ${
        progs.length
          ? `<div class="sub"><h4>Programmes</h4><ul>${progs
              .map(
                (x) => `<li><b>${esc(x.title || labelOf(PROGRAM_KINDS, x.kind))}</b> — ${esc(labelOf(PROGRAM_KINDS, x.kind))}, ${esc(fmtProgramDate(x.date))}${x.venue ? `, ${esc(x.venue)}` : ""} · ${esc(labelOf(PROGRAM_STATUS, x.status))}${inr(x.amount) ? ` · ${inr(x.amount)}` : ""}</li>`
              )
              .join("")}</ul></div>`
          : ""
      }
      ${
        remarks.length || p.notes
          ? `<div class="sub"><h4>Remarks</h4><ul class="remarks">${remarks
              .map((r) => `<li><span>${esc([fmtDate(r.at, true), r.byName].filter(Boolean).join(" · "))}</span>${esc(r.text)}</li>`)
              .join("")}${p.notes ? `<li><span>Notes</span>${esc(p.notes)}</li>` : ""}</ul></div>`
          : ""
      }
    </article>`;
}

const STYLES = `
  :root { --ink:#1f1a2e; --muted:#6b6880; --line:#e4e0ee; --brand:#4b1d6b; --brand-2:#7a3fa0; --soft:#f6f3fb; --gold:#c9a227; }
  * { box-sizing: border-box; }
  html, body { background:#fff; }
  body { margin:0; font: 10.5pt/1.45 "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif; color:var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { max-width: 190mm; margin: 0 auto; padding: 14mm 0 18mm; }
  .toolbar { position: sticky; top: 0; z-index: 2; display:flex; gap:10px; align-items:center; justify-content:space-between; padding:10px 16px; background:var(--brand); color:#fff; font-size:10pt; }
  .toolbar button { font: inherit; font-weight:600; padding:8px 16px; border-radius:8px; border:0; background:#fff; color:var(--brand); cursor:pointer; }
  .toolbar span { opacity:.85; }
  .cover { display:flex; align-items:center; gap:14px; padding-bottom:10px; border-bottom:3px solid var(--gold); }
  .cover img { width:54px; height:54px; object-fit:contain; }
  .cover small { display:block; letter-spacing:.12em; font-size:8pt; font-weight:700; color:var(--gold); }
  .cover h1 { margin:2px 0 0; font-size:19pt; color:var(--brand); }
  .meta { display:flex; flex-wrap:wrap; gap:4px 18px; margin:10px 0 4px; font-size:9pt; color:var(--muted); }
  .meta b { color:var(--ink); font-weight:600; }
  h2 { margin:0 0 8px; font-size:13pt; color:var(--brand); }
  h3 { margin:12px 0 6px; font-size:10.5pt; }
  h3 small { font-weight:600; color:var(--muted); }
  .block { margin-top:16px; }
  .note { margin:6px 0 0; font-size:8.5pt; color:var(--muted); }
  .empty { color:var(--muted); font-style:italic; }
  .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; }
  .kpi { padding:7px 9px; border:1px solid var(--line); border-radius:8px; background:var(--soft); }
  .kpi b { display:block; font-size:15pt; color:var(--brand); line-height:1.1; }
  .kpi span { font-size:8.5pt; color:var(--muted); }
  table { width:100%; border-collapse:collapse; }
  .grid th, .grid td { padding:5px 7px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
  .grid thead th { background:var(--brand); color:#fff; font-size:8.5pt; font-weight:600; border:0; }
  .grid tbody th { font-weight:600; }
  .grid.compact th, .grid.compact td { padding:4px 6px; font-size:9pt; }
  .grid small, .card small { color:var(--muted); }
  .num { text-align:right !important; font-variant-numeric: tabular-nums; }
  td.good { color:#166534; font-weight:600; } td.warn { color:#9a3412; } td.bad { color:#991b1b; } td.muted { color:var(--muted); }
  .action { break-inside: avoid; }
  .pill { display:inline-block; padding:1px 7px; border-radius:999px; font-size:8pt; font-weight:600; white-space:nowrap; border:1px solid transparent; }
  .pill--good { background:#dcfce7; color:#166534; border-color:#86efac; }
  .pill--warn { background:#ffedd5; color:#9a3412; border-color:#fdba74; }
  .pill--bad { background:#fee2e2; color:#991b1b; border-color:#fca5a5; }
  .pill--muted { background:#f1f5f9; color:#475569; border-color:#cbd5e1; }
  .prio { display:inline-block; margin-top:3px; padding:1px 7px; border-radius:999px; font-size:7.8pt; font-weight:700; white-space:nowrap; }
  .prio--high { background:var(--brand); color:#fff; }
  .prio--medium { background:#efe6f7; color:var(--brand); }
  .prio--low { background:#fff; color:var(--muted); border:1px solid var(--line); }
  .profiles-title { break-before: page; }
  .card { break-inside: avoid; margin:0 0 10px; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .card__head { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; padding:8px 12px; background:var(--soft); border-bottom:1px solid var(--line); }
  .card__head h3 { display:inline; margin:0; font-size:12pt; }
  .card__head p { margin:2px 0 0; font-size:9pt; color:var(--muted); }
  .card__no { display:inline-block; min-width:22px; margin-right:6px; padding:1px 6px; border-radius:6px; background:var(--brand); color:#fff; font-size:8pt; font-weight:700; text-align:center; vertical-align:2px; }
  .facts { display:grid; grid-template-columns:repeat(2,1fr); gap:3px 16px; padding:8px 12px 4px; }
  .fact { display:flex; gap:8px; font-size:9pt; }
  .fact span { flex:0 0 100px; color:var(--muted); }
  .fact b { font-weight:500; overflow-wrap:anywhere; }
  .supports { margin:6px 12px 8px; width:calc(100% - 24px); table-layout:fixed; }
  .supports th { font-size:8pt; font-weight:600; color:var(--muted); text-align:left; padding:2px 3px; }
  .supports td { padding:2px 3px; vertical-align:top; }
  .sub { padding:0 12px 8px; }
  .sub h4 { margin:4px 0 3px; font-size:9pt; color:var(--brand); }
  .sub ul { margin:0; padding-left:16px; font-size:9pt; }
  .remarks { list-style:none; padding-left:0 !important; }
  .remarks li { padding:3px 0 3px 8px; border-left:2px solid var(--gold); margin-bottom:3px; white-space:pre-wrap; }
  .remarks span { display:block; font-size:8pt; color:var(--muted); }
  .sign { margin-top:24px; display:grid; grid-template-columns:1fr 1fr; gap:40px; font-size:9pt; color:var(--muted); break-inside: avoid; }
  .sign div { padding-top:28px; border-top:1px solid var(--ink); }
  .end { margin-top:14px; font-size:8pt; color:var(--muted); text-align:center; }
  @page { size: A4; margin: 12mm 10mm 14mm; }
  @media print {
    .toolbar { display:none; }
    .page { padding:0; max-width:none; }
  }
  @media screen and (max-width: 720px) {
    .page { padding: 16px; }
    .kpis { grid-template-columns:repeat(2,1fr); }
    .facts { grid-template-columns:1fr; }
  }
`;

/**
 * Build the report HTML.
 * @param {object} opts
 * @param {object[]} opts.people  network alumni to include, in the order to print
 * @param {object[]} opts.allPeople  whole network (for "brought in" names)
 * @param {object[]} opts.programs  all programmes
 * @param {Map} opts.brought  network id -> people they brought in
 * @param {string} opts.filtersText  human description of the filters, or ""
 * @param {string} opts.generatedBy
 */
export function networkReportHtml({ people, programs = [], brought = new Map(), filtersText = "", generatedBy = "", embedded = false }) {
  const ids = new Set(people.map((p) => p.id));
  const scopedPrograms = filtersText ? programs.filter((x) => !x.alumniId || ids.has(x.alumniId)) : programs;
  const logo = new URL("../assets/legeci-logo.png", import.meta.url).href;
  const now = new Date();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Alumni Network Report — ${esc(fmtDate(now.getTime()))}</title>
<style>${STYLES}</style>
</head>
<body>
  ${
    embedded
      ? ""
      : `<div class="toolbar">
    <span>${people.length} alumni · use Print and choose "Save as PDF" to keep a copy</span>
    <button type="button" onclick="window.print()">Print / Save as PDF</button>
  </div>`
  }
  <main class="page">
    <header class="cover">
      <img src="${esc(logo)}" alt="" onerror="this.remove()">
      <div>
        <small>GECIAN ALUMNI NETWORK · LEGECI</small>
        <h1>Alumni Network Report</h1>
      </div>
    </header>
    <div class="meta">
      <span>Generated <b>${esc(fmtDate(now.getTime(), true))}</b></span>
      ${generatedBy ? `<span>By <b>${esc(generatedBy)}</b></span>` : ""}
      <span>Alumni in this report <b>${people.length}</b></span>
      <span>Filters <b>${esc(filtersText || "None — whole network")}</b></span>
    </div>
    ${summarySection(people, scopedPrograms, new Map([...brought].filter(([id]) => ids.has(id))))}
    ${actionSection(people)}
    ${connectorSection(people, brought)}
    ${programmesSection(scopedPrograms)}
    <section class="block profiles-title">
      <h2>5. Alumni profiles</h2>
      <p class="note">Full details for each alumni: contact, work, how we are connected, support and priority, programmes, and every remark with its date.</p>
    </section>
    ${people.map((p, i) => profileCard(p, i + 1, { brought, programs })).join("") || '<p class="empty">No alumni match these filters.</p>'}
    <div class="sign">
      <div>Prepared by</div>
      <div>Reviewed by</div>
    </div>
    <p class="end">GECIAN Alumni Network · Government Engineering College Idukki · Confidential: contains alumni contact details</p>
  </main>
</body>
</html>`;
}

const OVERLAY_STYLES = `
  .anr-overlay { position: fixed; inset: 0; z-index: 9999; display: flex; flex-direction: column; background: rgba(20, 12, 32, 0.72); }
  .anr-bar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: #4b1d6b; color: #fff; font: 600 14px/1.3 system-ui, "Segoe UI", sans-serif; }
  .anr-bar span { flex: 1; min-width: 0; font-weight: 500; opacity: .9; }
  .anr-bar button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,.5); background: transparent; color: #fff; cursor: pointer; }
  .anr-bar button.anr-primary { background: #fff; color: #4b1d6b; border-color: #fff; }
  .anr-frame { flex: 1; width: 100%; border: 0; background: #fff; }
  @media (max-width: 640px) { .anr-bar span { display: none; } }
`;

/**
 * Show the report as a full-screen preview on this page (no pop-up to block),
 * with Print / Save as PDF and Close. Printing prints only the report.
 */
export function openNetworkReport(opts) {
  document.querySelector(".anr-overlay")?.remove();
  if (!document.getElementById("anrStyles")) {
    const style = document.createElement("style");
    style.id = "anrStyles";
    style.textContent = OVERLAY_STYLES;
    document.head.appendChild(style);
  }
  const overlay = document.createElement("div");
  overlay.className = "anr-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Alumni Network report preview");
  overlay.innerHTML = `
    <div class="anr-bar">
      <span>Alumni Network report · ${opts.people.length} alumni · choose "Save as PDF" in the print dialog to keep a copy</span>
      <button type="button" class="anr-primary" data-anr-print>Print / Save as PDF</button>
      <button type="button" data-anr-close>Close</button>
    </div>
    <iframe class="anr-frame" title="Alumni Network report"></iframe>`;
  const frame = overlay.querySelector("iframe");
  frame.srcdoc = networkReportHtml({ ...opts, embedded: true });
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = prevOverflow;
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  overlay.querySelector("[data-anr-close]").addEventListener("click", close);
  overlay.querySelector("[data-anr-print]").addEventListener("click", () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  overlay.querySelector("[data-anr-print]").focus();
  return true;
}
