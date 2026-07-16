import writeExcelFile from "https://cdn.jsdelivr.net/npm/write-excel-file@4.1.1/browser/+esm";
import dataValidationFeature from "https://cdn.jsdelivr.net/npm/@onparallel/write-excel-file-data-validation@1.0.0/+esm";
import readXlsxFile from "https://cdn.jsdelivr.net/npm/read-excel-file@5.8.8/+esm";
import { DEPARTMENTS } from "./constants.js";

const DEPARTMENT_CODES = DEPARTMENTS.map((d) => d.value);

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

export async function downloadVolunteerTemplate(teams) {
  const activeTeams = (teams || []).filter((t) => t.active !== false);
  const teamIds = activeTeams.map((t) => t.id);
  const teamValues = teamIds.length ? teamIds : ["media"];

  const volunteersData = [
    [
      { value: "fullName", ...HEADER_STYLE },
      { value: "mobile", ...HEADER_STYLE },
      { value: "department", ...HEADER_STYLE },
      { value: "team", ...HEADER_STYLE },
    ],
    [
      "Asha Krishnan",
      { value: "9876543210", type: String },
      "CSE",
      teamValues[0],
    ],
    [
      "Rahul Nair",
      { value: "9876543211", type: String },
      "CSE",
      teamValues[1] || teamValues[0],
    ],
  ];

  const instructionLines = [
    "GECIAN Alumni Network — Volunteer upload template",
    "",
    "1. Fill rows in the Volunteers sheet (do not change column headers).",
    "2. mobile = login username AND temporary password (10–15 digits).",
    "3. Volunteers must change password after first login.",
    "4. department and team must be chosen from dropdowns.",
    "",
    `Departments: ${DEPARTMENT_CODES.join(", ")}`,
    `Teams: ${activeTeams.map((t) => `${t.id} (${t.name})`).join(", ") || "Configure teams in Admin → Teams"}`,
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
      columns: [{ width: 30 }, { width: 18 }, { width: 16 }, { width: 16 }],
      dataValidation: [
        {
          cellRange: {
            from: { row: 2, column: 3 },
            to: { row: 1000, column: 3 },
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
        {
          cellRange: {
            from: { row: 2, column: 4 },
            to: { row: 1000, column: 4 },
          },
          validation: {
            type: "list",
            values: teamValues,
            allowBlank: false,
            showErrorMessage: true,
            errorTitle: "Invalid team",
            error: "Choose a team from the dropdown list.",
          },
        },
      ],
    },
    {
      sheet: "Instructions",
      data: instructionsData,
      columns: [{ width: 90 }],
    },
  ];

  await writeExcelFile(sheets, { features: [dataValidationFeature] }).toFile(
    "volunteers-template.xlsx"
  );
}

export async function parseVolunteerExcel(file) {
  let rows;
  try {
    rows = await readXlsxFile(file, { sheet: "Volunteers" });
  } catch {
    rows = await readXlsxFile(file);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((h) => cellText(h).toLowerCase());
  const col = {
    fullName: headers.findIndex((h) => h === "fullname" || h === "name"),
    mobile: headers.findIndex((h) => h === "mobile" || h === "phone" || h === "username"),
    department: headers.findIndex((h) => h === "department"),
    team: headers.findIndex((h) => h === "team"),
  };

  if (col.fullName < 0) col.fullName = 0;
  if (col.mobile < 0) col.mobile = 1;
  if (col.department < 0) col.department = 2;
  if (col.team < 0) col.team = 3;

  const parsed = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const fullName = cellText(row[col.fullName]);
    const mobile = cellText(row[col.mobile]).replace(/[\s\-]/g, "");
    const department = cellText(row[col.department]);
    const team = cellText(row[col.team]).toLowerCase();

    if (!fullName && !mobile && !department && !team) continue;

    parsed.push({
      fullname: fullName,
      mobile,
      department,
      team,
    });
  }

  return parsed;
}
