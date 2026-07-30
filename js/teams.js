import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { withSession } from "./auth.js";
import { TEAMS_DOC, DEFAULT_TEAMS } from "./constants.js";

export async function loadTeams() {
  const snap = await getDoc(doc(db, "settings", TEAMS_DOC));
  if (!snap.exists()) {
    return DEFAULT_TEAMS.map((t) => ({ ...t }));
  }
  const teams = snap.data().teams || [];
  return teams.length ? teams : DEFAULT_TEAMS.map((t) => ({ ...t }));
}

export async function saveTeams(teams) {
  await setDoc(
    doc(db, "settings", TEAMS_DOC),
    withSession({
      teams,
      updatedAt: serverTimestamp(),
    })
  );
}

export function teamLabel(teams, teamId) {
  const found = (teams || []).find((t) => t.id === teamId);
  return found?.name || teamId || "—";
}

export function slugifyTeamId(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

/** Simple CSV parser supporting quoted fields */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && next === "\n") i++;
      row.push(field.trim());
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  if (field.length || row.length) {
    row.push(field.trim());
    if (row.some((c) => c !== "")) rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((cols) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] ?? "";
    });
    return obj;
  });
}

export function validateVolunteerRow(row, teams) {
  const errors = [];
  const fullName = (row.fullname || row.name || "").trim();
  const mobile = String(row.mobile || row.phone || row.username || "")
    .trim()
    .replace(/[\s\-]/g, "");
  const department = (row.department || "").trim().toUpperCase();
  const team = (row.team || "").trim().toLowerCase();

  if (!fullName) errors.push("fullName is required");
  if (!mobile) errors.push("mobile is required");
  if (mobile && !/^\d{10,15}$/.test(mobile)) {
    errors.push("mobile must be 10–15 digits (used as username and temporary password)");
  }
  if (!department) errors.push("department is required");
  if (!team) errors.push("team is required");

  const validDepts = ["CSE", "ECE", "EEE", "MECH", "IT"];
  if (department && !validDepts.includes(department)) {
    errors.push(`invalid department '${department}'`);
  }

  const activeTeams = (teams || []).filter((t) => t.active !== false).map((t) => t.id);
  if (team && !activeTeams.includes(team)) {
    errors.push(`invalid team '${team}' (use: ${activeTeams.join(", ")})`);
  }

  return {
    errors,
    data: {
      fullName,
      mobile,
      username: mobile,
      password: mobile,
      department,
      team,
    },
  };
}
