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

/**
 * First passout / programme start year used for alumni outreach pool size.
 * Mechanical started later (2013), so it has fewer batches than other branches.
 */
export const DEPARTMENT_BATCH_START_YEAR = {
  CSE: 2000,
  ECE: 2000,
  EEE: 2000,
  IT: 2000,
  MECH: 2013,
};

/** Inclusive end year for batch-pool sizing (GECI alumni outreach window). */
export const ALUMNI_BATCH_POOL_END_YEAR = 2025;

/**
 * Explicit leaderboard score multipliers (overrides auto pool-ratio when set).
 * MECH uses 1.5 for fewer batches since 2013 — not the full 26/13 ≈ 2× ratio.
 */
export const DEPARTMENT_SCORE_WEIGHT_OVERRIDE = {
  MECH: 1.5,
};

export const ADMIN_USERNAME = "gecian@admin";
export const ADMIN_PASSWORD = "gecian_GECI26";

export const SESSION_KEY = "gecian_session";
export const USERS_COLLECTION = "institutional_users";
export const SESSIONS_COLLECTION = "sessions";
export const REGISTRY_DOC = "_registry";
export const TEAMS_DOC = "teams";
export const MAIN_TASKS_COLLECTION = "main_tasks";
export const DEPT_TASKS_COLLECTION = "dept_tasks";
/** Firestore collection for Alumni Connect contact records */
export const ALUMNI_CONTACTS_COLLECTION = "alumni_contacts";
/** Desk / spot check-ins — separate from Alumni Connect outreach */
export const EVENT_REGISTRATIONS_COLLECTION = "event_registrations";
/** Google Form pre-registrations uploaded by admin for desk search */
export const PRE_REGISTRATIONS_COLLECTION = "pre_registrations";
/** Firestore collection for volunteer internship certificate batches */
export const VOLUNTEER_CERTIFICATE_BATCHES = "volunteer_certificate_batches";
/** settings/{REGISTRATION_SETTINGS_DOC} — LEGECI registration fee */
export const REGISTRATION_SETTINGS_DOC = "registration";
/** settings/{EVENT_DESK_PREREG_DOC} — Google Form responses for Event Desk search */
export const EVENT_DESK_PREREG_DOC = "event_desk_prereg";
/** Discriminator so Event Desk check-ins are not mixed into Alumni Connect lists */
export const EVENT_DESK_RECORD_KIND = "event_desk";

export function isEventDeskRecord(record) {
  return record?.recordKind === EVENT_DESK_RECORD_KIND;
}

/** LEGECI treasurer accounting */
export const LEGECI_EXPENSES_COLLECTION = "legeci_expenses";
export const LEGECI_SETTLEMENTS_COLLECTION = "legeci_settlements";

export const EXPENSE_CATEGORIES = [
  { value: "venue", label: "Venue / Facilities" },
  { value: "food", label: "Food & Catering" },
  { value: "printing", label: "Printing & Stationery" },
  { value: "travel", label: "Travel & Transport" },
  { value: "decor", label: "Decoration" },
  { value: "media", label: "Media & Publicity" },
  { value: "gifts", label: "Gifts & Mementos" },
  { value: "tech", label: "Tech / AV" },
  { value: "misc", label: "Miscellaneous" },
];

export const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

export const EXPENSE_STATUS = {
  PENDING: "pending",
  PARTIAL: "partial",
  SETTLED: "settled",
};

export const TASK_TYPES = {
  GENERAL: "general",
  ALUMNI_CONNECT: "alumni_connect",
  VOLUNTEER_CERTIFICATE: "volunteer_certificate",
  EVENT_REGISTRATION: "event_registration",
};

export const TASK_TYPE_LABELS = {
  [TASK_TYPES.GENERAL]: "General",
  [TASK_TYPES.ALUMNI_CONNECT]: "Alumni Connect",
  [TASK_TYPES.VOLUNTEER_CERTIFICATE]: "Volunteer Certificate",
  [TASK_TYPES.EVENT_REGISTRATION]: "Event Registration",
};

export const EVENT_REG_SOURCES = {
  GOOGLE_FORM: "google_form",
  ALUMNI_CONNECT: "alumni_connect",
  SPOT: "spot",
};

export const CERTIFICATE_SIGNATORIES = [
  { name: "Dr. Baiju Sasidharan", title: "Principal" },
  { name: "Dr. Manju Manuel", title: "Dean, Alumni & International Affairs" },
  { name: "Prof. Rejin R", title: "Alumni Association Secretary" },
];

export const CERTIFICATE_PERIOD = "16th June 2026 to 30th June 2026";
export const CERTIFICATE_EVENT = "LEGECI 2026";
export const CERTIFICATE_INSTITUTION = "Government Engineering College Idukki";
export const CERTIFICATE_ISSUER = "Alumni Association";
export const CERTIFICATE_PROGRAMME = "B.Tech";

export const CERTIFICATE_TEMPLATES = [
  {
    id: "classic",
    name: "Classic Formal",
    description: "Navy and gold academic frame — traditional internship certificate.",
  },
  {
    id: "heritage",
    name: "Heritage Scroll",
    description: "Parchment and gold ornaments — commemorative LEGECI style.",
  },
  {
    id: "modern",
    name: "Modern Minimal",
    description: "Clean teal accent with contemporary layout.",
  },
  {
    id: "jubilee",
    name: "Jubilee",
    description: "Purple and gold — GECI Silver Jubilee branding.",
  },
];

export const WILLINGNESS_OPTIONS = [
  { value: "willing", label: "Willing to attend" },
  { value: "not_willing", label: "Not willing" },
  { value: "undecided", label: "Undecided" },
  { value: "no_response", label: "Contacted — no response" },
];

export const REGISTRATION_OPTIONS = [
  { value: "not_registered", label: "Not registered" },
  { value: "pending_payment", label: "Registered — payment pending" },
  { value: "paid", label: "Registered — paid" },
];

export const JOB_SECTORS = [
  "IT / Software",
  "Core Engineering",
  "Electronics / Embedded",
  "Academia / Research",
  "Government / PSU",
  "Entrepreneurship / Startup",
  "Finance / Consulting",
  "Healthcare / Biotech",
  "Other",
];

export const DEFAULT_REGISTRATION = {
  feeAmount: 0,
  feeCurrency: "INR",
  feeNote: "LEGECI event registration fee (per person)",
};

/** Soft cap for party size on one alumni registration record. */
export const MAX_MEMBERS_ATTENDING = 50;

export const DEFAULT_TEAMS = [
  { id: "media", name: "Media team", active: true },
  { id: "outreach", name: "Outreach team", active: true },
];

export function normalizeUsername(username) {
  return username.trim().toLowerCase().replace(/@/g, "_at_").replace(/\./g, "_");
}

export const MEETUP_NAME = "LEGECI";
export const MEETUP_TAGLINE = "The Legacy Continues";

export const DEFAULT_MEETUP = {
  title: MEETUP_NAME,
  tagline: MEETUP_TAGLINE,
  date: "2026-08-22",
  venue: "Government Engineering College Idukki",
  description:
    "Join us for LEGECI — The Legacy Continues. As GECI celebrates its Silver Jubilee, reconnect with batchmates, faculty, and the entire GECIAN family on this special day.",
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

/** Render 16th / 30th with superscript ordinals for HTML previews. */
export function escapeHtmlWithOrdinals(str) {
  return escapeHtml(str).replace(/(\d+)(st|nd|rd|th)/gi, "$1<sup>$2</sup>");
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
