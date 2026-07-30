import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { withSession } from "./auth.js";
import {
  ALUMNI_CONTACTS_COLLECTION,
  REGISTRATION_SETTINGS_DOC,
  DEFAULT_REGISTRATION,
  WILLINGNESS_OPTIONS,
  REGISTRATION_OPTIONS,
  JOB_SECTORS,
  TASK_TYPES,
  escapeHtml,
} from "./constants.js";

export async function loadRegistrationSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", REGISTRATION_SETTINGS_DOC));
    if (snap.exists()) {
      return { ...DEFAULT_REGISTRATION, ...snap.data() };
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_REGISTRATION };
}

export async function saveRegistrationSettings(data) {
  await setDoc(
    doc(db, "settings", REGISTRATION_SETTINGS_DOC),
    withSession({
      feeAmount: Number(data.feeAmount) || 0,
      feeCurrency: data.feeCurrency || "INR",
      feeNote: (data.feeNote || "").trim(),
      updatedAt: serverTimestamp(),
    }),
    { merge: true }
  );
}

export function formatFee(settings) {
  const amount = Number(settings?.feeAmount) || 0;
  const currency = settings?.feeCurrency || "INR";
  if (amount <= 0) return "Not set";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function labelWillingness(value) {
  return WILLINGNESS_OPTIONS.find((o) => o.value === value)?.label || value || "—";
}

export function labelRegistration(value) {
  return REGISTRATION_OPTIONS.find((o) => o.value === value)?.label || value || "—";
}

export function isAlumniConnectTask(task) {
  return task?.taskType === TASK_TYPES.ALUMNI_CONNECT;
}

export function optionsHtml(options, selected = "") {
  return options
    .map(
      (o) =>
        `<option value="${escapeHtml(o.value)}" ${o.value === selected ? "selected" : ""}>${escapeHtml(o.label)}</option>`
    )
    .join("");
}

export function jobSectorOptionsHtml(selected = "") {
  return (
    '<option value="">Select sector</option>' +
    JOB_SECTORS.map(
      (s) =>
        `<option value="${escapeHtml(s)}" ${s === selected ? "selected" : ""}>${escapeHtml(s)}</option>`
    ).join("")
  );
}

export function passoutYearOptionsHtml(selected = "") {
  const years = [];
  for (let y = 2025; y >= 2004; y--) years.push(String(y));
  return (
    '<option value="">Select year</option>' +
    years
      .map(
        (y) =>
          `<option value="${y}" ${String(selected) === y ? "selected" : ""}>${y}</option>`
      )
      .join("")
  );
}

export function alumniContactFormHtml(prefix = "ac", contact = {}, feeLabel = "") {
  const c = contact || {};
  return `
    <div class="form-row">
      <div class="form-group">
        <label for="${prefix}Name">Alumni Name <span class="required">*</span></label>
        <input type="text" id="${prefix}Name" required value="${escapeHtml(c.alumniName || "")}" placeholder="Full name">
      </div>
      <div class="form-group">
        <label for="${prefix}Email">Email</label>
        <input type="email" id="${prefix}Email" value="${escapeHtml(c.email || "")}" placeholder="alumni@email.com">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="${prefix}Whatsapp">WhatsApp Number <span class="required">*</span></label>
        <input type="tel" id="${prefix}Whatsapp" required value="${escapeHtml(c.whatsapp || "")}" placeholder="10–15 digits">
      </div>
      <div class="form-group">
        <label for="${prefix}Mobile">Mobile Number</label>
        <input type="tel" id="${prefix}Mobile" value="${escapeHtml(c.mobile || "")}" placeholder="Optional">
      </div>
    </div>
    <div class="form-group">
      <label for="${prefix}Address">Address</label>
      <textarea id="${prefix}Address" rows="2" style="width:100%;padding:0.75rem 1rem;font-family:var(--font-body);font-size:0.95rem;border:1.5px solid transparent;border-radius:10px;background:var(--slate-100);resize:vertical;">${escapeHtml(c.address || "")}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="${prefix}Company">Company / Institution</label>
        <input type="text" id="${prefix}Company" value="${escapeHtml(c.company || "")}" placeholder="Where they work">
      </div>
      <div class="form-group">
        <label for="${prefix}JobSector">Job Sector</label>
        <select id="${prefix}JobSector">${jobSectorOptionsHtml(c.jobSector || "")}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="${prefix}Batch">Passout Year</label>
        <select id="${prefix}Batch">${passoutYearOptionsHtml(c.batch || c.passoutYear || "")}</select>
      </div>
      <div class="form-group">
        <label for="${prefix}Willingness">Willingness Status</label>
        <select id="${prefix}Willingness">
          ${optionsHtml(WILLINGNESS_OPTIONS, c.willingness || "undecided")}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="${prefix}Registration">Registration Status</label>
        <select id="${prefix}Registration">
          ${optionsHtml(REGISTRATION_OPTIONS, c.registrationStatus || "not_registered")}
        </select>
        ${feeLabel ? `<p class="form-hint">Configured fee: <strong>${escapeHtml(feeLabel)}</strong></p>` : ""}
      </div>
      <div class="form-group">
        <label for="${prefix}Notes">Remarks</label>
        <input type="text" id="${prefix}Notes" value="${escapeHtml(c.notes || "")}" placeholder="Optional notes">
      </div>
    </div>`;
}

export function readAlumniContactForm(prefix = "ac") {
  const alumniName = document.getElementById(`${prefix}Name`)?.value.trim() || "";
  const email = document.getElementById(`${prefix}Email`)?.value.trim() || "";
  const whatsapp = (document.getElementById(`${prefix}Whatsapp`)?.value || "")
    .trim()
    .replace(/[\s\-]/g, "");
  const mobile = (document.getElementById(`${prefix}Mobile`)?.value || "")
    .trim()
    .replace(/[\s\-]/g, "");
  const address = document.getElementById(`${prefix}Address`)?.value.trim() || "";
  const company = document.getElementById(`${prefix}Company`)?.value.trim() || "";
  const jobSector = document.getElementById(`${prefix}JobSector`)?.value || "";
  const batch = document.getElementById(`${prefix}Batch`)?.value || "";
  const willingness = document.getElementById(`${prefix}Willingness`)?.value || "undecided";
  const registrationStatus =
    document.getElementById(`${prefix}Registration`)?.value || "not_registered";
  const notes = document.getElementById(`${prefix}Notes`)?.value.trim() || "";

  const errors = [];
  if (!alumniName) errors.push("Alumni name is required");
  if (!whatsapp) errors.push("WhatsApp number is required");
  if (whatsapp && !/^\d{10,15}$/.test(whatsapp)) errors.push("WhatsApp must be 10–15 digits");
  if (mobile && !/^\d{10,15}$/.test(mobile)) errors.push("Mobile must be 10–15 digits");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email looks invalid");

  return {
    errors,
    data: {
      alumniName,
      email,
      whatsapp,
      mobile,
      address,
      company,
      jobSector,
      batch,
      willingness,
      registrationStatus,
      notes,
    },
  };
}

export async function saveAlumniContact(payload) {
  return addDoc(
    collection(db, ALUMNI_CONTACTS_COLLECTION),
    withSession({
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
}

export async function updateAlumniContact(contactId, payload) {
  return updateDoc(
    doc(db, ALUMNI_CONTACTS_COLLECTION, contactId),
    withSession({
      ...payload,
      updatedAt: serverTimestamp(),
    })
  );
}

/** Load contacts for a department (faculty/admin overview). */
export async function loadContactsByDepartment(department) {
  const snap = await getDocs(collection(db, ALUMNI_CONTACTS_COLLECTION));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => !c._deleted && (!department || c.department === department))
    .sort((a, b) => (a.alumniName || "").localeCompare(b.alumniName || ""));
}

/** Load contacts created by a specific volunteer (optionally for one dept task). */
export async function loadContactsByVolunteer(volunteerUserId, deptTaskId = null) {
  const snap = await getDocs(collection(db, ALUMNI_CONTACTS_COLLECTION));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(
      (c) =>
        !c._deleted &&
        c.createdByUserId === volunteerUserId &&
        (!deptTaskId || c.deptTaskId === deptTaskId)
    )
    .sort((a, b) => (a.alumniName || "").localeCompare(b.alumniName || ""));
}

export function contactsTableHtml(
  contacts,
  { showVolunteer = false, editable = false, inlineStatus = false } = {}
) {
  if (!contacts.length) {
    return '<p class="empty-state">No alumni contacts recorded yet.</p>';
  }
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>Alumni</th>
          <th>WhatsApp</th>
          <th>Passout</th>
          <th>Willingness</th>
          <th>Registration</th>
          ${showVolunteer ? "<th>Volunteer</th>" : ""}
        </tr>
      </thead>
      <tbody>
        ${contacts
          .map((c) => {
            const willingnessCell = inlineStatus
              ? `<select class="table-status-select" data-status-field="willingness" data-contact-id="${escapeHtml(c.id)}">
                  ${optionsHtml(WILLINGNESS_OPTIONS, c.willingness || "undecided")}
                </select>`
              : `<span class="badge badge--role">${escapeHtml(labelWillingness(c.willingness))}</span>`;

            const registrationCell = inlineStatus
              ? `<select class="table-status-select" data-status-field="registrationStatus" data-contact-id="${escapeHtml(c.id)}">
                  ${optionsHtml(REGISTRATION_OPTIONS, c.registrationStatus || "not_registered")}
                </select>`
              : `<span class="badge badge--role">${escapeHtml(labelRegistration(c.registrationStatus))}</span>`;

            const editIcon = editable
              ? `<button type="button" class="icon-btn" data-edit-contact="${escapeHtml(c.id)}" title="Edit details" aria-label="Edit ${escapeHtml(c.alumniName || "contact")}">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
                  </svg>
                </button>`
              : "";

            return `
          <tr>
            <td>
              <div class="contact-name-cell">
                <div>
                  <strong>${escapeHtml(c.alumniName)}</strong>
                  ${c.email ? `<br><small style="color:var(--slate-500)">${escapeHtml(c.email)}</small>` : ""}
                  ${c.company ? `<br><small style="color:var(--slate-500)">${escapeHtml(c.company)}</small>` : ""}
                </div>
                ${editIcon}
              </div>
            </td>
            <td>${escapeHtml(c.whatsapp || "—")}</td>
            <td>${escapeHtml(c.batch || c.passoutYear || "—")}</td>
            <td>${willingnessCell}</td>
            <td>${registrationCell}</td>
            ${showVolunteer ? `<td>${escapeHtml(c.createdByName || c.createdByUserId || "—")}</td>` : ""}
          </tr>`;
          })
          .join("")}
      </tbody>
    </table>`;
}

/** Load all alumni contacts (admin consolidated view). */
export async function loadAllAlumniContacts() {
  return loadContactsByDepartment(null);
}

export function summarizeContacts(contacts) {
  const list = contacts || [];
  const countBy = (field, value) => list.filter((c) => (c[field] || "") === value).length;

  const willing = countBy("willingness", "willing");
  const notWilling = countBy("willingness", "not_willing");
  const undecided = countBy("willingness", "undecided");
  const noResponse = countBy("willingness", "no_response");
  const paid = countBy("registrationStatus", "paid");
  const pendingPayment = countBy("registrationStatus", "pending_payment");
  const waived = countBy("registrationStatus", "waived");
  const notRegistered = countBy("registrationStatus", "not_registered");
  const registered = paid + pendingPayment + waived;
  const total = list.length;

  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  return {
    total,
    willing,
    notWilling,
    undecided,
    noResponse,
    paid,
    pendingPayment,
    waived,
    notRegistered,
    registered,
    willingPct: pct(willing),
    registeredPct: pct(registered),
    paidPct: pct(paid),
    conversionWillingToPaid: willing ? Math.round((paid / willing) * 100) : 0,
  };
}

export function filterAlumniContacts(contacts, filters = {}) {
  const q = (filters.search || "").trim().toLowerCase();
  return (contacts || []).filter((c) => {
    if (filters.department && (c.department || "") !== filters.department) return false;
    if (filters.willingness && (c.willingness || "") !== filters.willingness) return false;
    if (filters.registrationStatus && (c.registrationStatus || "") !== filters.registrationStatus) {
      return false;
    }
    if (filters.batch && String(c.batch || c.passoutYear || "") !== String(filters.batch)) {
      return false;
    }
    if (filters.jobSector && (c.jobSector || "") !== filters.jobSector) return false;
    if (filters.volunteerUserId && (c.createdByUserId || "") !== filters.volunteerUserId) {
      return false;
    }
    if (q) {
      const hay = [
        c.alumniName,
        c.email,
        c.whatsapp,
        c.mobile,
        c.company,
        c.createdByName,
        c.department,
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function uniqueSortedValues(contacts, getter) {
  const set = new Set();
  (contacts || []).forEach((c) => {
    const v = getter(c);
    if (v != null && String(v).trim() !== "") set.add(String(v));
  });
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function departmentBreakdown(contacts, departments = []) {
  const codes = departments.length
    ? departments.map((d) => d.value || d)
    : uniqueSortedValues(contacts, (c) => c.department);

  return codes.map((code) => {
    const deptContacts = (contacts || []).filter((c) => (c.department || "") === code);
    const stats = summarizeContacts(deptContacts);
    const label =
      departments.find((d) => (d.value || d) === code)?.label || code || "Unassigned";
    return { department: code || "—", label, ...stats };
  });
}

export function statsCardsHtml(stats, { title = "Summary" } = {}) {
  const s = stats || summarizeContacts([]);
  const cards = [
    { label: "Total contacted", value: s.total, tone: "neutral" },
    { label: "Willing", value: `${s.willing} (${s.willingPct}%)`, tone: "good" },
    { label: "Not willing", value: s.notWilling, tone: "bad" },
    { label: "Undecided / no reply", value: s.undecided + s.noResponse, tone: "warn" },
    { label: "Registered", value: `${s.registered} (${s.registeredPct}%)`, tone: "good" },
    { label: "Paid", value: `${s.paid} (${s.paidPct}%)`, tone: "good" },
    { label: "Payment pending", value: s.pendingPayment, tone: "warn" },
    { label: "Willing → Paid", value: `${s.conversionWillingToPaid}%`, tone: "neutral" },
  ];

  return `
    <div class="ac-dashboard__summary">
      <h3 class="ac-dashboard__subtitle">${escapeHtml(title)}</h3>
      <div class="ac-stat-grid">
        ${cards
          .map(
            (card) => `
          <div class="ac-stat-card ac-stat-card--${card.tone}">
            <div class="ac-stat-card__value">${escapeHtml(String(card.value))}</div>
            <div class="ac-stat-card__label">${escapeHtml(card.label)}</div>
          </div>`
          )
          .join("")}
      </div>
    </div>`;
}

export function alumniFiltersHtml(prefix, options = {}) {
  const {
    showDepartment = false,
    departments = [],
    batches = [],
    sectors = [],
    volunteers = [],
  } = options;

  const batchOpts =
    '<option value="">All years</option>' +
    batches.map((y) => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("");
  const sectorOpts =
    '<option value="">All sectors</option>' +
    sectors.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  const volunteerOpts =
    '<option value="">All volunteers</option>' +
    volunteers
      .map(
        (v) =>
          `<option value="${escapeHtml(v.userId)}">${escapeHtml(v.displayName || v.userId)}</option>`
      )
      .join("");
  const deptOpts =
    '<option value="">All departments</option>' +
    departments
      .map((d) => `<option value="${escapeHtml(d.value)}">${escapeHtml(d.label || d.value)}</option>`)
      .join("");

  return `
    <div class="ac-filters" id="${prefix}Filters">
      <div class="form-row">
        <div class="form-group">
          <label for="${prefix}Search">Search</label>
          <input type="search" id="${prefix}Search" placeholder="Name, email, WhatsApp, company…">
        </div>
        ${
          showDepartment
            ? `<div class="form-group">
                <label for="${prefix}Department">Department</label>
                <select id="${prefix}Department">${deptOpts}</select>
              </div>`
            : ""
        }
        <div class="form-group">
          <label for="${prefix}Willingness">Willingness</label>
          <select id="${prefix}Willingness">
            <option value="">All</option>
            ${optionsHtml(WILLINGNESS_OPTIONS)}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="${prefix}Registration">Registration</label>
          <select id="${prefix}Registration">
            <option value="">All</option>
            ${optionsHtml(REGISTRATION_OPTIONS)}
          </select>
        </div>
        <div class="form-group">
          <label for="${prefix}Batch">Passout year</label>
          <select id="${prefix}Batch">${batchOpts}</select>
        </div>
        <div class="form-group">
          <label for="${prefix}Sector">Job sector</label>
          <select id="${prefix}Sector">${sectorOpts}</select>
        </div>
        ${
          volunteers.length
            ? `<div class="form-group">
                <label for="${prefix}Volunteer">Volunteer</label>
                <select id="${prefix}Volunteer">${volunteerOpts}</select>
              </div>`
            : ""
        }
      </div>
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
        <button type="button" class="btn btn--primary btn--sm" id="${prefix}ApplyFilters">Apply filters</button>
        <button type="button" class="btn btn--ghost btn--sm" id="${prefix}ResetFilters">Reset</button>
      </div>
    </div>`;
}

export function readAlumniFilters(prefix, { showDepartment = false, hasVolunteer = false } = {}) {
  return {
    search: document.getElementById(`${prefix}Search`)?.value || "",
    department: showDepartment ? document.getElementById(`${prefix}Department`)?.value || "" : "",
    willingness: document.getElementById(`${prefix}Willingness`)?.value || "",
    registrationStatus: document.getElementById(`${prefix}Registration`)?.value || "",
    batch: document.getElementById(`${prefix}Batch`)?.value || "",
    jobSector: document.getElementById(`${prefix}Sector`)?.value || "",
    volunteerUserId: hasVolunteer
      ? document.getElementById(`${prefix}Volunteer`)?.value || ""
      : "",
  };
}

export function departmentBreakdownTableHtml(rows) {
  if (!rows.length) {
    return '<p class="empty-state">No Alumni Connect data yet.</p>';
  }
  return `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Department</th>
            <th>Total</th>
            <th>Willing</th>
            <th>Registered</th>
            <th>Paid</th>
            <th>Pending pay</th>
            <th>Willing %</th>
            <th>Paid %</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr>
              <td><strong>${escapeHtml(r.label || r.department)}</strong></td>
              <td>${r.total}</td>
              <td>${r.willing}</td>
              <td>${r.registered}</td>
              <td>${r.paid}</td>
              <td>${r.pendingPayment}</td>
              <td>${r.willingPct}%</td>
              <td>${r.paidPct}%</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

export function insightsHtml(stats, deptRows = []) {
  const s = stats || summarizeContacts([]);
  const topWilling = [...deptRows].sort((a, b) => b.willing - a.willing)[0];
  const topPaid = [...deptRows].sort((a, b) => b.paid - a.paid)[0];
  const needsFollowUp = s.undecided + s.noResponse;

  const bullets = [
    s.total
      ? `${s.total} alumni contacted overall; ${s.willingPct}% are willing to attend.`
      : "No alumni contacts recorded yet.",
    s.total
      ? `${s.registered} registered (${s.registeredPct}%), of which ${s.paid} have paid.`
      : null,
    needsFollowUp
      ? `${needsFollowUp} contacts need follow-up (undecided or no response).`
      : s.total
        ? "No pending follow-ups on willingness."
        : null,
    topWilling?.willing
      ? `Highest willingness count: ${topWilling.label} (${topWilling.willing}).`
      : null,
    topPaid?.paid ? `Highest paid count: ${topPaid.label} (${topPaid.paid}).` : null,
    s.willing
      ? `Conversion of willing → paid is ${s.conversionWillingToPaid}%.`
      : null,
  ].filter(Boolean);

  return `
    <div class="ac-insights">
      <h3 class="ac-dashboard__subtitle">Insights</h3>
      <ul class="ac-insights__list">
        ${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}
      </ul>
    </div>`;
}
