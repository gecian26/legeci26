import { jsPDF } from "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm";
import { autoTable } from "https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.2/+esm";
import writeExcelFile from "https://cdn.jsdelivr.net/npm/write-excel-file@4.1.1/browser/+esm";
import { DEPARTMENTS, MEETUP_NAME } from "./constants.js?v=er28";

const INK = {
  navy: [18, 18, 42],
  gold: [212, 175, 55],
  goldSoft: [255, 243, 205],
  cream: [252, 248, 240],
  muted: [100, 100, 120],
  white: [255, 255, 255],
  green: [22, 163, 74],
  greenBg: [220, 252, 231],
  text: [30, 30, 50],
};

const SHEET_HEAD = {
  fontWeight: "bold",
  color: "#FFFFFF",
  backgroundColor: "#6B2D7B",
  align: "center",
};

function eventTitle() {
  return MEETUP_NAME || "LEGECI";
}

function stampFile(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function stampLong(d = new Date()) {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function stampClock(d = new Date()) {
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function rupeePdf(amount) {
  return `Rs ${Math.round(Number(amount) || 0).toLocaleString("en-IN")}`;
}

function deptRank(code) {
  const i = DEPARTMENTS.findIndex((d) => d.value === code);
  return i >= 0 ? i : DEPARTMENTS.length;
}

function yearKey(batch) {
  const n = Number(String(batch || "").match(/(19|20)\d{2}/)?.[0]);
  return Number.isFinite(n) ? n : -1;
}

function rptTotals(alumni) {
  const rows = alumni || [];
  return {
    count: rows.length,
    people: rows.reduce((n, r) => n + (Number(r.people) || 0), 0),
    family: rows.reduce((n, r) => n + (Number(r.family) || 0), 0),
    food: rows.reduce((n, r) => n + (Number(r.food) || 0), 0),
    souvenir: rows.filter((r) => r.souvenir === "Yes").length,
    hillview: rows.filter((r) => r.hillview && r.hillview !== "No").length,
    feeTotal: rows.reduce((n, r) => n + (Number(r.fee) || 0), 0),
    feeCount: rows.filter((r) => (Number(r.fee) || 0) > 0).length,
  };
}

function emptyBranch(code, label) {
  return { code, label, count: 0, people: 0, food: 0, souvenir: 0, hillview: 0, feeTotal: 0 };
}

function addToBucket(bucket, row) {
  bucket.count += 1;
  bucket.people += Number(row.people) || 0;
  bucket.food += Number(row.food) || 0;
  bucket.souvenir += row.souvenir === "Yes" ? 1 : 0;
  bucket.hillview += row.hillview && row.hillview !== "No" ? 1 : 0;
  bucket.feeTotal += Number(row.fee) || 0;
}

function rptByBranch(alumni) {
  const map = new Map();
  DEPARTMENTS.forEach((d) => map.set(d.value, emptyBranch(d.value, d.label)));
  (alumni || []).forEach((row) => {
    const code = row.department || "OTHER";
    if (!map.has(code)) map.set(code, emptyBranch(code, row.departmentLabel || code || "Other / unset"));
    addToBucket(map.get(code), row);
  });
  return [...map.values()]
    .filter((r) => r.count)
    .sort((a, b) => deptRank(a.code) - deptRank(b.code) || a.label.localeCompare(b.label));
}

function rptByBatch(alumni) {
  const map = new Map();
  (alumni || []).forEach((row) => {
    const batch = row.batch || "—";
    if (!map.has(batch)) {
      map.set(batch, { batch, count: 0, people: 0, food: 0, souvenir: 0, hillview: 0, feeTotal: 0 });
    }
    addToBucket(map.get(batch), row);
  });
  return [...map.values()].sort(
    (a, b) => yearKey(b.batch) - yearKey(a.batch) || String(a.batch).localeCompare(String(b.batch))
  );
}

function rptMatrix(alumni) {
  const branches = [];
  const seen = new Set();
  DEPARTMENTS.forEach((d) => {
    seen.add(d.value);
    branches.push({ code: d.value, label: d.label });
  });
  (alumni || []).forEach((row) => {
    const code = row.department || "OTHER";
    if (seen.has(code)) return;
    seen.add(code);
    branches.push({ code, label: row.departmentLabel || code || "Other / unset" });
  });
  const batches = [...new Set((alumni || []).map((r) => r.batch || "—"))].sort(
    (a, b) => yearKey(b) - yearKey(a) || String(a).localeCompare(String(b))
  );
  const counts = new Map();
  (alumni || []).forEach((row) => {
    const key = `${row.department || "OTHER"}|${row.batch || "—"}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return { branches, batches, counts };
}

function rptNote(excluded = {}) {
  const parts = [];
  if (excluded.test) parts.push(`${excluded.test} test`);
  if (excluded.disabled) parts.push(`${excluded.disabled} disabled`);
  if (excluded.extras) parts.push(`${excluded.extras} duplicate extras`);
  if (excluded.staff) parts.push(`${excluded.staff} former staff`);
  return parts.length
    ? `Excluded from this report: ${parts.join(", ")}.`
    : "No test, disabled, duplicate, or staff rows were excluded.";
}

function roundBox(doc, x, y, w, h, r) {
  doc.roundedRect(x, y, w, h, r, r, "F");
}

function heading(doc, margin, y, title, subtitle) {
  doc.setFillColor(...INK.gold);
  doc.rect(margin, y - 3.5, 2.5, 9, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK.navy);
  doc.text(title, margin + 5, y + 2.2);
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...INK.muted);
    doc.text(subtitle, margin + 5, y + 7.4);
    return y + 12;
  }
  return y + 7;
}

function kpi(doc, x, y, w, h, label, value, fill, ink) {
  doc.setFillColor(...fill);
  roundBox(doc, x, y, w, h, 2.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(String(value).length > 12 ? 9 : 12);
  doc.setTextColor(...ink);
  doc.text(String(value), x + w / 2, y + 9, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.2);
  doc.setTextColor(...INK.muted);
  doc.text(String(label).toUpperCase(), x + w / 2, y + 15, { align: "center" });
}

function paintChrome(doc, pageW, pageH, margin, dateStr, footerLabel = "Registered alumni") {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    if (i > 1) {
      doc.setFillColor(...INK.navy);
      doc.rect(0, 0, pageW, 7, "F");
      doc.setFillColor(...INK.gold);
      doc.rect(0, 7, pageW, 1.1, "F");
    }
    doc.setFillColor(...INK.cream);
    doc.rect(0, pageH - 10, pageW, 10, "F");
    doc.setFillColor(...INK.gold);
    doc.rect(0, pageH - 10, pageW, 0.9, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...INK.muted);
    doc.text(`${eventTitle()} · ${footerLabel} · ${dateStr}`, margin, pageH - 4);
    doc.text(`${i} / ${pages}`, pageW - margin, pageH - 4, { align: "right" });
  }
}

function alumniGroupedByBranch(alumni) {
  const groups = new Map();
  DEPARTMENTS.forEach((d) => groups.set(d.value, { code: d.value, label: d.label, rows: [] }));
  (alumni || []).forEach((row) => {
    const code = row.department || "OTHER";
    if (!groups.has(code)) {
      groups.set(code, { code, label: row.departmentLabel || code || "Other / unset", rows: [] });
    }
    groups.get(code).rows.push(row);
  });
  groups.forEach((group) => {
    group.rows.sort(
      (a, b) =>
        String(b.batch || "").localeCompare(String(a.batch || ""), undefined, { numeric: true }) ||
        String(a.name || "").localeCompare(String(b.name || ""))
    );
  });
  return [...groups.values()]
    .filter((group) => group.rows.length)
    .sort((a, b) => deptRank(a.code) - deptRank(b.code) || a.label.localeCompare(b.label));
}

function gridOpts(margin) {
  return {
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 7.5,
      cellPadding: { top: 1.6, bottom: 1.6, left: 1.8, right: 1.8 },
      textColor: INK.text,
      lineColor: [230, 230, 238],
      lineWidth: 0.15,
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: INK.navy,
      textColor: INK.white,
      fontStyle: "bold",
      fontSize: 7.5,
      valign: "middle",
    },
    alternateRowStyles: { fillColor: [250, 250, 252] },
  };
}

/**
 * Unique Event Desk alumni after dropping test, disabled, and duplicate extras.
 * @param {{ alumni: object[], excluded?: object, generatedBy?: string }} opts
 */
export async function downloadRegisteredAlumniPdf(opts = {}) {
  const alumni = opts.alumni || [];
  const excluded = opts.excluded || {};
  const generatedBy = opts.generatedBy || "";
  const stats = rptTotals(alumni);
  const branchRows = rptByBranch(alumni);
  const batchRows = rptByBatch(alumni);
  const matrix = rptMatrix(alumni);
  const dateStr = stampFile();
  const dateLong = stampLong();

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - margin * 2;

  doc.setFillColor(...INK.navy);
  doc.rect(0, 0, pageW, 36, "F");
  doc.setFillColor(...INK.gold);
  doc.rect(0, 36, pageW, 2, "F");
  doc.setFillColor(14, 116, 144);
  doc.rect(0, 0, 3.5, 36, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...INK.gold);
  doc.text(`${eventTitle().toUpperCase()}  ·  EVENT DESK`, margin, 10);
  doc.setFontSize(18);
  doc.setTextColor(...INK.white);
  doc.text("Registered alumni", margin, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(190, 190, 210);
  doc.text(`Unique check-ins after duplicate removal  ·  ${dateLong}`, margin, 28);
  doc.text(`${stats.count} alumni`, pageW - margin, 20, { align: "right" });
  if (generatedBy) doc.text(generatedBy, pageW - margin, 28, { align: "right" });

  let y = 44;
  doc.setFillColor(245, 245, 250);
  roundBox(doc, margin, y, contentW, 10, 2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...INK.muted);
  const note = doc.splitTextToSize(
    `Each person is counted once (earliest live check-in kept). ${rptNote(excluded)}`,
    contentW - 8
  );
  doc.text(note[0], margin + 4, y + 6.4);
  y += 14;

  const cardW = (contentW - 18) / 7;
  const cards = [
    { label: "Alumni", value: stats.count, fill: INK.cream, ink: INK.navy },
    { label: "People", value: stats.people, fill: INK.greenBg, ink: INK.green },
    { label: "Family", value: stats.family, fill: INK.cream, ink: INK.navy },
    { label: "Food", value: stats.food, fill: INK.goldSoft, ink: INK.navy },
    { label: "Souvenir", value: stats.souvenir, fill: INK.cream, ink: INK.navy },
    { label: "Hillview", value: stats.hillview, fill: INK.cream, ink: INK.navy },
    { label: "Desk fees", value: rupeePdf(stats.feeTotal), fill: INK.goldSoft, ink: INK.navy },
  ];
  cards.forEach((c, i) => kpi(doc, margin + i * (cardW + 3), y, cardW, 20, c.label, c.value, c.fill, c.ink));
  y += 28;

  y = heading(doc, margin, y, "Branch-wise", "Unique registered alumni by department");
  autoTable(doc, {
    startY: y,
    ...gridOpts(margin),
    head: [["Branch", "Alumni", "People", "Food", "Souvenir", "Hillview", "Desk fees"]],
    body: branchRows.length
      ? branchRows.map((r) => [
          r.label,
          String(r.count),
          String(r.people),
          String(r.food),
          String(r.souvenir),
          String(r.hillview),
          rupeePdf(r.feeTotal),
        ])
      : [["No unique alumni check-ins", "0", "0", "0", "0", "0", rupeePdf(0)]],
    columnStyles: {
      0: { cellWidth: 90 },
      1: { halign: "center" },
      2: { halign: "center" },
      3: { halign: "center" },
      4: { halign: "center" },
      5: { halign: "center" },
      6: { halign: "center", fontStyle: "bold" },
    },
  });
  y = (doc.lastAutoTable?.finalY || y) + 10;

  if (y > pageH - 55) {
    doc.addPage();
    y = margin + 10;
  }
  y = heading(doc, margin, y, "Batch-wise", "Unique registered alumni by passout year");
  autoTable(doc, {
    startY: y,
    ...gridOpts(margin),
    head: [["Passout year", "Alumni", "People", "Food", "Souvenir", "Hillview", "Desk fees"]],
    body: batchRows.length
      ? batchRows.map((r) => [
          String(r.batch),
          String(r.count),
          String(r.people),
          String(r.food),
          String(r.souvenir),
          String(r.hillview),
          rupeePdf(r.feeTotal),
        ])
      : [["—", "0", "0", "0", "0", "0", rupeePdf(0)]],
    columnStyles: {
      0: { cellWidth: 40, halign: "center" },
      1: { halign: "center" },
      2: { halign: "center" },
      3: { halign: "center" },
      4: { halign: "center" },
      5: { halign: "center" },
      6: { halign: "center", fontStyle: "bold" },
    },
  });
  y = (doc.lastAutoTable?.finalY || y) + 10;

  if (matrix.batches.length) {
    if (y > pageH - 50) {
      doc.addPage();
      y = margin + 10;
    }
    y = heading(doc, margin, y, "Branch × batch", "Alumni count in each department and passout year");
    const head = ["Branch", ...matrix.batches.map(String), "Total"];
    const body = matrix.branches.map((branch) => {
      const cells = matrix.batches.map((batch) => {
        const n = matrix.counts.get(`${branch.code}|${batch}`) || 0;
        return n ? String(n) : "—";
      });
      const total = matrix.batches.reduce((n, batch) => n + (matrix.counts.get(`${branch.code}|${batch}`) || 0), 0);
      return [branch.label, ...cells, String(total)];
    });
    autoTable(doc, {
      startY: y,
      ...gridOpts(margin),
      head: [head],
      body,
      styles: {
        fontSize: matrix.batches.length > 12 ? 6.5 : 7.5,
        cellPadding: 1.4,
        textColor: INK.text,
        lineColor: [230, 230, 238],
        lineWidth: 0.15,
        halign: "center",
        valign: "middle",
      },
      columnStyles: { 0: { halign: "left", cellWidth: 52, fontStyle: "bold" } },
    });
    y = (doc.lastAutoTable?.finalY || y) + 10;
  }

  if (y > pageH - 40) {
    doc.addPage();
    y = margin + 10;
  }
  y = heading(doc, margin, y, "Alumni list", "Sorted by branch, then passout year, then name");
  autoTable(doc, {
    startY: y,
    ...gridOpts(margin),
    head: [["#", "Name", "Branch", "Year", "Phone", "People", "Source", "Food", "Hillview", "Fee"]],
    body: alumni.length
      ? alumni.map((r, i) => [
          String(i + 1),
          r.name || "—",
          r.departmentLabel || r.department || "—",
          r.batch || "—",
          r.phone || "—",
          String(r.people || 1),
          r.source || "—",
          r.food ? String(r.food) : "—",
          r.hillview || "—",
          r.fee ? rupeePdf(r.fee) : "—",
        ])
      : [["—", "No unique alumni check-ins", "—", "—", "—", "—", "—", "—", "—", "—"]],
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 48 },
      2: { cellWidth: 52 },
      3: { cellWidth: 16, halign: "center" },
      4: { cellWidth: 28 },
      5: { cellWidth: 16, halign: "center" },
      6: { cellWidth: 28 },
      7: { cellWidth: 16, halign: "center" },
      8: { cellWidth: 28 },
      9: { cellWidth: 24, halign: "center", fontStyle: "bold" },
    },
  });

  paintChrome(doc, pageW, pageH, margin, dateStr);
  doc.save(`${eventTitle()}-registered-alumni-${dateStr}.pdf`);
}

/**
 * Compact PDF: unique alumni grouped by branch, with name and contact number only.
 * @param {{ alumni: object[], excluded?: object, generatedBy?: string }} opts
 */
export async function downloadRegisteredAlumniBranchPdf(opts = {}) {
  const alumni = opts.alumni || [];
  const excluded = opts.excluded || {};
  const generatedBy = opts.generatedBy || "";
  const groups = alumniGroupedByBranch(alumni);
  const dateStr = stampFile();
  const dateLong = stampLong();

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;

  doc.setFillColor(...INK.navy);
  doc.rect(0, 0, pageW, 34, "F");
  doc.setFillColor(...INK.gold);
  doc.rect(0, 34, pageW, 2, "F");
  doc.setFillColor(14, 116, 144);
  doc.rect(0, 0, 3.5, 34, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...INK.gold);
  doc.text(`${eventTitle().toUpperCase()}  ·  EVENT DESK`, margin, 10);
  doc.setFontSize(16);
  doc.setTextColor(...INK.white);
  doc.text("Alumni by branch", margin, 19);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(190, 190, 210);
  doc.text(`Name and contact number  ·  ${dateLong}`, margin, 27);
  doc.text(`${alumni.length} alumni`, pageW - margin, 19, { align: "right" });
  if (generatedBy) doc.text(generatedBy, pageW - margin, 27, { align: "right" });

  let y = 42;
  doc.setFillColor(245, 245, 250);
  roundBox(doc, margin, y, contentW, 10, 2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...INK.muted);
  const note = doc.splitTextToSize(
    `Unique check-ins after duplicate removal. ${rptNote(excluded)}`,
    contentW - 8
  );
  doc.text(note[0], margin + 4, y + 6.4);
  y += 14;

  if (!groups.length) {
    y = heading(doc, margin, y, "No alumni", "No unique Event Desk check-ins to list");
    autoTable(doc, {
      startY: y,
      ...gridOpts(margin),
      head: [["#", "Name", "Passout year", "Contact number"]],
      body: [["—", "No unique alumni check-ins", "—", "—"]],
      columnStyles: {
        0: { cellWidth: 12, halign: "center" },
        1: { cellWidth: 78 },
        2: { cellWidth: 28, halign: "center" },
        3: { cellWidth: contentW - 118 },
      },
    });
  } else {
    groups.forEach((group) => {
      if (y > pageH - 48) {
        doc.addPage();
        y = margin + 10;
      }
      y = heading(
        doc,
        margin,
        y,
        group.label,
        `${group.rows.length} alumn${group.rows.length === 1 ? "us" : "i"}`
      );
      autoTable(doc, {
        startY: y,
        ...gridOpts(margin),
        head: [["#", "Name", "Passout year", "Contact number"]],
        body: group.rows.map((r, i) => [
          String(i + 1),
          r.name || "—",
          r.batch || "—",
          r.phone || "—",
        ]),
        styles: {
          fontSize: 9,
          cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
          textColor: INK.text,
          lineColor: [230, 230, 238],
          lineWidth: 0.15,
          valign: "middle",
          overflow: "linebreak",
        },
        columnStyles: {
          0: { cellWidth: 12, halign: "center" },
          1: { cellWidth: 78 },
          2: { cellWidth: 28, halign: "center" },
          3: { cellWidth: contentW - 118 },
        },
      });
      y = (doc.lastAutoTable?.finalY || y) + 8;
    });
  }

  paintChrome(doc, pageW, pageH, margin, dateStr, "Alumni by branch");
  doc.save(`${eventTitle()}-alumni-by-branch-${dateStr}.pdf`);
}

function txt(value) {
  return value == null || value === "" ? "" : String(value);
}

function num(n) {
  return { value: Number(n) || 0, type: Number, align: "right" };
}

function inr(n) {
  return { value: Number(n) || 0, type: Number, format: "#,##0", align: "right" };
}

function headRow(values) {
  return values.map((value) => ({ value, ...SHEET_HEAD }));
}

function sheetOf(name, headers, widths, rows) {
  const data = [headRow(headers)];
  if (rows.length) data.push(...rows);
  else data.push([txt("No records")]);
  return {
    sheet: name,
    columns: widths.map((width) => ({ width })),
    data,
  };
}

/**
 * @param {{ alumni: object[], excluded?: object, generatedBy?: string }} opts
 */
export async function downloadRegisteredAlumniExcel(opts = {}) {
  const alumni = opts.alumni || [];
  const excluded = opts.excluded || {};
  const generatedBy = opts.generatedBy || "";
  const stats = rptTotals(alumni);
  const branchRows = rptByBranch(alumni);
  const batchRows = rptByBatch(alumni);
  const matrix = rptMatrix(alumni);
  const dateStr = stampFile();

  const summary = {
    sheet: "Summary",
    columns: [{ width: 42 }, { width: 16 }, { width: 14 }, { width: 14 }],
    data: [
      [{ value: `${eventTitle()} registered alumni`, fontWeight: "bold", fontSize: 16, color: "#3d1454" }],
      [{ value: `Generated ${stampClock()}${generatedBy ? ` · ${generatedBy}` : ""}` }],
      [{ value: "Unique Event Desk check-ins after removing test records, disabled copies, and duplicate extras." }],
      [{ value: rptNote(excluded) }],
      [],
      headRow(["Item", "Count", "", ""]),
      [txt("Unique alumni"), num(stats.count), "", ""],
      [txt("People on campus"), num(stats.people), "", ""],
      [txt("Family accompanying"), num(stats.family), "", ""],
      [txt("Food coupons"), num(stats.food), "", ""],
      [txt("Souvenirs"), num(stats.souvenir), "", ""],
      [txt("Hillview"), num(stats.hillview), "", ""],
      [txt("Desk fees (INR)"), inr(stats.feeTotal), num(stats.feeCount), ""],
    ],
  };

  const branchSheet = sheetOf(
    "By branch",
    ["Branch", "Alumni", "People", "Food", "Souvenir", "Hillview", "Desk fees (INR)"],
    [36, 12, 12, 12, 12, 12, 16],
    branchRows.map((r) => [
      txt(r.label),
      num(r.count),
      num(r.people),
      num(r.food),
      num(r.souvenir),
      num(r.hillview),
      inr(r.feeTotal),
    ])
  );

  const batchSheet = sheetOf(
    "By batch",
    ["Passout year", "Alumni", "People", "Food", "Souvenir", "Hillview", "Desk fees (INR)"],
    [16, 12, 12, 12, 12, 12, 16],
    batchRows.map((r) => [
      txt(r.batch),
      num(r.count),
      num(r.people),
      num(r.food),
      num(r.souvenir),
      num(r.hillview),
      inr(r.feeTotal),
    ])
  );

  const matrixHead = ["Branch", ...matrix.batches.map(String), "Total"];
  const matrixBody = matrix.branches.map((branch) => {
    const cells = matrix.batches.map((batch) => num(matrix.counts.get(`${branch.code}|${batch}`) || 0));
    const total = matrix.batches.reduce((n, batch) => n + (matrix.counts.get(`${branch.code}|${batch}`) || 0), 0);
    return [txt(branch.label), ...cells, num(total)];
  });
  const matrixSheet = sheetOf("Branch x batch", matrixHead, [36, ...matrix.batches.map(() => 8), 10], matrixBody);

  const listSheet = sheetOf(
    "Alumni",
    [
      "#",
      "Name",
      "Branch",
      "Passout year",
      "Phone",
      "Email",
      "Company",
      "People",
      "Family",
      "Source",
      "Food",
      "Souvenir",
      "Hillview",
      "Desk fee (INR)",
      "Fee mode",
      "Receipt",
      "Recorded by",
    ],
    [6, 28, 32, 12, 14, 28, 24, 10, 10, 16, 10, 12, 16, 14, 12, 18, 18],
    alumni.map((r, i) => [
      num(i + 1),
      txt(r.name),
      txt(r.departmentLabel || r.department),
      txt(r.batch),
      txt(r.phone),
      txt(r.email),
      txt(r.company),
      num(r.people),
      num(r.family),
      txt(r.source),
      num(r.food),
      txt(r.souvenir),
      txt(r.hillview),
      inr(r.fee),
      txt(r.feeMode),
      txt(r.receipt),
      txt(r.recordedBy),
    ])
  );

  await writeExcelFile([summary, branchSheet, batchSheet, matrixSheet, listSheet]).toFile(
    `${eventTitle()}-registered-alumni-${dateStr}.xlsx`
  );
}
