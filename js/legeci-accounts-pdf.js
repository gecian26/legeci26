import { jsPDF } from "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm";
import { autoTable } from "https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.2/+esm";
import { DEPARTMENTS, MEETUP_NAME, formatDateShort } from "./constants.js";
import {
  contactFeeLineTotal,
  contactMembersAttending,
} from "./alumni-connect.js";
import {
  paymentModeLabel,
  summarizeRegistrationFees,
  contactFeeRemarks,
} from "./legeci-accounts.js?v=fn4";

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
  warnBg: [255, 251, 235],
  warnInk: [146, 64, 14],
};

/** Helvetica cannot draw ₹ — use ASCII so amounts stay aligned. */
function pdfMoney(amount) {
  const n = Math.round(Number(amount) || 0);
  return `Rs ${n.toLocaleString("en-IN")}`;
}

function deptLabel(code) {
  return DEPARTMENTS.find((d) => d.value === code)?.label || code || "—";
}

function deptCode(code) {
  return DEPARTMENTS.find((d) => d.value === code)?.value || code || "—";
}

function formatDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateLong(d = new Date()) {
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function roundedRect(doc, x, y, w, h, r, style = "F") {
  const radius = Math.min(r, w / 2, h / 2);
  doc.roundedRect(x, y, w, h, radius, radius, style);
}

function drawPageChrome(doc, pageW, pageH, margin, dateStr, pageIndex, pageCount) {
  if (pageIndex > 1) {
    doc.setFillColor(...PDF.navy);
    doc.rect(0, 0, pageW, 7, "F");
    doc.setFillColor(...PDF.gold);
    doc.rect(0, 7, pageW, 1.1, "F");
  }
  doc.setFillColor(...PDF.cream);
  doc.rect(0, pageH - 10, pageW, 10, "F");
  doc.setFillColor(...PDF.gold);
  doc.rect(0, pageH - 10, pageW, 0.9, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...PDF.muted);
  doc.text(`${MEETUP_NAME || "LEGECI"} · Paid alumni · ${dateStr}`, margin, pageH - 4);
  doc.text(`${pageIndex} / ${pageCount}`, pageW - margin, pageH - 4, { align: "right" });
}

function sectionTitle(doc, margin, y, title, subtitle) {
  doc.setFillColor(...PDF.gold);
  doc.rect(margin, y - 3.5, 2.5, 9, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...PDF.navy);
  doc.text(title, margin + 5, y + 2.2);
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF.muted);
    doc.text(subtitle, margin + 5, y + 7.4);
    return y + 12;
  }
  return y + 7;
}

function statCard(doc, x, y, w, h, label, value, fill, ink) {
  doc.setFillColor(...fill);
  roundedRect(doc, x, y, w, h, 2.5, "F");
  const mid = y + h / 2;
  doc.setFont("helvetica", "bold");
  const valueSize = String(value).length > 10 ? 9 : 11;
  doc.setFontSize(valueSize);
  doc.setTextColor(...ink);
  doc.text(String(value), x + w / 2, mid - 1.2, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.2);
  doc.setTextColor(...PDF.muted);
  doc.text(label.toUpperCase(), x + w / 2, mid + 5.2, { align: "center" });
}

function sortAlumni(rows) {
  return [...(rows || [])].sort((a, b) => {
    const dept = String(a.department || "").localeCompare(String(b.department || ""));
    if (dept) return dept;
    return String(a.alumniName || "").localeCompare(String(b.alumniName || ""));
  });
}

function deptTotals(rows, feeSettings) {
  const map = new Map();
  rows.forEach((c) => {
    const code = c.department || "—";
    if (!map.has(code)) map.set(code, { code, entries: 0, people: 0, amount: 0 });
    const row = map.get(code);
    row.entries += 1;
    row.people += contactMembersAttending(c);
    row.amount += contactFeeLineTotal(c, feeSettings);
  });
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

function feeFilterTitle(feeFilter) {
  if (feeFilter === "paid") return "Fees received";
  if (feeFilter === "pending") return "Fees pending";
  if (feeFilter === "due") return "Registered (pending + paid)";
  if (feeFilter === "all") return "All contacts";
  return "Current fee list";
}

/**
 * Treasurer PDF of paid / registered alumni.
 * @param {{
 *   kind?: "paid" | "fees-view",
 *   contacts?: object[],
 *   feeSettings?: object,
 *   feeRows?: object[],
 *   feeFilter?: string,
 *   generatedBy?: string,
 * }} opts
 */
export async function downloadFinanceAlumniPdf(opts = {}) {
  const kind = opts.kind || "paid";
  const contacts = opts.contacts || [];
  const feeSettings = opts.feeSettings || {};
  const fees = summarizeRegistrationFees(contacts, feeSettings);
  const generatedBy = opts.generatedBy || "";

  const rows =
    kind === "fees-view"
      ? sortAlumni(opts.feeRows || [])
      : sortAlumni(contacts.filter((c) => c.registrationStatus === "paid"));

  const people = rows.reduce((n, c) => n + contactMembersAttending(c), 0);
  const amount = rows.reduce((n, c) => n + contactFeeLineTotal(c, feeSettings), 0);
  const listTitle = kind === "fees-view" ? feeFilterTitle(opts.feeFilter) : "Paid alumni";
  const listSubtitle =
    kind === "fees-view"
      ? "Alumni in the current Registration fees view"
      : "Alumni whose registration fee has been marked received";

  const dateStr = formatDate();
  const dateLong = formatDateLong();
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - margin * 2;

  doc.setFillColor(...PDF.navy);
  doc.rect(0, 0, pageW, 36, "F");
  doc.setFillColor(...PDF.gold);
  doc.rect(0, 36, pageW, 2, "F");
  doc.setFillColor(14, 116, 144);
  doc.rect(0, 0, 3.5, 36, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...PDF.gold);
  doc.text(`${(MEETUP_NAME || "LEGECI").toUpperCase()}  ·  FINANCE`, margin, 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(190, 190, 210);
  doc.text(dateLong, pageW - margin, 10, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...PDF.white);
  doc.text(listTitle, margin, 21);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(190, 190, 210);
  doc.text(listSubtitle, margin, 29);
  doc.text(
    `${pdfMoney(fees.feeAmount)} / person${generatedBy ? `  ·  ${generatedBy}` : ""}`,
    pageW - margin,
    21,
    { align: "right" }
  );
  doc.text(
    `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`,
    pageW - margin,
    29,
    { align: "right" }
  );

  let y = 44;
  const cardGap = 3;
  const cardW = (contentW - cardGap * 4) / 5;
  const cardH = 20;
  const cards = [
    { label: "Entries", value: String(rows.length), fill: PDF.cream, ink: PDF.navy },
    { label: "People", value: String(people), fill: PDF.greenBg, ink: PDF.green },
    { label: "This list", value: pdfMoney(amount), fill: PDF.goldSoft, ink: PDF.warnInk },
    { label: "All received", value: pdfMoney(fees.receivedTotal), fill: PDF.greenBg, ink: PDF.green },
    { label: "All pending", value: pdfMoney(fees.pendingTotal), fill: PDF.warnBg, ink: PDF.warnInk },
  ];
  cards.forEach((c, i) => {
    statCard(doc, margin + i * (cardW + cardGap), y, cardW, cardH, c.label, c.value, c.fill, c.ink);
  });
  y += cardH + 10;

  const deptRows = deptTotals(rows, feeSettings);
  if (deptRows.length) {
    y = sectionTitle(doc, margin, y, "By department", "Totals for alumni in this list");
    autoTable(doc, {
      startY: y,
      tableWidth: 170,
      head: [["Department", "Entries", "People", "Fee total"]],
      body: deptRows.map((r) => [
        deptLabel(r.code),
        String(r.entries),
        String(r.people),
        pdfMoney(r.amount),
      ]),
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 8,
        cellPadding: { top: 2, bottom: 2, left: 2.2, right: 2.2 },
        textColor: PDF.ink,
        lineColor: [230, 230, 238],
        lineWidth: 0.15,
        valign: "middle",
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: PDF.navy,
        textColor: PDF.white,
        fontStyle: "bold",
        fontSize: 8,
        valign: "middle",
      },
      alternateRowStyles: { fillColor: [250, 250, 252] },
      columnStyles: {
        0: { cellWidth: 78, halign: "left" },
        1: { cellWidth: 28, halign: "center" },
        2: { cellWidth: 28, halign: "center" },
        3: { cellWidth: 36, halign: "center", fontStyle: "bold" },
      },
    });
    y = (doc.lastAutoTable?.finalY || y) + 10;
  }

  if (y > pageH - 48) {
    doc.addPage();
    y = margin + 8;
  }
  y = sectionTitle(doc, margin, y, "Alumni list", "Sorted by department, then name");

  const body = rows.map((c, idx) => {
    const paid = c.registrationStatus === "paid";
    return [
      String(idx + 1),
      c.alumniName || "—",
      c.whatsapp || c.mobile || "—",
      deptCode(c.department),
      String(c.batch || "—"),
      String(contactMembersAttending(c)),
      pdfMoney(contactFeeLineTotal(c, feeSettings)),
      paid ? paymentModeLabel(c.feePaymentMode) || "—" : "—",
      paid ? formatDateShort(c.feeReceivedAt) || c.feeReceivedAt || "—" : "Pending",
      contactFeeRemarks(c) || "—",
    ];
  });

  autoTable(doc, {
    startY: y,
    tableWidth: contentW,
    head: [["#", "Alumni", "Phone", "Dept", "Year", "Members", "Fee", "Mode", "Received", "Remarks"]],
    body: body.length
      ? body
      : [["—", "No alumni in this list", "—", "—", "—", "—", "—", "—", "—", "—"]],
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 7,
      cellPadding: { top: 1.6, bottom: 1.6, left: 1.5, right: 1.5 },
      textColor: PDF.ink,
      lineColor: [230, 230, 238],
      lineWidth: 0.15,
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: PDF.navy,
      textColor: PDF.white,
      fontStyle: "bold",
      fontSize: 7,
      valign: "middle",
    },
    alternateRowStyles: { fillColor: [250, 250, 252] },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 48, halign: "left" },
      2: { cellWidth: 28, halign: "left" },
      3: { cellWidth: 16, halign: "center" },
      4: { cellWidth: 16, halign: "center" },
      5: { cellWidth: 20, halign: "center" },
      6: { cellWidth: 28, halign: "center", fontStyle: "bold" },
      7: { cellWidth: 22, halign: "center" },
      8: { cellWidth: 26, halign: "center" },
      9: { cellWidth: contentW - 214, halign: "left" },
    },
  });

  let endY = (doc.lastAutoTable?.finalY || y) + 8;
  if (endY > pageH - 22) {
    doc.addPage();
    endY = margin + 6;
  }
  doc.setFillColor(...PDF.navy);
  roundedRect(doc, margin, endY, contentW, 12, 2.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF.gold);
  doc.text(
    kind === "paid"
      ? `${rows.length} paid ${rows.length === 1 ? "entry" : "entries"}  ·  ${people} people  ·  ${pdfMoney(amount)}`
      : `${rows.length} ${rows.length === 1 ? "row" : "rows"} in this view  ·  ${pdfMoney(amount)}`,
    margin + 4,
    endY + 5
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(200, 200, 220);
  doc.text(`Rate ${pdfMoney(fees.feeAmount)} per person. Generated ${dateLong}.`, margin + 4, endY + 9.5);

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    drawPageChrome(doc, pageW, pageH, margin, dateStr, i, pageCount);
  }

  const slug = kind === "paid" ? "paid-alumni" : "fees-list";
  doc.save(`LEGECI-${slug}-${dateStr}.pdf`);
}
