import readXlsxFile from "https://cdn.jsdelivr.net/npm/read-excel-file@5.8.8/+esm";
import { DEPARTMENTS, JOB_SECTORS, MAX_MEMBERS_ATTENDING } from "./constants.js";

function cellText(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.round(value));
  }
  if (typeof value === "object") {
    if (value.text) return cellText(value.text);
    if (value.hyperlink) return cellText(String(value.hyperlink).replace(/^(tel:|mailto:)/i, ""));
    if (value.email) return cellText(value.email);
    return "";
  }
  return String(value).trim().replace(/\.0$/, "");
}

function normalizeHeader(value) {
  return cellText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findCol(headers, predicates) {
  return headers.findIndex((h) => predicates.some((p) => p(h)));
}

export function inferDepartmentCode(value) {
  const raw = cellText(value);
  if (!raw) return "";
  const upper = raw.toUpperCase().trim();
  if (DEPARTMENTS.some((d) => d.value === upper)) return upper;
  const t = raw.toLowerCase();
  const byLabel = DEPARTMENTS.find((d) => d.label.toLowerCase() === t);
  if (byLabel) return byLabel.value;
  if (/\bcse\b|computer|cs e|c\.s\.e/.test(t)) return "CSE";
  if (/\bece\b|electronics and comm|electronics & comm|e\.c\.e/.test(t)) return "ECE";
  if (/\beee\b|electrical|e\.e\.e/.test(t)) return "EEE";
  if (/\bmech\b|mechanical/.test(t)) return "MECH";
  if (/\bit\b|information tech/.test(t)) return "IT";
  return "";
}

export function inferJobSector(value) {
  const t = cellText(value).toLowerCase();
  if (!t) return "";
  const exact = JOB_SECTORS.find((s) => s.toLowerCase() === t);
  if (exact) return exact;
  if (/software|it\b|developer|programmer/.test(t)) return "IT / Software";
  if (/core|mechanical|civil|manufactur/.test(t)) return "Core Engineering";
  if (/embed|electronics|vlsi|semicon/.test(t)) return "Electronics / Embedded";
  if (/academ|research|phd|professor|lectur/.test(t)) return "Academia / Research";
  if (/government|govt|psu|public sector/.test(t)) return "Government / PSU";
  if (/startup|entrepreneur|own business/.test(t)) return "Entrepreneurship / Startup";
  if (/finance|consult|bank|audit/.test(t)) return "Finance / Consulting";
  if (/health|biotech|pharma|medical/.test(t)) return "Healthcare / Biotech";
  if (/other/.test(t)) return "Other";
  return "";
}

function parseMembers(value) {
  const raw = cellText(value);
  if (!raw) return 1;
  const digits = raw.match(/\d+/);
  const n = digits ? Number(digits[0]) : 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_MEMBERS_ATTENDING);
}

function parseYear(value) {
  const raw = cellText(value);
  const m = raw.match(/(19|20)\d{2}/);
  return m ? m[0] : "";
}

function parsePhone(value) {
  let digits = cellText(value).replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  return digits;
}

/**
 * Parse a Google Form “GECI Alumni Registration (Responses)” export.
 * Header names vary, so columns are matched by aliases.
 */
export async function parseAlumniRegistrationExcel(file) {
  const rows = await readXlsxFile(file);
  if (!rows.length) {
    return { records: [], errors: ["The spreadsheet is empty."] };
  }

  const headers = rows[0].map(normalizeHeader);
  const col = {
    email: findCol(headers, [(h) => h.includes("email")]),
    emailAlt: (() => {
      const idxs = headers
        .map((h, i) => (h.includes("email") ? i : -1))
        .filter((i) => i >= 0);
      return idxs.length > 1 ? idxs[idxs.length - 1] : -1;
    })(),
    name: findCol(headers, [
      (h) => /^(full )?name$/.test(h),
      (h) => h.includes("alumni name"),
      (h) => h.includes("participant"),
      (h) => h === "name of alumni" || h.includes("your name"),
      (h) => h.includes("name") && !h.includes("file") && !h.includes("team"),
    ]),
    batch: findCol(headers, [
      (h) => h.includes("pass out") || h.includes("passout"),
      (h) => h.includes("passing"),
      (h) => h.includes("graduation year") || h.includes("year of grad"),
      (h) => h.includes("year of pass"),
      (h) => h === "batch" || h.includes("batch year") || h.endsWith(" batch"),
      (h) => h === "year" || h === "year of passing out",
    ]),
    department: findCol(headers, [
      (h) => h.includes("department"),
      (h) => h.includes("branch"),
      (h) => h.includes("programme") || h.includes("program"),
    ]),
    whatsapp: findCol(headers, [(h) => h.includes("whatsapp") || h.includes("wa no")]),
    mobile: findCol(headers, [
      (h) => h.includes("mobile"),
      (h) => h.includes("phone") && !h.includes("whatsapp"),
      (h) => h.includes("contact no") || h.includes("contact number"),
    ]),
    address: findCol(headers, [(h) => h.includes("address") || h.includes("residence")]),
    company: findCol(headers, [
      (h) => h.includes("company"),
      (h) => h.includes("organisation") || h.includes("organization"),
      (h) => h.includes("institution") || h.includes("employer"),
      (h) => h.includes("working at") || h.includes("place of work"),
    ]),
    jobRole: findCol(headers, [
      (h) => h.includes("designation"),
      (h) => h.includes("job role") || h.includes("job title"),
      (h) => h.includes("current role") || h.includes("position"),
    ]),
    jobSector: findCol(headers, [(h) => h.includes("sector") || h.includes("industry") || h.includes("domain")]),
    members: findCol(headers, [
      (h) => h.includes("number of family") || h.includes("no of family") || h.includes("no of members"),
      (h) => (h.includes("family") || h.includes("accompanying")) && (h.includes("number") || h.includes("count") || h.includes("how many")),
      (h) => h.includes("members") && !h.includes("bringing"),
      (h) => h.includes("guests"),
    ]),
    timestamp: findCol(headers, [(h) => h.includes("timestamp")]),
  };

  if (col.name < 0) {
    return {
      records: [],
      errors: ["Could not find a Name column. Use the Google Form responses export as-is."],
    };
  }

  const records = [];
  const errors = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const alumniName = col.name >= 0 ? cellText(row[col.name]) : "";
    const emailSubmitter = col.email >= 0 ? cellText(row[col.email]) : "";
    const emailAlt = col.emailAlt >= 0 ? cellText(row[col.emailAlt]) : "";
    const email = emailAlt || emailSubmitter;
    const mobile = col.mobile >= 0 ? parsePhone(row[col.mobile]) : "";
    const whatsapp = col.whatsapp >= 0 ? parsePhone(row[col.whatsapp]) : "";
    if (!alumniName && !email && !mobile && !whatsapp) continue;

    if (!alumniName) {
      errors.push(`Row ${i + 1}: missing name — skipped.`);
      continue;
    }

    const departmentLabel = col.department >= 0 ? cellText(row[col.department]) : "";
    const jobSectorRaw = col.jobSector >= 0 ? cellText(row[col.jobSector]) : "";
    const jobRole = col.jobRole >= 0 ? cellText(row[col.jobRole]) : "";

    records.push({
      alumniName,
      email,
      mobile: mobile || whatsapp,
      whatsapp: whatsapp || mobile,
      address: col.address >= 0 ? cellText(row[col.address]) : "",
      company: col.company >= 0 ? cellText(row[col.company]) : "",
      jobRole: jobRole || (!inferJobSector(jobSectorRaw) ? jobSectorRaw : ""),
      jobSector: inferJobSector(jobSectorRaw),
      batch: col.batch >= 0 ? parseYear(row[col.batch]) : "",
      department: inferDepartmentCode(departmentLabel),
      departmentLabel,
      membersAttending: col.members >= 0 ? parseMembers(row[col.members]) : 1,
      formTimestamp: col.timestamp >= 0 ? cellText(row[col.timestamp]) : "",
      excelRow: i + 1,
    });
  }

  return { records, errors };
}
