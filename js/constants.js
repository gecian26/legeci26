export const ROLES = {
  ADMIN: "admin",
  FACULTY: "faculty_coordinator",
  STUDENT: "student_volunteer",
  SECRETARY: "secretary",
  JOINT_SECRETARY: "joint_secretary",
  PRINCIPAL: "principal",
  DEAN: "dean_alumni_international",
  TREASURER: "treasurer",
};

export const ROLE_LABELS = {
  [ROLES.ADMIN]: "Administrator",
  [ROLES.FACULTY]: "Faculty Coordinator",
  [ROLES.STUDENT]: "Student Volunteer",
  [ROLES.SECRETARY]: "Secretary",
  [ROLES.JOINT_SECRETARY]: "Joint Secretary",
  [ROLES.PRINCIPAL]: "Principal",
  [ROLES.DEAN]: "DEAN - Alumni & International Affairs",
  [ROLES.TREASURER]: "Treasurer",
};

export const DEPARTMENTS = [
  { value: "CSE", label: "Computer Science & Engineering" },
  { value: "ECE", label: "Electronics & Communication" },
  { value: "EEE", label: "Electrical & Electronics" },
  { value: "MECH", label: "Mechanical Engineering" },
  { value: "IT", label: "Information Technology" },
];

export const ADMIN_USERNAME = "gecian@admin";
export const ADMIN_PASSWORD = "gecian_GECI26";

export const SESSION_KEY = "gecian_session";
export const USERS_COLLECTION = "institutional_users";
export const SESSIONS_COLLECTION = "sessions";
export const REGISTRY_DOC = "_registry";

export function normalizeUsername(username) {
  return username.trim().toLowerCase().replace(/@/g, "_at_").replace(/\./g, "_");
}

export const DEFAULT_MEETUP = {
  title: "Mega Alumni Meetup 2026",
  date: "2026-08-22",
  venue: "Government Engineering College Idukki",
  description:
    "Join us for the grand Mega Alumni Meetup as GECI celebrates its Silver Jubilee. Reconnect with batchmates, faculty, and the entire GECIAN family on this special day.",
  published: true,
};

export function formatDate(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatDateShort(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

export function showToast(el, message, type = "") {
  if (!el) return;
  el.textContent = message;
  el.className = `toast toast--visible${type ? ` toast--${type}` : ""}`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.classList.remove("toast--visible");
  }, 4000);
}
