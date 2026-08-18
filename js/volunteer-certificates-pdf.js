import { jsPDF } from "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm";
import {
  CERTIFICATE_SIGNATORIES,
  CERTIFICATE_PERIOD,
  CERTIFICATE_INSTITUTION,
  CERTIFICATE_ISSUER,
  CERTIFICATE_PROGRAMME,
  CERTIFICATE_TEMPLATES,
  MEETUP_NAME,
  MEETUP_TAGLINE,
} from "./constants.js";

const TEMPLATES = {
  classic: {
    paper: [252, 248, 240],
    ink: [26, 26, 46],
    muted: [90, 90, 110],
    gold: [201, 162, 39],
    accent: [26, 26, 46],
    line: [201, 162, 39],
    wash: [245, 238, 220],
  },
  heritage: {
    paper: [251, 244, 228],
    ink: [74, 44, 22],
    muted: [120, 90, 60],
    gold: [184, 134, 11],
    accent: [122, 62, 24],
    line: [184, 134, 11],
    wash: [244, 232, 204],
  },
  modern: {
    paper: [255, 255, 255],
    ink: [15, 23, 42],
    muted: [100, 116, 139],
    gold: [13, 148, 136],
    accent: [15, 118, 110],
    line: [13, 148, 136],
    wash: [240, 253, 250],
  },
  jubilee: {
    paper: [252, 248, 255],
    ink: [45, 27, 78],
    muted: [107, 45, 123],
    gold: [212, 175, 55],
    accent: [107, 45, 123],
    line: [212, 175, 55],
    wash: [243, 232, 255],
  },
};

const FONT_SPECS = [
  {
    family: "Cinzel",
    style: "bold",
    file: "Cinzel-Bold.ttf",
    url: "https://cdn.jsdelivr.net/fontsource/fonts/cinzel@latest/latin-700-normal.ttf",
  },
  {
    family: "PlayfairDisplay",
    style: "bold",
    file: "PlayfairDisplay-Bold.ttf",
    url: "https://cdn.jsdelivr.net/fontsource/fonts/playfair-display@latest/latin-700-normal.ttf",
  },
  {
    family: "PlayfairDisplay",
    style: "italic",
    file: "PlayfairDisplay-Italic.ttf",
    url: "https://cdn.jsdelivr.net/fontsource/fonts/playfair-display@latest/latin-400-italic.ttf",
  },
  {
    family: "Jakarta",
    style: "normal",
    file: "PlusJakartaSans-Regular.ttf",
    url: "https://cdn.jsdelivr.net/fontsource/fonts/plus-jakarta-sans@latest/latin-400-normal.ttf",
  },
  {
    family: "Jakarta",
    style: "bold",
    file: "PlusJakartaSans-Bold.ttf",
    url: "https://cdn.jsdelivr.net/fontsource/fonts/plus-jakarta-sans@latest/latin-700-normal.ttf",
  },
];

let cachedImages = new Map();
let cachedFonts = null;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function loadFontPack() {
  if (cachedFonts) return cachedFonts;
  const loaded = [];
  await Promise.all(
    FONT_SPECS.map(async (spec) => {
      try {
        const res = await fetch(spec.url);
        if (!res.ok) return;
        loaded.push({ ...spec, b64: arrayBufferToBase64(await res.arrayBuffer()) });
      } catch {
        // Built-in fonts will be used as fallback
      }
    })
  );
  cachedFonts = loaded;
  return loaded;
}

function applyFonts(doc, fonts) {
  fonts.forEach((f) => {
    doc.addFileToVFS(f.file, f.b64);
    doc.addFont(f.file, f.family, f.style);
  });
}

function setFace(doc, family, style, fallbackFamily = "times", fallbackStyle = "normal") {
  try {
    doc.setFont(family, style);
  } catch {
    doc.setFont(fallbackFamily, fallbackStyle);
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function loadPng(relativePath) {
  if (cachedImages.has(relativePath)) return cachedImages.get(relativePath) || null;
  try {
    const url = new URL(relativePath, import.meta.url).href;
    const res = await fetch(url);
    if (!res.ok) throw new Error("image fetch failed");
    const dataUrl = await blobToDataUrl(await res.blob());
    const img = await loadImg(dataUrl);
    const data = { dataUrl, width: img.width, height: img.height };
    cachedImages.set(relativePath, data);
    return data;
  } catch {
    cachedImages.set(relativePath, false);
    return null;
  }
}

async function getLogo() {
  return (
    (await loadPng("../assets/legeci-cert-logo.png")) ||
    (await loadPng("../assets/legeci-logo.png"))
  );
}

async function getSideLogos() {
  const [geci, silver] = await Promise.all([
    loadPng("../assets/geci-logo.png"),
    loadPng("../assets/geci-silver.png"),
  ]);
  return { geci, silver };
}

function formatDateStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function slugName(name) {
  return String(name || "volunteer")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function formatAffiliationLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/\(\s*b\.?\s*tech\.?\s*\)/i.test(raw) || /\bb\.?\s*tech\.?\b/i.test(raw)) {
    return raw;
  }
  return `${raw} (${CERTIFICATE_PROGRAMME})`;
}

export function formatSemesterLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const compact = raw.replace(/\s+/g, " ");
  const num = compact.match(/(\d{1,2})/);
  if (/^s\d{1,2}$/i.test(compact.replace(/\s/g, "")) && num) {
    return `Semester ${Number(num[1])}`;
  }
  if (/^\d{1,2}$/.test(compact)) return `Semester ${Number(compact)}`;
  if (/^semester\b/i.test(compact)) return compact.replace(/^semester/i, "Semester");
  return compact;
}

function fitImageSize(image, maxW, maxH) {
  if (!image) return { w: 0, h: 0 };
  const ratio = image.width / Math.max(image.height, 1);
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w, h };
}

function drawLogo(doc, logo, cx, y, maxW, maxH) {
  if (!logo) return y + 2;
  const { w, h } = fitImageSize(logo, maxW, maxH);
  doc.addImage(logo.dataUrl, "PNG", cx - w / 2, y, w, h, undefined, "FAST");
  return y + h;
}

function drawSideLogos(doc, pageW, y, sideLogos, templateId) {
  const geciMax = 34;
  const silverMax = 50;
  const leftPad = templateId === "modern" ? 18 : 16;
  const rightPad = 14;
  if (sideLogos?.geci) {
    const { w, h } = fitImageSize(sideLogos.geci, geciMax, geciMax);
    doc.addImage(sideLogos.geci.dataUrl, "PNG", leftPad, y, w, h, undefined, "FAST");
  }
  if (sideLogos?.silver) {
    const { w, h } = fitImageSize(sideLogos.silver, silverMax, silverMax);
    doc.addImage(
      sideLogos.silver.dataUrl,
      "PNG",
      pageW - rightPad - w,
      y - 6,
      w,
      h,
      undefined,
      "FAST"
    );
  }
}

function drawCornerOrnament(doc, x, y, dirX, dirY, color) {
  doc.setDrawColor(...color);
  doc.setLineWidth(0.85);
  doc.line(x, y, x + dirX * 22, y);
  doc.line(x, y, x, y + dirY * 22);
  doc.setLineWidth(0.28);
  doc.line(x + dirX * 2.4, y + dirY * 2.4, x + dirX * 16, y + dirY * 2.4);
  doc.line(x + dirX * 2.4, y + dirY * 2.4, x + dirX * 2.4, y + dirY * 16);
  doc.setFillColor(...color);
  doc.circle(x + dirX * 3.2, y + dirY * 3.2, 0.9, "F");
}

function fillPage(doc, rgb) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setFillColor(...rgb);
  doc.rect(0, 0, w, h, "F");
}

function drawWatermark(doc, pageW, pageH, colors) {
  try {
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.045 }));
  } catch {
    return;
  }
  setFace(doc, "Cinzel", "bold", "times", "bold");
  doc.setFontSize(64);
  doc.setTextColor(...colors.accent);
  doc.text(MEETUP_NAME, pageW / 2, pageH / 2 + 8, {
    align: "center",
    angle: -16,
  });
  try {
    doc.restoreGraphicsState();
  } catch {
    // ignore
  }
}

function drawGoldDivider(doc, cx, y, colors, width = 46) {
  doc.setDrawColor(...colors.gold);
  doc.setLineWidth(0.45);
  doc.line(cx - width, y, cx - 5, y);
  doc.line(cx + 5, y, cx + width, y);
  doc.setFillColor(...colors.gold);
  doc.circle(cx, y, 1.35, "F");
  doc.setDrawColor(...colors.gold);
  doc.setLineWidth(0.25);
  doc.circle(cx, y, 2.3, "S");
}

function drawCenteredMixed(doc, segments, cx, startY, maxW, fontSize, lineH, fallbackFamily, fallbackStyle) {
  const measured = segments.map((s) => {
    setFace(doc, s.family, s.style, fallbackFamily, fallbackStyle);
    doc.setFontSize(fontSize);
    return { ...s, width: doc.getTextWidth(s.text) };
  });

  const lines = [];
  let current = [];
  let currentW = 0;
  measured.forEach((seg) => {
    if (current.length && currentW + seg.width > maxW) {
      lines.push(current);
      current = [seg];
      currentW = seg.width;
    } else {
      current.push(seg);
      currentW += seg.width;
    }
  });
  if (current.length) lines.push(current);

  let y = startY;
  lines.forEach((line) => {
    const total = line.reduce((sum, s) => sum + s.width, 0);
    let x = cx - total / 2;
    line.forEach((s) => {
      setFace(doc, s.family, s.style, fallbackFamily, fallbackStyle);
      doc.setFontSize(fontSize);
      doc.setTextColor(...s.color);
      doc.text(s.text, x, y);
      x += s.width;
    });
    y += lineH;
  });
  return y;
}

function wrapCenter(doc, text, maxW, fontSize) {
  doc.setFontSize(fontSize);
  return doc.splitTextToSize(text, maxW);
}

function drawWrappedCenter(doc, lines, x, y, lineH) {
  lines.forEach((line, i) => {
    doc.text(line, x, y + i * lineH, { align: "center" });
  });
  return y + Math.max(lines.length, 1) * lineH;
}

function drawSignatures(doc, pageW, y, colors) {
  const signatories = CERTIFICATE_SIGNATORIES;
  const count = signatories.length;
  const usable = pageW - 40;
  const slot = usable / count;
  const startX = 20 + slot / 2;

  signatories.forEach((s, i) => {
    const x = startX + i * slot;
    doc.setDrawColor(...colors.line);
    doc.setLineWidth(0.45);
    doc.line(x - 36, y, x + 36, y);

    setFace(doc, "PlayfairDisplay", "bold", "times", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...colors.ink);
    const nameLines = doc.splitTextToSize(s.name, 78);
    nameLines.forEach((line, li) => {
      doc.text(line, x, y + 7 + li * 5.2, { align: "center" });
    });

    setFace(doc, "Jakarta", "normal", "helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...colors.muted);
    const titleY = y + 7 + nameLines.length * 5.2 + 1.5;
    const titleLines = doc.splitTextToSize(s.title, 80);
    titleLines.forEach((line, li) => {
      doc.text(line, x, titleY + li * 4.4, { align: "center" });
    });
  });
}

function drawBody(doc, volunteer, colors, pageW, startY, maxW, maxY) {
  const name = volunteer.fullName || "—";
  const affiliation = formatAffiliationLabel(volunteer.affiliation || "—");
  const semester = formatSemesterLabel(volunteer.semester);
  const cx = pageW / 2;
  let y = startY;

  setFace(doc, "PlayfairDisplay", "italic", "times", "italic");
  doc.setFontSize(13.5);
  doc.setTextColor(...colors.muted);
  doc.text("This is to certify that", cx, y, { align: "center" });
  y += 11;

  setFace(doc, "PlayfairDisplay", "bold", "times", "bold");
  const nameSize = name.length > 28 ? 20 : 24;
  doc.setFontSize(nameSize);
  doc.setTextColor(...colors.ink);
  const nameLines = wrapCenter(doc, name, maxW, nameSize);
  const nameLineH = 8.5;
  nameLines.forEach((line, i) => {
    doc.text(line, cx, y + i * nameLineH, { align: "center" });
  });
  const nameBottom = y + (nameLines.length - 1) * nameLineH;
  const ruleY = nameBottom + 1.6;
  doc.setDrawColor(...colors.gold);
  doc.setLineWidth(0.5);
  const underlineW = Math.min(120, Math.max(52, name.length * 2.2));
  doc.line(cx - underlineW / 2, ruleY, cx + underlineW / 2, ruleY);
  y = ruleY + 7;

  setFace(doc, "PlayfairDisplay", "italic", "times", "italic");
  doc.setFontSize(12);
  doc.setTextColor(...colors.muted);
  doc.text("of", cx, y, { align: "center" });
  y += 8;

  setFace(doc, "PlayfairDisplay", "bold", "times", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...colors.accent);
  const affLines = wrapCenter(doc, affiliation, maxW, 18);
  y = drawWrappedCenter(doc, affLines, cx, y, 8);
  y += 2;

  if (semester) {
    setFace(doc, "Jakarta", "bold", "helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(...colors.gold);
    doc.text(semester, cx, y, { align: "center" });
    y += 7;
  } else {
    y += 3;
  }

  setFace(doc, "Jakarta", "normal", "helvetica", "normal");
  const bodySize = maxY && y + 18 > maxY ? 11 : 12;
  const bodyLineH = bodySize === 11 ? 5.6 : 6.4;
  y = drawCenteredMixed(
    doc,
    [
      {
        text: "has successfully completed the internship towards ",
        family: "Jakarta",
        style: "normal",
        color: colors.ink,
      },
      {
        text: "various initiatives",
        family: "Jakarta",
        style: "bold",
        color: colors.ink,
      },
      {
        text: " of ",
        family: "Jakarta",
        style: "normal",
        color: colors.ink,
      },
      {
        text: CERTIFICATE_ISSUER,
        family: "Jakarta",
        style: "bold",
        color: colors.ink,
      },
      {
        text: ", ",
        family: "Jakarta",
        style: "normal",
        color: colors.ink,
      },
      {
        text: CERTIFICATE_INSTITUTION,
        family: "Jakarta",
        style: "bold",
        color: colors.ink,
      },
      {
        text: " during ",
        family: "Jakarta",
        style: "normal",
        color: colors.ink,
      },
      {
        text: `${CERTIFICATE_PERIOD}.`,
        family: "Jakarta",
        style: "bold",
        color: colors.ink,
      },
    ],
    cx,
    y,
    maxW,
    bodySize,
    bodyLineH,
    "helvetica",
    "normal"
  );
  return y;
}

function drawClassicChrome(doc, pageW, pageH, colors) {
  fillPage(doc, colors.paper);
  doc.setFillColor(...colors.wash);
  doc.rect(6, 6, pageW - 12, pageH - 12, "F");
  doc.setFillColor(...colors.paper);
  doc.rect(11, 11, pageW - 22, pageH - 22, "F");
  doc.setDrawColor(...colors.accent);
  doc.setLineWidth(2);
  doc.rect(8, 8, pageW - 16, pageH - 16);
  doc.setDrawColor(...colors.gold);
  doc.setLineWidth(0.7);
  doc.rect(11.5, 11.5, pageW - 23, pageH - 23);
  doc.setDrawColor(...colors.accent);
  doc.setLineWidth(0.22);
  doc.rect(14, 14, pageW - 28, pageH - 28);
}

function drawHeritageChrome(doc, pageW, pageH, colors) {
  fillPage(doc, colors.paper);
  doc.setDrawColor(...colors.gold);
  doc.setLineWidth(1.8);
  doc.rect(8.5, 8.5, pageW - 17, pageH - 17);
  doc.setLineWidth(0.35);
  doc.rect(12, 12, pageW - 24, pageH - 24);
  drawCornerOrnament(doc, 16, 16, 1, 1, colors.gold);
  drawCornerOrnament(doc, pageW - 16, 16, -1, 1, colors.gold);
  drawCornerOrnament(doc, 16, pageH - 16, 1, -1, colors.gold);
  drawCornerOrnament(doc, pageW - 16, pageH - 16, -1, -1, colors.gold);
}

function drawModernChrome(doc, pageW, pageH, colors) {
  fillPage(doc, colors.paper);
  doc.setFillColor(...colors.accent);
  doc.rect(0, 0, 10, pageH, "F");
  doc.setFillColor(...colors.gold);
  doc.rect(10, 0, 2, pageH, "F");
  doc.setFillColor(...colors.wash);
  doc.rect(0, 0, pageW, 8, "F");
}

function drawJubileeChrome(doc, pageW, pageH, colors) {
  fillPage(doc, [61, 20, 84]);
  doc.setFillColor(...colors.paper);
  doc.rect(7.5, 7.5, pageW - 15, pageH - 15, "F");
  doc.setDrawColor(...colors.gold);
  doc.setLineWidth(1.3);
  doc.rect(10.5, 10.5, pageW - 21, pageH - 21);
  doc.setLineWidth(0.3);
  doc.rect(13.2, 13.2, pageW - 26.4, pageH - 26.4);
}

function drawHeading(doc, templateId, colors, pageW, y, logo) {
  const cx = pageW / 2;
  setFace(doc, "Jakarta", "bold", "helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...colors.ink);
  doc.text(CERTIFICATE_INSTITUTION.toUpperCase(), cx, y, {
    align: "center",
  });
  y += 8;

  setFace(doc, "Cinzel", "bold", "times", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...colors.accent);
  doc.text(CERTIFICATE_ISSUER.toUpperCase(), cx, y, { align: "center" });
  y += 6.5;

  y = drawLogo(doc, logo, cx, y, 108, 28) + 1.5;

  setFace(doc, "PlayfairDisplay", "italic", "times", "italic");
  doc.setFontSize(13);
  doc.setTextColor(...colors.muted);
  const tagline =
    templateId === "jubilee" ? `${MEETUP_TAGLINE}  ·  Silver Jubilee` : MEETUP_TAGLINE;
  doc.text(tagline, cx, y, { align: "center" });
  y += 9;

  setFace(doc, "Cinzel", "bold", "times", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...colors.accent);
  doc.text("CERTIFICATE OF INTERNSHIP", cx, y, { align: "center" });
  y += 5.5;
  drawGoldDivider(doc, cx, y, colors, 52);
  return y + 10;
}

function renderCertificatePage(doc, volunteer, templateId, logo, sideLogos) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const colors = TEMPLATES[templateId] || TEMPLATES.classic;
  const maxW = pageW - 70;
  const signatureY = pageH - 38;

  if (templateId === "heritage") drawHeritageChrome(doc, pageW, pageH, colors);
  else if (templateId === "modern") drawModernChrome(doc, pageW, pageH, colors);
  else if (templateId === "jubilee") drawJubileeChrome(doc, pageW, pageH, colors);
  else drawClassicChrome(doc, pageW, pageH, colors);

  drawWatermark(doc, pageW, pageH, colors);

  const sideY = templateId === "modern" ? 14 : 16;
  drawSideLogos(doc, pageW, sideY, sideLogos, templateId);

  let y = templateId === "modern" ? 30 : 29;
  y = drawHeading(doc, templateId, colors, pageW, y, logo);
  drawBody(doc, volunteer, colors, pageW, y, maxW, signatureY - 8);
  drawSignatures(doc, pageW, signatureY, colors);
}

export function certificateTemplateLabel(id) {
  return CERTIFICATE_TEMPLATES.find((t) => t.id === id)?.name || id || "Classic Formal";
}

export function normalizeCertificateTemplate(id) {
  return CERTIFICATE_TEMPLATES.some((t) => t.id === id) ? id : "classic";
}

/**
 * Generate internship certificates as a multi-page landscape PDF.
 * @param {{ volunteers: object[], templateId?: string, filename?: string }} opts
 */
export async function downloadVolunteerCertificatesPdf(opts = {}) {
  const volunteers = (opts.volunteers || []).filter((v) => v?.fullName);
  if (!volunteers.length) {
    throw new Error("No volunteers to generate certificates for.");
  }
  const templateId = normalizeCertificateTemplate(opts.templateId);
  const [logo, sideLogos, fonts] = await Promise.all([
    getLogo(),
    getSideLogos(),
    loadFontPack(),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  applyFonts(doc, fonts);

  volunteers.forEach((volunteer, index) => {
    if (index > 0) doc.addPage();
    renderCertificatePage(doc, volunteer, templateId, logo, sideLogos);
  });

  const stamp = formatDateStamp();
  const filename =
    opts.filename ||
    (volunteers.length === 1
      ? `legeci-certificate-${slugName(volunteers[0].fullName)}-${stamp}.pdf`
      : `legeci-volunteer-certificates-${templateId}-${stamp}.pdf`);
  doc.save(filename);
}

export async function downloadSampleCertificatePdf(templateId) {
  return downloadVolunteerCertificatesPdf({
    templateId,
    filename: `legeci-certificate-sample-${normalizeCertificateTemplate(templateId)}.pdf`,
    volunteers: [
      {
        fullName: "Asha Krishnan",
        affiliation: "Computer Science & Engineering",
        semester: "S8",
      },
    ],
  });
}
