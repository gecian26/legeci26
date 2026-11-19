import { jsPDF } from "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm";
import { autoTable } from "https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.2/+esm";
import writeExcelFile from "https://cdn.jsdelivr.net/npm/write-excel-file@4.1.1/browser/+esm";
import {
  DEPARTMENTS,
  NETWORK_ACTIVITY_FIELDS,
  NETWORK_ACTIVITY_WILLINGNESS,
  NETWORK_CONNECT_STATUS,
  NETWORK_ORIGIN_KINDS,
  PROGRAM_KINDS,
  PROGRAM_STATUS,
} from "./constants.js?v=er35";

const INK = {
  navy: [18, 18, 42],
  gold: [212, 175, 55],
  white: [255, 255, 255],
  muted: [100, 100, 120],
  text: [30, 30, 50],
};

const TONE_RGB = {
  green: { text: [22, 101, 52], fill: [220, 252, 231] },
  orange: { text: [154, 52, 18], fill: [255, 237, 213] },
  red: { text: [153, 27, 27], fill: [254, 226, 226] },
  blue: { text: [29, 78, 216], fill: [219, 234, 254] },
  gray: { text: [71, 85, 105], fill: [241, 245, 249] },
};

const SHEET_HEAD = {
  fontWeight: "bold",
  color: "#FFFFFF",
  backgroundColor: "#6B2D7B",
  align: "center",
};

function stampFile(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function stampLong(d = new Date()) {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function labelOf(options, value) {
  return options.find((o) => o.value === value)?.label || value || "—";
}

function deptLabel(code) {
  return DEPARTMENTS.find((d) => d.value === code)?.label || code || "—";
}

function connectTone(value) {
  switch (value) {
    case "responded":
      return "green";
    case "contacted":
    case "follow_up":
      return "orange";
    case "declined":
      return "red";
    default:
      return "gray";
  }
}

function activityTone(value) {
  switch (value) {
    case "willing":
      return "green";
    case "undecided":
      return "orange";
    case "not_willing":
      return "red";
    default:
      return "gray";
  }
}

function programTone(value) {
  switch (value) {
    case "completed":
      return "green";
    case "confirmed":
      return "blue";
    case "planned":
      return "orange";
    case "cancelled":
      return "red";
    default:
      return "gray";
  }
}

function toneFill(doc, tone) {
  const rgb = TONE_RGB[tone] || TONE_RGB.gray;
  return { fillColor: rgb.fill, textColor: rgb.text };
}

function headerBar(doc, title, subtitle, rightText) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(...INK.navy);
  doc.rect(0, 0, pageW, 36, "F");
  doc.setFillColor(...INK.gold);
  doc.rect(0, 36, pageW, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...INK.gold);
  doc.text("GECIAN ALUMNI NETWORK", 12, 10);
  doc.setFontSize(18);
  doc.setTextColor(...INK.white);
  doc.text(title, 12, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(190, 190, 210);
  doc.text(subtitle, 12, 28);
  if (rightText) doc.text(rightText, pageW - 12, 20, { align: "right" });
}

function footers(doc, label) {
  const pages = doc.getNumberOfPages();
  const dateStr = stampLong();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...INK.muted);
    doc.text(`${label} · ${dateStr}`, 12, pageH - 6);
    doc.text(`${i} / ${pages}`, pageW - 12, pageH - 6, { align: "right" });
  }
}

function txt(value) {
  return { type: String, value: value == null || value === "" ? "—" : String(value) };
}

/** All remarks for one alumni, newest first, one per line: "19 Nov 2026 · Name: text". */
function remarksText(person) {
  const list = Array.isArray(person?.remarks) ? [...person.remarks] : [];
  const ms = (r) => r?.at?.toMillis?.() ?? (r?.at ? new Date(r.at).getTime() : 0);
  return list
    .sort((a, b) => ms(b) - ms(a))
    .map((r) => {
      const t = ms(r);
      const when = t
        ? new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
        : "";
      return [when, r.byName].filter(Boolean).join(" · ") + ": " + (r.text || "");
    })
    .join("\n");
}

function num(value) {
  return { type: Number, value: Number(value) || 0, align: "right" };
}

function sheetOf(name, headers, widths, rows) {
  return {
    name,
    columns: headers.map((header, i) => ({ width: widths[i] || 16 })),
    data: [
      headers.map((header) => ({ type: String, value: header, fontWeight: "bold", ...SHEET_HEAD })),
      ...rows,
    ],
  };
}

function activityLabel(value) {
  return labelOf(NETWORK_ACTIVITY_WILLINGNESS, value);
}

export async function downloadNetworkPdf({ people = [], generatedBy = "" } = {}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  headerBar(
    doc,
    "Alumni network directory",
    `${people.length} connected alumni · ${stampLong()}`,
    generatedBy
  );

  autoTable(doc, {
    startY: 44,
    margin: { left: 12, right: 12 },
    styles: { fontSize: 7.4, cellPadding: 1.6, textColor: INK.text, overflow: "linebreak" },
    headStyles: { fillColor: INK.navy, textColor: INK.white, fontStyle: "bold", fontSize: 7.4 },
    head: [
      [
        "#",
        "Name",
        "Branch",
        "Year",
        "Phone",
        "Job",
        "Connected via",
        "Response",
        ...NETWORK_ACTIVITY_FIELDS.map((f) => f.short),
      ],
    ],
    body: people.map((p, i) => [
      i + 1,
      p.alumniName || "—",
      deptLabel(p.department),
      p.batch || "—",
      p.whatsapp || p.mobile || "—",
      [p.jobRole, p.company, p.jobSector].filter(Boolean).join(" · ") || "—",
      p.referredByName || labelOf(NETWORK_ORIGIN_KINDS, p.originKind),
      labelOf(NETWORK_CONNECT_STATUS, p.connectStatus),
      ...NETWORK_ACTIVITY_FIELDS.map((f) => activityLabel(p[f.key])),
    ]),
    didParseCell: (data) => {
      if (data.section !== "body") return;
      if (data.column.index === 7) {
        Object.assign(data.cell.styles, toneFill(doc, connectTone(people[data.row.index]?.connectStatus)));
      }
      NETWORK_ACTIVITY_FIELDS.forEach((f, offset) => {
        if (data.column.index === 8 + offset) {
          Object.assign(data.cell.styles, toneFill(doc, activityTone(people[data.row.index]?.[f.key])));
        }
      });
    },
  });

  footers(doc, "GECIAN Alumni Network");
  doc.save(`alumni-network-${stampFile()}.pdf`);
}

export async function downloadNetworkExcel({ people = [] } = {}) {
  const list = sheetOf(
    "Network",
    [
      "#",
      "Name",
      "Department",
      "Passout year",
      "Phone",
      "Email",
      "Company",
      "Role",
      "Sector",
      "Source",
      "Connected via",
      "Referrer phone",
      "Response",
      ...NETWORK_ACTIVITY_FIELDS.map((f) => f.label),
      "Notes",
      "Remarks",
    ],
    [6, 28, 28, 12, 14, 28, 24, 20, 18, 18, 24, 14, 14, ...NETWORK_ACTIVITY_FIELDS.map(() => 16), 36, 60],
    people.map((p, i) => [
      num(i + 1),
      txt(p.alumniName),
      txt(deptLabel(p.department)),
      txt(p.batch),
      txt(p.whatsapp || p.mobile),
      txt(p.email),
      txt(p.company),
      txt(p.jobRole),
      txt(p.jobSector),
      txt(labelOf(NETWORK_ORIGIN_KINDS, p.originKind)),
      txt(p.referredByName),
      txt(p.referredByPhone),
      txt(labelOf(NETWORK_CONNECT_STATUS, p.connectStatus)),
      ...NETWORK_ACTIVITY_FIELDS.map((f) => txt(activityLabel(p[f.key]))),
      txt(p.notes),
      txt(remarksText(p)),
    ])
  );
  await writeExcelFile([list], { fileName: `alumni-network-${stampFile()}.xlsx` });
}

export async function downloadProgramsPdf({ programs = [], generatedBy = "" } = {}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  headerBar(
    doc,
    "Alumni programmes",
    `Talks, sharing, funding and sponsorship · ${programs.length} records · ${stampLong()}`,
    generatedBy
  );

  autoTable(doc, {
    startY: 44,
    margin: { left: 12, right: 12 },
    styles: { fontSize: 8, cellPadding: 1.8, textColor: INK.text, overflow: "linebreak" },
    headStyles: { fillColor: INK.navy, textColor: INK.white, fontStyle: "bold" },
    head: [["#", "Type", "Title", "Alumni", "Date", "Venue", "Amount (INR)", "Status", "Notes"]],
    body: programs.map((p, i) => [
      i + 1,
      labelOf(PROGRAM_KINDS, p.kind),
      p.title || "—",
      p.alumniName || "—",
      p.date || "—",
      p.venue || deptLabel(p.department),
      p.amount ? Number(p.amount).toLocaleString("en-IN") : "—",
      labelOf(PROGRAM_STATUS, p.status),
      p.notes || "—",
    ]),
    didParseCell: (data) => {
      if (data.section !== "body" || data.column.index !== 7) return;
      Object.assign(data.cell.styles, toneFill(doc, programTone(programs[data.row.index]?.status)));
    },
  });

  footers(doc, "GECIAN Alumni programmes");
  doc.save(`alumni-programmes-${stampFile()}.pdf`);
}

export async function downloadProgramsExcel({ programs = [] } = {}) {
  const list = sheetOf(
    "Programmes",
    ["#", "Type", "Title", "Alumni", "Department", "Date", "Venue", "Amount (INR)", "Status", "Notes"],
    [6, 20, 36, 28, 28, 14, 24, 16, 14, 40],
    programs.map((p, i) => [
      num(i + 1),
      txt(labelOf(PROGRAM_KINDS, p.kind)),
      txt(p.title),
      txt(p.alumniName),
      txt(deptLabel(p.department)),
      txt(p.date),
      txt(p.venue),
      num(p.amount),
      txt(labelOf(PROGRAM_STATUS, p.status)),
      txt(p.notes),
    ])
  );

  const summary = sheetOf(
    "By type",
    ["Type", "Count", "Planned", "Confirmed", "Completed", "Cancelled", "Amount (INR)"],
    [22, 12, 12, 14, 14, 14, 16],
    PROGRAM_KINDS.map((kind) => {
      const rows = programs.filter((p) => p.kind === kind.value);
      const count = (status) => rows.filter((p) => p.status === status).length;
      return [
        txt(kind.label),
        num(rows.length),
        num(count("planned")),
        num(count("confirmed")),
        num(count("completed")),
        num(count("cancelled")),
        num(rows.reduce((n, p) => n + (Number(p.amount) || 0), 0)),
      ];
    })
  );

  await writeExcelFile([summary, list], { fileName: `alumni-programmes-${stampFile()}.xlsx` });
}
