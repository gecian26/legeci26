import writeExcelFile from "https://cdn.jsdelivr.net/npm/write-excel-file@4.1.1/browser/+esm";
import dataValidationFeature from "https://cdn.jsdelivr.net/npm/@onparallel/write-excel-file-data-validation@1.0.0/+esm";
import readXlsxFile from "https://cdn.jsdelivr.net/npm/read-excel-file@5.8.8/+esm";
import { DEPARTMENTS } from "./constants.js";

const DEPARTMENT_CODES = DEPARTMENTS.map((d) => d.value);
const SEMESTER_VALUES = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"];

const HEADER_STYLE = {
  fontWeight: "bold",
  color: "#FFFFFF",
  backgroundColor: "#6B2D7B",
  align: "center",
};

function cellText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim().replace(/\.0$/, "");
}

export async function downloadCertificateVolunteerTemplate() {
  const volunteersData = [
    [
      { value: "fullName", ...HEADER_STYLE },
      { value: "affiliation", ...HEADER_STYLE },
      { value: "semester", ...HEADER_STYLE },
      { value: "department", ...HEADER_STYLE },
    ],
    ["Asha Krishnan", "Computer Science & Engineering", "S8", "CSE"],
    ["Rahul Nair", "Electronics & Communication", "S6", "ECE"],
    ["Meera Thomas", "Mechanical Engineering", "S7", "MECH"],
  ];

  const instructionLines = [
    "GECIAN Alumni Network — Volunteer certificate upload template",
    "",
    "Use this sheet to list active volunteers who completed the LEGECI 2026 internship.",
    "Do not change the column headers on the Volunteers sheet.",
    "",
    "Columns",
    "  fullName      — Volunteer name printed on the certificate (required).",
    "  affiliation   — Text after “of” on the certificate (required).",
    "                  Example: Computer Science & Engineering",
    "  semester      — Choose S1–S8 from the dropdown (required).",
    "  department    — Department code from the dropdown (CSE, ECE, EEE, MECH, IT).",
    "",
    "Certificate wording",
    "  This is to certify that [fullName] of [affiliation]",
    "  [Semester n] has successfully completed the internship towards",
    "  various initiatives during 15 June 2026 to 30 June 2026.",
    "",
    `Departments: ${DEPARTMENT_CODES.join(", ")}`,
    `Semesters: ${SEMESTER_VALUES.join(", ")}`,
  ];

  const instructionsData = instructionLines.map((line) => [
    line === instructionLines[0]
      ? { value: line, fontWeight: "bold", fontSize: 14 }
      : line,
  ]);

  const sheets = [
    {
      sheet: "Volunteers",
      data: volunteersData,
      columns: [{ width: 32 }, { width: 42 }, { width: 14 }, { width: 16 }],
      dataValidation: [
        {
          cellRange: {
            from: { row: 2, column: 3 },
            to: { row: 1000, column: 3 },
          },
          validation: {
            type: "list",
            values: SEMESTER_VALUES,
            allowBlank: false,
            showErrorMessage: true,
            errorTitle: "Invalid semester",
            error: "Choose a semester from the dropdown (S1–S8).",
          },
        },
        {
          cellRange: {
            from: { row: 2, column: 4 },
            to: { row: 1000, column: 4 },
          },
          validation: {
            type: "list",
            values: DEPARTMENT_CODES,
            allowBlank: false,
            showErrorMessage: true,
            errorTitle: "Invalid department",
            error: "Choose a department from the dropdown list.",
          },
        },
      ],
    },
    {
      sheet: "Instructions",
      data: instructionsData,
      columns: [{ width: 100 }],
    },
  ];

  await writeExcelFile(sheets, { features: [dataValidationFeature] }).toFile(
    "volunteer-certificate-template.xlsx"
  );
}

export async function parseCertificateVolunteerExcel(file) {
  let rows;
  try {
    rows = await readXlsxFile(file, { sheet: "Volunteers" });
  } catch {
    rows = await readXlsxFile(file);
  }

  if (!rows.length) return { volunteers: [], errors: ["Excel file is empty."] };

  const headers = rows[0].map((h) => cellText(h).toLowerCase().replace(/[\s_]+/g, ""));
  const col = {
    fullName: headers.findIndex(
      (h) => h === "fullname" || h === "name" || h === "volunteername" || h === "studentname"
    ),
    affiliation: headers.findIndex(
      (h) =>
        h === "affiliation" ||
        h === "of" ||
        h === "programme" ||
        h === "program" ||
        h === "class" ||
        h === "departmentname" ||
        h === "branch"
    ),
    semester: headers.findIndex((h) => h === "semester" || h === "sem"),
    department: headers.findIndex((h) => h === "department" || h === "dept"),
  };

  if (col.fullName < 0) col.fullName = 0;
  if (col.affiliation < 0) col.affiliation = 1;
  if (col.semester < 0) col.semester = 2;
  if (col.department < 0) col.department = 3;

  const volunteers = [];
  const errors = [];
  const seen = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const fullName = cellText(row[col.fullName]);
    const affiliation = cellText(row[col.affiliation]);
    const semester = cellText(row[col.semester]);
    let department = cellText(row[col.department]).toUpperCase();
    const rowLabel = `Row ${i + 2}`;

    if (!fullName && !affiliation && !semester && !department) continue;

    if (!fullName) {
      errors.push(`${rowLabel}: fullName is required.`);
      continue;
    }
    if (!affiliation) {
      errors.push(`${rowLabel} (${fullName}): affiliation (“of …”) is required.`);
      continue;
    }
    if (!semester) {
      errors.push(`${rowLabel} (${fullName}): semester is required (S1–S8).`);
      continue;
    }
    if (department && !DEPARTMENT_CODES.includes(department)) {
      errors.push(
        `${rowLabel} (${fullName}): department must be one of ${DEPARTMENT_CODES.join(", ")}.`
      );
      continue;
    }

    const key = `${fullName.toLowerCase()}|${affiliation.toLowerCase()}|${semester.toLowerCase()}|${department}`;
    if (seen.has(key)) {
      errors.push(`${rowLabel} (${fullName}): duplicate of an earlier row — skipped.`);
      continue;
    }
    seen.add(key);

    volunteers.push({ fullName, affiliation, semester, department });
  }

  return { volunteers, errors };
}
