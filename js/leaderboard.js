import { jsPDF } from "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm";
import { autoTable } from "https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.2/+esm";
import {
  DEPARTMENTS,
  MEETUP_NAME,
  escapeHtml,
  showToast,
} from "./constants.js";
import {
  loadAllAlumniContacts,
  buildLeaderboardData,
  summarizeContacts,
} from "./alumni-connect.js";

const SCORE_HINT =
  "Score = contacted×1 + willing×2 + registered×3 + paid×5";

let cachedBoard = null;
let activeTab = "departments";
let scopeDepartment = null;
let eventsBound = false;

export async function loadLeaderboardPanel(
  wrap,
  { toast, enrichVolunteers, department = null } = {}
) {
  if (!wrap) return;
  wrap.innerHTML = '<p class="empty-state">Loading leaderboard…</p>';
  try {
    scopeDepartment = department || null;
    if (scopeDepartment) activeTab = "students";
    else if (activeTab !== "students" && activeTab !== "departments") activeTab = "departments";

    let contacts = await loadAllAlumniContacts();
    if (typeof enrichVolunteers === "function") {
      contacts = await enrichVolunteers(contacts);
    }
    if (scopeDepartment) {
      contacts = contacts.filter((c) => (c.department || "") === scopeDepartment);
    }
    cachedBoard = buildLeaderboardData(contacts, DEPARTMENTS);
    renderLeaderboard(wrap, toast);
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Failed to load leaderboard.</p>';
  }
}

function scopeLabel() {
  if (!scopeDepartment) return "";
  return (
    DEPARTMENTS.find((d) => d.value === scopeDepartment)?.label || scopeDepartment
  );
}

function renderLeaderboard(wrap, toast) {
  const board = cachedBoard || {
    stats: summarizeContacts([]),
    departments: [],
    volunteers: [],
  };
  const deptScoped = !!scopeDepartment;
  if (deptScoped) activeTab = "students";
  const rows = activeTab === "students" ? board.volunteers : board.departments;
  const modeLabel = activeTab === "students" ? "Students" : "Departments";
  const title = deptScoped ? `${scopeLabel()} Leaderboard` : "Leaderboard";
  const subtitle = deptScoped
    ? `Volunteer standings in your department. ${SCORE_HINT}`
    : `Who is crushing outreach right now. ${SCORE_HINT}`;

  wrap.innerHTML = `
    <div class="lb">
      <div class="lb-hero">
        <div class="lb-hero__glow" aria-hidden="true"></div>
        <div class="lb-hero__content">
          <p class="lb-hero__eyebrow">${escapeHtml(MEETUP_NAME || "LEGECI")} · Alumni Connect${
            deptScoped ? ` · ${escapeHtml(scopeDepartment)}` : ""
          }</p>
          <h2 class="lb-hero__title">${escapeHtml(title)}</h2>
          <p class="lb-hero__sub">${escapeHtml(subtitle)}</p>
          <div class="lb-hero__stats">
            <div class="lb-chip"><span>${board.stats.total}</span> contacted</div>
            <div class="lb-chip lb-chip--good"><span>${board.stats.willing}</span> willing</div>
            <div class="lb-chip lb-chip--gold"><span>${board.stats.paid}</span> paid</div>
          </div>
          <div class="lb-hero__actions">
            ${
              deptScoped
                ? `<div class="lb-tabs" role="tablist">
              <button type="button" class="lb-tab lb-tab--active" data-lb-tab="students" role="tab">Department volunteers</button>
            </div>`
                : `<div class="lb-tabs" role="tablist">
              <button type="button" class="lb-tab ${activeTab === "departments" ? "lb-tab--active" : ""}" data-lb-tab="departments" role="tab">Departments</button>
              <button type="button" class="lb-tab ${activeTab === "students" ? "lb-tab--active" : ""}" data-lb-tab="students" role="tab">Students</button>
            </div>
            <button type="button" class="btn btn--primary lb-pdf-btn" id="lbGeneratePdf">Generate PDF</button>`
            }
          </div>
        </div>
      </div>

      <div class="lb-section">
        <h3 class="lb-section__title">Top ${escapeHtml(deptScoped ? "volunteers" : modeLabel)}</h3>
        ${podiumHtml(rows.slice(0, 3), activeTab)}
      </div>

      <div class="lb-section">
        <h3 class="lb-section__title">Full rankings</h3>
        ${rankListHtml(rows, activeTab)}
      </div>

      <div class="lb-section">
        <h3 class="lb-section__title">Leader details</h3>
        <p class="form-hint" style="margin-top:0;margin-bottom:1rem;">
          Breakdown for the current ${escapeHtml(
            deptScoped ? "volunteer" : modeLabel.toLowerCase()
          )} standings — department, volunteer, and conversion counts.
        </p>
        ${detailTableHtml(rows, activeTab)}
      </div>
    </div>`;

  if (!eventsBound) {
    eventsBound = true;
    wrap.addEventListener("click", async (e) => {
      const tabBtn = e.target.closest("[data-lb-tab]");
      if (tabBtn) {
        if (scopeDepartment) {
          activeTab = "students";
        } else {
          activeTab = tabBtn.dataset.lbTab === "students" ? "students" : "departments";
        }
        renderLeaderboard(wrap, toast);
        return;
      }
      if (e.target.id === "lbGeneratePdf" || e.target.closest("#lbGeneratePdf")) {
        const btn = wrap.querySelector("#lbGeneratePdf");
        try {
          if (btn) {
            btn.disabled = true;
            btn.textContent = "Generating…";
          }
          await downloadLeaderboardPdf(cachedBoard, {
            department: scopeDepartment,
            departmentLabel: scopeLabel(),
          });
          showToast(toast, "Leaderboard PDF downloaded.", "success");
        } catch (err) {
          console.error(err);
          showToast(toast, "Could not generate PDF.", "error");
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Generate PDF";
          }
        }
      }
    });
  }
}

function displayName(row, mode) {
  if (mode === "students") return row.name || row.label || "Volunteer";
  return row.label || row.department || "Department";
}

function podiumHtml(top, mode) {
  if (!top.length) {
    return '<p class="empty-state">No contacts yet — the race has not started.</p>';
  }

  const slots = [
    { row: top[1], place: 2, height: "md" },
    { row: top[0], place: 1, height: "lg" },
    { row: top[2], place: 3, height: "sm" },
  ].filter((s) => s.row);

  const ordered =
    top.length >= 3
      ? slots
      : top.map((row, i) => ({
          row,
          place: i + 1,
          height: i === 0 ? "lg" : i === 1 ? "md" : "sm",
        }));

  return `
    <div class="lb-podium ${top.length < 3 ? "lb-podium--compact" : ""}">
      ${ordered
        .map(({ row, place, height }) => {
          const name = displayName(row, mode);
          const sub =
            mode === "students"
              ? `${row.department || "—"}${row.team ? ` · ${row.team}` : ""}`
              : `${row.total} contacts`;
          return `
          <article class="lb-podium__card lb-podium__card--${place} lb-podium__card--h-${height}">
            <div class="lb-podium__rank">#${place}</div>
            <div class="lb-podium__name">${escapeHtml(name)}</div>
            <div class="lb-podium__sub">${escapeHtml(sub)}</div>
            <div class="lb-podium__score">${row.score}<span>pts</span></div>
            <div class="lb-podium__meta">
              <span>${row.willing} willing</span>
              <span>${row.paid} paid</span>
            </div>
          </article>`;
        })
        .join("")}
    </div>`;
}

function rankListHtml(rows, mode) {
  if (rows.length <= 3) {
    return rows.length
      ? '<p class="form-hint">Only top finishers so far — keep pushing.</p>'
      : "";
  }
  const rest = rows.slice(3);
  return `
    <ol class="lb-ranklist" start="4">
      ${rest
        .map((row) => {
          const name = displayName(row, mode);
          const sub =
            mode === "students"
              ? `${row.department || "—"}${row.team ? ` · ${row.team}` : ""}`
              : `${row.total} contacted`;
          return `
        <li class="lb-ranklist__item">
          <span class="lb-ranklist__rank">#${row.rank}</span>
          <div class="lb-ranklist__body">
            <strong>${escapeHtml(name)}</strong>
            <small>${escapeHtml(sub)}</small>
          </div>
          <div class="lb-ranklist__nums">
            <span>${row.willing}W</span>
            <span>${row.paid}P</span>
            <span class="lb-ranklist__score">${row.score}</span>
          </div>
        </li>`;
        })
        .join("")}
    </ol>`;
}

function detailTableHtml(rows, mode) {
  if (!rows.length) {
    return '<p class="empty-state">No leader details yet.</p>';
  }

  const isStudents = mode === "students";
  return `
    <div class="table-scroll">
      <table class="data-table lb-detail-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>${isStudents ? "Student" : "Department"}</th>
            ${isStudents ? "<th>Department</th><th>Team</th>" : "<th>Code</th>"}
            <th>Contacted</th>
            <th>Willing</th>
            <th>Registered</th>
            <th>Paid</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => {
              const highlight = row.rank <= 3 ? ` class="lb-detail-row--top"` : "";
              return `
            <tr${highlight}>
              <td><strong>#${row.rank}</strong></td>
              <td>${escapeHtml(displayName(row, mode))}</td>
              ${
                isStudents
                  ? `<td>${escapeHtml(row.department || "—")}</td>
                     <td>${escapeHtml(row.team || "—")}</td>`
                  : `<td>${escapeHtml(row.department || "—")}</td>`
              }
              <td>${row.total}</td>
              <td>${row.willing}</td>
              <td>${row.registered}</td>
              <td>${row.paid}</td>
              <td><strong>${row.score}</strong></td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function formatPdfDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatPdfDateLong(d = new Date()) {
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const PDF = {
  navy: [18, 18, 42],
  gold: [212, 175, 55],
  goldSoft: [255, 243, 205],
  cream: [252, 248, 240],
  ink: [30, 30, 50],
  muted: [100, 100, 120],
  white: [255, 255, 255],
  green: [22, 163, 74],
  greenBg: [220, 252, 231],
  teal: [13, 148, 136],
  tealBg: [204, 251, 241],
  silver: [226, 232, 240],
  bronze: [254, 243, 226],
  bronzeInk: [154, 52, 18],
};

function pdfRoundedRect(doc, x, y, w, h, r, style = "F") {
  const radius = Math.min(r, w / 2, h / 2);
  doc.roundedRect(x, y, w, h, radius, radius, style);
}

function pdfEnsureSpace(doc, y, need, margin) {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + need > pageH - 18) {
    doc.addPage();
    return margin;
  }
  return y;
}

function pdfDrawPageChrome(doc, pageW, pageH, margin, dateStr, pageIndex, pageCount) {
  if (pageIndex > 1) {
    doc.setFillColor(...PDF.navy);
    doc.rect(0, 0, pageW, 8, "F");
    doc.setFillColor(...PDF.gold);
    doc.rect(0, 8, pageW, 1.2, "F");
  }
  doc.setFillColor(...PDF.cream);
  doc.rect(0, pageH - 12, pageW, 12, "F");
  doc.setFillColor(...PDF.gold);
  doc.rect(0, pageH - 12, pageW, 1, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF.muted);
  doc.text(`${MEETUP_NAME || "LEGECI"} · Alumni Connect · ${dateStr}`, margin, pageH - 5);
  doc.text(`${pageIndex} / ${pageCount}`, pageW - margin, pageH - 5, { align: "right" });
}

function pdfStatCard(doc, x, y, w, h, label, value, fill, ink) {
  doc.setFillColor(...fill);
  pdfRoundedRect(doc, x, y, w, h, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...ink);
  doc.text(String(value), x + w / 2, y + 11, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF.muted);
  doc.text(label.toUpperCase(), x + w / 2, y + 17.5, { align: "center" });
}

function pdfChampionCard(doc, x, y, w, h, badge, title, name, meta, score) {
  doc.setFillColor(...PDF.navy);
  pdfRoundedRect(doc, x, y, w, h, 4, "F");
  doc.setFillColor(...PDF.gold);
  pdfRoundedRect(doc, x + 4, y + 4, 18, 8, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...PDF.navy);
  doc.text(badge, x + 13, y + 9.2, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(180, 180, 200);
  doc.text(title.toUpperCase(), x + 26, y + 9);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...PDF.white);
  const nameLines = doc.splitTextToSize(name, w - 16);
  doc.text(nameLines.slice(0, 2), x + 6, y + 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(190, 190, 210);
  const metaLines = doc.splitTextToSize(meta, w - 16);
  doc.text(metaLines.slice(0, 2), x + 6, y + 28);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...PDF.gold);
  doc.text(String(score), x + 6, y + h - 6);
  doc.setFontSize(7);
  doc.setTextColor(200, 180, 100);
  doc.text("PTS", x + 6 + doc.getTextWidth(String(score)) + 2, y + h - 6);
}

function pdfSectionTitle(doc, margin, y, title, subtitle) {
  doc.setFillColor(...PDF.gold);
  doc.rect(margin, y - 4, 3, 10, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...PDF.navy);
  doc.text(title, margin + 6, y + 3);
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF.muted);
    doc.text(subtitle, margin + 6, y + 8);
    return y + 14;
  }
  return y + 8;
}

function pdfRankLabel(rank) {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return `#${rank}`;
}

function pdfStyleTopRows(hook, hasData) {
  if (hook.section !== "body" || !hasData) return;
  const i = hook.row.index;
  if (i === 0) {
    hook.cell.styles.fillColor = PDF.goldSoft;
    hook.cell.styles.fontStyle = "bold";
    hook.cell.styles.textColor = PDF.navy;
  } else if (i === 1) {
    hook.cell.styles.fillColor = PDF.silver;
    hook.cell.styles.fontStyle = "bold";
  } else if (i === 2) {
    hook.cell.styles.fillColor = PDF.bronze;
    hook.cell.styles.fontStyle = "bold";
    hook.cell.styles.textColor = PDF.bronzeInk;
  }
  if (hook.column.index === 0 && i < 3) {
    hook.cell.styles.halign = "center";
  }
  if (hook.column.index === 7) {
    hook.cell.styles.fontStyle = "bold";
    if (i === 0) hook.cell.styles.textColor = [146, 64, 14];
  }
}

function pdfDrawMiniPodium(doc, rows, mode, startX, y, pw) {
  const widths = [pw * 0.28, pw * 0.36, pw * 0.28];
  const heights = [18, 24, 14];
  const fills = [PDF.silver, PDF.goldSoft, PDF.bronze];
  const baseline = y + 26;
  let px = startX;
  const order = [
    { row: rows[1], place: 2, w: widths[0], h: heights[0], fill: fills[0] },
    { row: rows[0], place: 1, w: widths[1], h: heights[1], fill: fills[1] },
    { row: rows[2], place: 3, w: widths[2], h: heights[2], fill: fills[2] },
  ];
  order.forEach((slot) => {
    if (!slot.row) {
      px += slot.w + 2;
      return;
    }
    const top = baseline - slot.h;
    doc.setFillColor(...slot.fill);
    pdfRoundedRect(doc, px, top, slot.w - 2, slot.h, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...PDF.navy);
    const label =
      mode === "dept"
        ? slot.row.department || slot.row.label || "—"
        : (slot.row.name || "—").split(" ")[0];
    doc.text(`#${slot.place} ${label}`.slice(0, 14), px + (slot.w - 2) / 2, top + slot.h / 2 + 1, {
      align: "center",
    });
    px += slot.w + 2;
  });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF.muted);
  doc.text(mode === "dept" ? "Departments" : "Students", startX + pw / 2, y + 4, {
    align: "center",
  });
}

export async function downloadLeaderboardPdf(board, { department = null, departmentLabel = "" } = {}) {
  const data = board || cachedBoard;
  if (!data) throw new Error("No leaderboard data");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;
  const dateStr = formatPdfDate();
  const dateLong = formatPdfDateLong();
  const stats = data.stats || summarizeContacts([]);
  const topDept = data.departments?.[0];
  const topVol = data.volunteers?.[0];
  const top3Dept = (data.departments || []).slice(0, 3);
  const top3Vol = (data.volunteers || []).slice(0, 3);
  const reportTitle = department
    ? `${departmentLabel || department} Leaderboard`
    : "Leaderboard Report";

  // Hero header
  doc.setFillColor(...PDF.navy);
  doc.rect(0, 0, pageW, 48, "F");
  doc.setFillColor(...PDF.gold);
  doc.rect(0, 48, pageW, 2.5, "F");
  doc.setFillColor(14, 116, 144);
  doc.rect(0, 0, 4, 48, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...PDF.gold);
  doc.text(`${(MEETUP_NAME || "LEGECI").toUpperCase()}  ·  THE LEGACY CONTINUES`, margin, 12);

  doc.setFontSize(22);
  doc.setTextColor(...PDF.white);
  doc.text("Alumni Connect", margin, 24);
  doc.setFontSize(14);
  doc.setTextColor(...PDF.gold);
  doc.text(reportTitle, margin, 32);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(190, 190, 210);
  doc.text(`Dropped ${dateLong}`, margin, 41);
  doc.text("Who is leading the race", pageW - margin, 41, { align: "right" });

  let y = 58;

  // Live pulse stats
  y = pdfSectionTitle(doc, margin, y, "Live pulse", "Campus-wide Alumni Connect energy");
  const cardW = (contentW - 9) / 4;
  const cardH = 22;
  const cards = [
    { label: "Contacted", value: stats.total, fill: PDF.cream, ink: PDF.navy },
    { label: "Willing", value: stats.willing, fill: PDF.greenBg, ink: PDF.green },
    { label: "Registered", value: stats.registered, fill: PDF.tealBg, ink: PDF.teal },
    { label: "Paid", value: stats.paid, fill: PDF.goldSoft, ink: [146, 64, 14] },
  ];
  cards.forEach((c, i) => {
    pdfStatCard(doc, margin + i * (cardW + 3), y, cardW, cardH, c.label, c.value, c.fill, c.ink);
  });
  y += cardH + 8;

  doc.setFillColor(245, 245, 250);
  pdfRoundedRect(doc, margin, y, contentW, 10, 2, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF.muted);
  doc.text(`Scoring  ·  ${SCORE_HINT}`, margin + 4, y + 6.5);
  y += 16;

  // Champions
  y = pdfSectionTitle(doc, margin, y, "Champions", "Top department + top student volunteer");
  const champW = (contentW - 4) / 2;
  const champH = 42;
  pdfChampionCard(
    doc,
    margin,
    y,
    champW,
    champH,
    "#1 DEPT",
    "Department crown",
    topDept ? topDept.label || topDept.department : "Waiting for a champ",
    topDept
      ? `${topDept.total} contacted · ${topDept.willing} willing · ${topDept.paid} paid`
      : "No department data yet",
    topDept?.score ?? 0
  );
  pdfChampionCard(
    doc,
    margin + champW + 4,
    y,
    champW,
    champH,
    "#1 STUDENT",
    "Volunteer crown",
    topVol ? topVol.name : "Waiting for a champ",
    topVol
      ? `${topVol.department || "—"}${topVol.team ? ` · ${topVol.team}` : ""} · ${topVol.total} contacted · ${topVol.paid} paid`
      : "No student data yet",
    topVol?.score ?? 0
  );
  y += champH + 10;

  // Mini podium
  y = pdfEnsureSpace(doc, y, 36, margin);
  y = pdfSectionTitle(doc, margin, y, "Podium vibes", "Gold · Silver · Bronze");
  const halfW = (contentW - 4) / 2;
  pdfDrawMiniPodium(doc, top3Dept, "dept", margin, y, halfW);
  pdfDrawMiniPodium(doc, top3Vol, "vol", margin + halfW + 4, y, halfW);
  y += 34;

  // Department rankings
  y = pdfEnsureSpace(doc, y, 40, margin);
  y = pdfSectionTitle(doc, margin, y, "Department rankings", "Full standings by composite score");

  const deptBody = (data.departments || []).map((r) => [
    pdfRankLabel(r.rank),
    r.label || r.department || "—",
    r.department || "—",
    String(r.total),
    String(r.willing),
    String(r.registered),
    String(r.paid),
    String(r.score),
  ]);

  autoTable(doc, {
    startY: y,
    head: [["Rank", "Department", "Code", "Hit", "Willing", "Reg", "Paid", "Score"]],
    body: deptBody.length
      ? deptBody
      : [["—", "No data yet — go make moves", "—", "0", "0", "0", "0", "0"]],
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 8,
      cellPadding: 2.4,
      textColor: PDF.ink,
      lineColor: [230, 230, 238],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: PDF.navy,
      textColor: PDF.white,
      fontStyle: "bold",
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [250, 250, 252] },
    columnStyles: {
      0: { cellWidth: 14, halign: "center" },
      7: { halign: "right", fontStyle: "bold" },
    },
    didParseCell: (hook) => pdfStyleTopRows(hook, deptBody.length > 0),
  });

  y = (doc.lastAutoTable?.finalY || y) + 12;

  // Student rankings
  y = pdfEnsureSpace(doc, y, 40, margin);
  y = pdfSectionTitle(doc, margin, y, "Student rankings", "Volunteer grind — every contact counts");

  const volBody = (data.volunteers || []).map((r) => [
    pdfRankLabel(r.rank),
    r.name || "—",
    `${r.department || "—"}${r.team ? ` · ${r.team}` : ""}`,
    String(r.total),
    String(r.willing),
    String(r.registered),
    String(r.paid),
    String(r.score),
  ]);

  autoTable(doc, {
    startY: y,
    head: [["Rank", "Student", "Dept / Team", "Hit", "Willing", "Reg", "Paid", "Score"]],
    body: volBody.length
      ? volBody
      : [["—", "No data yet — go make moves", "—", "0", "0", "0", "0", "0"]],
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 8,
      cellPadding: 2.4,
      textColor: PDF.ink,
      lineColor: [230, 230, 238],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: PDF.navy,
      textColor: PDF.white,
      fontStyle: "bold",
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [250, 250, 252] },
    columnStyles: {
      0: { cellWidth: 14, halign: "center" },
      7: { halign: "right", fontStyle: "bold" },
    },
    didParseCell: (hook) => pdfStyleTopRows(hook, volBody.length > 0),
  });

  y = (doc.lastAutoTable?.finalY || y) + 10;
  y = pdfEnsureSpace(doc, y, 18, margin);
  doc.setFillColor(...PDF.navy);
  pdfRoundedRect(doc, margin, y, contentW, 14, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...PDF.gold);
  doc.text("Keep the streak alive.", margin + 5, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(200, 200, 220);
  doc.text("Every alumni conversation moves LEGECI forward.", margin + 5, y + 11);

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    pdfDrawPageChrome(doc, pageW, pageH, margin, dateStr, i, pageCount);
  }

  doc.save(`legeci-alumni-leaderboard-${dateStr}.pdf`);
}
