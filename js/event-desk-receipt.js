import { jsPDF } from "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm";
import {
  DEPARTMENTS,
  MEETUP_TAGLINE,
  CERTIFICATE_INSTITUTION,
  DEFAULT_MEETUP,
} from "./constants.js?v=er20";

/** Helvetica cannot draw ₹ — keep amounts in ASCII. */
function pdfMoney(amount) {
  return `Rs ${Math.round(Number(amount) || 0).toLocaleString("en-IN")}`;
}

function deptLabel(code) {
  return DEPARTMENTS.find((d) => d.value === code)?.label || code || "—";
}

export function deskFeeModeLabel(mode) {
  const value = String(mode || "").toLowerCase();
  if (value === "cash") return "Cash";
  if (value === "online" || value === "upi" || value === "bank" || value === "card") return "Online";
  return mode || "—";
}

export function makeDeskReceiptNo(id) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const short =
    String(id || "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(-6)
      .toUpperCase() || String(Date.now()).slice(-6);
  return `LEGECI-${stamp}-${short}`;
}

function formatWhen(value) {
  if (!value) {
    return new Date().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function partyLine(record) {
  const members = Math.max(1, Math.floor(Number(record?.membersAttending) || 1));
  const familyRaw = Number(record?.familyAccompanying);
  const family = Number.isFinite(familyRaw) ? Math.max(0, familyRaw) : Math.max(0, members - 1);
  if (!family) return `${members} (alumni only)`;
  return `${members} (${family} accompanying family)`;
}

/**
 * Simple one-page A5 receipt for Event Desk registration fees (cash or online).
 */
export function downloadDeskFeeReceipt(record) {
  const row = record || {};
  const receiptNo = row.deskReceiptNo || makeDeskReceiptNo(row.id);
  const doc = new jsPDF({ unit: "mm", format: "a5", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const innerW = pageW - margin * 2;

  doc.setFillColor(18, 18, 42);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setFillColor(212, 175, 55);
  doc.rect(0, 28, pageW, 1.4, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text("LEGECI26", margin, 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(255, 243, 205);
  doc.text(MEETUP_TAGLINE || "", margin, 18.5);

  doc.setFontSize(8);
  doc.setTextColor(226, 232, 240);
  doc.text(CERTIFICATE_INSTITUTION || DEFAULT_MEETUP.venue || "", margin, 23.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(212, 175, 55);
  doc.text("FEE RECEIPT", pageW - margin, 16, { align: "right" });

  let y = 38;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(18, 18, 42);
  doc.text("Registration fee received", margin, y);

  y = 45;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Receipt no.  ${receiptNo}`, margin, y);
  doc.text(`Date  ${formatWhen(row.deskFeeReceivedAt)}`, pageW - margin, y, { align: "right" });

  y = 50;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.35);
  doc.line(margin, y, pageW - margin, y);

  const rows = [
    ["Received from", row.alumniName || "—"],
    ["Department", deptLabel(row.department)],
    ["Passout year", row.batch || "—"],
    ["Mobile", row.mobile || row.whatsapp || "—"],
    ["People", partyLine(row)],
    ["Payment mode", deskFeeModeLabel(row.deskFeeMode)],
  ];
  if (String(row.deskFeeRef || "").trim()) {
    rows.push(["UPI / reference", String(row.deskFeeRef).trim()]);
  }
  rows.push(["Received by", row.deskFeeReceivedBy || row.createdByName || "Event Desk"]);

  y = 58;
  rows.forEach(([label, value]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(label, margin, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    const lines = doc.splitTextToSize(String(value || "—"), innerW - 44);
    doc.text(lines, margin + 44, y);
    y += Math.max(7, lines.length * 4.6);
  });

  y += 3;
  doc.setFillColor(220, 252, 231);
  doc.roundedRect(margin, y, innerW, 18, 2.2, 2.2, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(22, 101, 52);
  doc.text("Amount received", margin + 5, y + 6.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20, 83, 45);
  doc.text(pdfMoney(row.deskFeeAmount), margin + 5, y + 14.5);

  y += 28;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  const venue = DEFAULT_MEETUP.venue || CERTIFICATE_INSTITUTION;
  doc.text(`For LEGECI26 at ${venue}.`, margin, y, { maxWidth: innerW });
  y += 6;
  doc.text("This is a computer-generated receipt for the fee collected at the Event Desk.", margin, y, {
    maxWidth: innerW,
  });

  const sigW = 54;
  const sigX = pageW - margin - sigW;
  const sigY = pageH - 28;
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.35);
  doc.line(sigX, sigY, sigX + sigW, sigY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text("Verified by, Treasurer", sigX + sigW / 2, sigY + 5, { align: "center" });

  doc.setFillColor(18, 18, 42);
  doc.rect(0, pageH - 8, pageW, 8, "F");
  doc.setFillColor(212, 175, 55);
  doc.rect(0, pageH - 8, pageW, 1, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(226, 232, 240);
  doc.text("LEGECI26 · Event Desk", margin, pageH - 3.2);
  doc.text(receiptNo, pageW - margin, pageH - 3.2, { align: "right" });

  const safe = String(receiptNo).replace(/[^\w-]+/g, "");
  doc.save(`LEGECI-receipt-${safe || "fee"}.pdf`);
}
