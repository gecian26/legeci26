import { jsPDF } from "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm";
import { autoTable } from "https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.2/+esm";
import {
  DEPARTMENTS,
  MEETUP_NAME,
  WILLINGNESS_OPTIONS,
  REGISTRATION_OPTIONS,
} from "./constants.js";
import {
  summarizeContacts,
  departmentBreakdown,
  labelWillingness,
  labelRegistration,
  statusTone,
} from "./alumni-connect.js";

const TONE_RGB = {
  green: { text: [22, 101, 52], fill: [220, 252, 231] },
  orange: { text: [154, 52, 18], fill: [255, 237, 213] },
  red: { text: [153, 27, 27], fill: [254, 226, 226] },
  blue: { text: [7, 89, 133], fill: [224, 242, 254] },
  gray: { text: [71, 85, 105], fill: [241, 245, 249] },
};

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
  warnBg: [255, 251, 235],
  warnInk: [146, 64, 14],
};

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

function deptLabel(code) {
  return DEPARTMENTS.find((d) => d.value === code)?.label || code || "—";
}

function filterSummaryText(filters = {}) {
  const parts = [];
  if (filters.department) parts.push(`Dept: ${deptLabel(filters.department)}`);
  if (filters.willingness) {
    parts.push(
      `Willingness: ${WILLINGNESS_OPTIONS.find((o) => o.value === filters.willingness)?.label || filters.willingness}`
    );
  }
  if (filters.registrationStatus) {
    parts.push(
      `Registration: ${REGISTRATION_OPTIONS.find((o) => o.value === filters.registrationStatus)?.label || filters.registrationStatus}`
    );
  }
  if (filters.batch) parts.push(`Passout: ${filters.batch}`);
  if (filters.jobSector) parts.push(`Sector: ${filters.jobSector}`);
  if (filters.search) parts.push(`Search: “${filters.search}”`);
  return parts.length ? parts.join("  ·  ") : "All contacts (no filters)";
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
  doc.text(`${MEETUP_NAME || "LEGECI"} · Alumni contacted details · ${dateStr}`, margin, pageH - 4);
  doc.text(`${pageIndex} / ${pageCount}`, pageW - margin, pageH - 4, { align: "right" });
}

function sectionTitle(doc, margin, y, title, subtitle) {
  doc.setFillColor(...PDF.gold);
  doc.rect(margin, y - 3.5, 2.5, 9, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...PDF.navy);
  doc.text(title, margin + 5, y + 2.5);
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF.muted);
    doc.text(subtitle, margin + 5, y + 7.5);
    return y + 12;
  }
  return y + 7;
}

function statCard(doc, x, y, w, h, label, value, fill, ink) {
  doc.setFillColor(...fill);
  roundedRect(doc, x, y, w, h, 2.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...ink);
  doc.text(String(value), x + w / 2, y + 9, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...PDF.muted);
  doc.text(label.toUpperCase(), x + w / 2, y + 15, { align: "center" });
}

/**
 * Generate alumni contacted details PDF (filtered list + summary).
 * @param {{ contacts: object[], filters?: object, feeLabel?: string, allCount?: number }} opts
 */
export async function downloadAlumniContactsPdf(opts = {}) {
  const contacts = opts.contacts || [];
  const filters = opts.filters || {};
  const feeLabel = opts.feeLabel || "Not set";
  const allCount = opts.allCount ?? contacts.length;
  const stats = summarizeContacts(contacts);
  const deptRows = departmentBreakdown(contacts, DEPARTMENTS).filter((r) => r.total > 0);
  const dateStr = formatDate();
  const dateLong = formatDateLong();

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - margin * 2;

  // Hero
  doc.setFillColor(...PDF.navy);
  doc.rect(0, 0, pageW, 36, "F");
  doc.setFillColor(...PDF.gold);
  doc.rect(0, 36, pageW, 2, "F");
  doc.setFillColor(14, 116, 144);
  doc.rect(0, 0, 3.5, 36, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF.gold);
  doc.text(`${(MEETUP_NAME || "LEGECI").toUpperCase()}  ·  THE LEGACY CONTINUES`, margin, 10);

  doc.setFontSize(18);
  doc.setTextColor(...PDF.white);
  doc.text("Alumni Contacted Details", margin, 20);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(190, 190, 210);
  doc.text(`Report · ${dateLong}`, margin, 28);
  doc.text(`Fee: ${feeLabel}`, pageW - margin, 20, { align: "right" });
  doc.text(`${contacts.length} of ${allCount} shown`, pageW - margin, 28, { align: "right" });

  let y = 44;

  // Filter chip
  doc.setFillColor(245, 245, 250);
  roundedRect(doc, margin, y, contentW, 9, 2, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF.muted);
  const filterLine = doc.splitTextToSize(`Filters  ·  ${filterSummaryText(filters)}`, contentW - 8);
  doc.text(filterLine[0], margin + 4, y + 5.8);
  y += 12;

  // Color key
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...PDF.navy);
  doc.text("Status colors:", margin, y + 3);
  const keyItems = [
    { label: "Willing / Paid", tone: "green" },
    { label: "Undecided / Pending", tone: "orange" },
    { label: "Not willing", tone: "red" },
    { label: "Fee waived", tone: "blue" },
    { label: "No response / Not registered", tone: "gray" },
  ];
  let kx = margin + 28;
  keyItems.forEach((item) => {
    const tone = TONE_RGB[item.tone];
    doc.setFillColor(...tone.fill);
    roundedRect(doc, kx, y - 1.5, 4, 4, 1, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...tone.text);
    doc.text(item.label, kx + 5.5, y + 1.5);
    kx += doc.getTextWidth(item.label) + 12;
  });
  y += 10;

  // Stats
  y = sectionTitle(doc, margin, y, "Snapshot", "Based on the contacts in this report");
  const cardW = (contentW - 15) / 6;
  const cardH = 18;
  const cards = [
    { label: "Total", value: stats.total, fill: PDF.cream, ink: PDF.navy },
    { label: "Willing", value: stats.willing, fill: PDF.greenBg, ink: PDF.green },
    { label: "Not willing", value: stats.notWilling, fill: [254, 226, 226], ink: [185, 28, 28] },
    { label: "Registered", value: stats.registered, fill: PDF.tealBg, ink: PDF.teal },
    { label: "Paid", value: stats.paid, fill: PDF.goldSoft, ink: PDF.warnInk },
    { label: "Pending pay", value: stats.pendingPayment, fill: PDF.warnBg, ink: PDF.warnInk },
  ];
  cards.forEach((c, i) => {
    statCard(doc, margin + i * (cardW + 3), y, cardW, cardH, c.label, c.value, c.fill, c.ink);
  });
  y += cardH + 10;

  // Department breakdown (compact)
  if (deptRows.length) {
    y = sectionTitle(doc, margin, y, "Department mix", "Counts in this filtered set");
    autoTable(doc, {
      startY: y,
      head: [["Department", "Total", "Willing", "Registered", "Paid", "Pending", "Willing %", "Paid %"]],
      body: deptRows.map((r) => [
        r.label || r.department,
        String(r.total),
        String(r.willing),
        String(r.registered),
        String(r.paid),
        String(r.pendingPayment),
        `${r.willingPct}%`,
        `${r.paidPct}%`,
      ]),
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 7.5,
        cellPadding: 1.8,
        textColor: PDF.ink,
        lineColor: [230, 230, 238],
        lineWidth: 0.15,
      },
      headStyles: {
        fillColor: PDF.navy,
        textColor: PDF.white,
        fontStyle: "bold",
        fontSize: 7.5,
      },
      alternateRowStyles: { fillColor: [250, 250, 252] },
      didParseCell: (hook) => {
        if (hook.section === "body" && hook.row.index === 0) {
          hook.cell.styles.fillColor = PDF.goldSoft;
          hook.cell.styles.fontStyle = "bold";
        }
      },
    });
    y = (doc.lastAutoTable?.finalY || y) + 10;
  }

  // Contact details table
  if (y > pageH - 50) {
    doc.addPage();
    y = margin + 6;
  }
  y = sectionTitle(
    doc,
    margin,
    y,
    "Contact directory",
    "Full alumni outreach records matching the filters above"
  );

  const body = contacts.map((c, idx) => [
    String(idx + 1),
    deptLabel(c.department),
    c.alumniName || "—",
    c.whatsapp || "—",
    String(c.batch || c.passoutYear || "—"),
    labelWillingness(c.willingness),
    labelRegistration(c.registrationStatus),
    c.createdByName || c.createdByUserId || "—",
    c.company || "—",
    c.email || "—",
  ]);

  const willingnessValues = contacts.map((c) => c.willingness || "undecided");
  const registrationValues = contacts.map((c) => c.registrationStatus || "not_registered");

  autoTable(doc, {
    startY: y,
    head: [
      [
        "#",
        "Dept",
        "Alumni",
        "WhatsApp",
        "Year",
        "Willingness",
        "Registration",
        "Volunteer",
        "Company",
        "Email",
      ],
    ],
    body: body.length
      ? body
      : [["—", "—", "No contacts match these filters", "—", "—", "—", "—", "—", "—", "—"]],
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 7,
      cellPadding: 1.6,
      textColor: PDF.ink,
      lineColor: [230, 230, 238],
      lineWidth: 0.15,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: PDF.navy,
      textColor: PDF.white,
      fontStyle: "bold",
      fontSize: 7,
    },
    alternateRowStyles: { fillColor: [250, 250, 252] },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 18 },
      2: { cellWidth: 32 },
      3: { cellWidth: 24 },
      4: { cellWidth: 14, halign: "center" },
      5: { cellWidth: 24 },
      6: { cellWidth: 26 },
      7: { cellWidth: 28 },
      8: { cellWidth: 30 },
      9: { cellWidth: 40 },
    },
    didParseCell: (hook) => {
      if (hook.section !== "body" || !body.length) return;
      const row = hook.row.index;
      if (hook.column.index === 5) {
        const tone = TONE_RGB[statusTone("willingness", willingnessValues[row])] || TONE_RGB.gray;
        hook.cell.styles.fillColor = tone.fill;
        hook.cell.styles.textColor = tone.text;
        hook.cell.styles.fontStyle = "bold";
      }
      if (hook.column.index === 6) {
        const tone = TONE_RGB[statusTone("registration", registrationValues[row])] || TONE_RGB.gray;
        hook.cell.styles.fillColor = tone.fill;
        hook.cell.styles.textColor = tone.text;
        hook.cell.styles.fontStyle = "bold";
      }
    },
  });

  // Closing strip
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
  doc.text("Outreach log locked in.", margin + 4, endY + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(200, 200, 220);
  doc.text(
    "Use filters on Alumni Connect, then regenerate anytime for a fresh cut.",
    margin + 4,
    endY + 9.5
  );

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    drawPageChrome(doc, pageW, pageH, margin, dateStr, i, pageCount);
  }

  doc.save(`legeci-alumni-contacts-${dateStr}.pdf`);
}
