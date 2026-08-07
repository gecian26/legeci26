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
  DEPARTMENTS,
  DEPARTMENT_BATCH_START_YEAR,
  DEPARTMENT_SCORE_WEIGHT_OVERRIDE,
  ALUMNI_BATCH_POOL_END_YEAR,
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
  if (value === "waived") return "Not registered";
  return REGISTRATION_OPTIONS.find((o) => o.value === value)?.label || value || "—";
}

/** Semantic tone for status badges / PDF cells: green | orange | red | blue | gray */
export function statusTone(kind, value) {
  if (kind === "willingness") {
    switch (value) {
      case "willing":
        return "green";
      case "not_willing":
        return "red";
      case "undecided":
        return "orange";
      case "no_response":
      default:
        return "gray";
    }
  }
  if (kind === "registration") {
    switch (value) {
      case "paid":
        return "green";
      case "pending_payment":
        return "orange";
      case "not_registered":
      default:
        return "gray";
    }
  }
  return "gray";
}

export function statusBadgeHtml(kind, value) {
  const tone = statusTone(kind, value);
  const label = kind === "willingness" ? labelWillingness(value) : labelRegistration(value);
  return `<span class="badge badge--status badge--status-${tone}">${escapeHtml(label)}</span>`;
}

export function statusSelectClass(kind, value) {
  return `table-status-select table-status-select--${statusTone(kind, value)}`;
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

export function passoutYears(fromYear = 2000) {
  const currentYear = new Date().getFullYear();
  const end = Math.max(currentYear, 2026);
  const years = [];
  for (let y = end; y >= fromYear; y--) years.push(String(y));
  return years;
}

export function passoutYearOptionsHtml(selected = "", years = null) {
  const list = years || passoutYears();
  return (
    '<option value="">Select year</option>' +
    list
      .map(
        (y) =>
          `<option value="${escapeHtml(y)}" ${String(selected) === String(y) ? "selected" : ""}>${escapeHtml(y)}</option>`
      )
      .join("")
  );
}

export function passoutYearDatalistHtml(listId, years = null) {
  const list = years || passoutYears();
  return `<datalist id="${escapeHtml(listId)}">${list
    .map((y) => `<option value="${escapeHtml(y)}"></option>`)
    .join("")}</datalist>`;
}

export function passoutYearSearchFieldHtml(prefix, selected = "", years = null) {
  const listId = `${prefix}BatchList`;
  const value = selected || "";
  return `
    <input
      type="text"
      id="${prefix}Batch"
      list="${escapeHtml(listId)}"
      inputmode="numeric"
      autocomplete="off"
      placeholder="Type year, e.g. 2018"
      value="${escapeHtml(String(value))}"
    >
    ${passoutYearDatalistHtml(listId, years)}
    <p class="form-hint" style="margin-top:0.35rem;">Type to search, then pick a year from the suggestions.</p>`;
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
        ${passoutYearSearchFieldHtml(prefix, c.batch || c.passoutYear || "")}
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
  const batch = (document.getElementById(`${prefix}Batch`)?.value || "").trim();
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
  if (batch && !/^\d{4}$/.test(batch)) errors.push("Passout year must be a 4-digit year");

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
export async function loadContactsByDepartment(
  department,
  { includeInvalidated = false } = {}
) {
  const snap = await getDocs(collection(db, ALUMNI_CONTACTS_COLLECTION));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(
      (c) =>
        !c._deleted &&
        (!department || c.department === department) &&
        (includeInvalidated || !c.invalidated)
    )
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
        !c.invalidated &&
        c.createdByUserId === volunteerUserId &&
        (!deptTaskId || c.deptTaskId === deptTaskId)
    )
    .sort((a, b) => (a.alumniName || "").localeCompare(b.alumniName || ""));
}

export function isActiveContact(contact) {
  return !!contact && !contact._deleted && !contact.invalidated;
}

export function normalizePhoneDigits(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  return digits;
}

export function normalizePersonName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Suggest duplicate groups within a department contact list.
 * Matches on WhatsApp/mobile, email, or same normalized name + passout year.
 */
export function findDuplicateGroups(contacts) {
  const list = (contacts || []).filter((c) => !c._deleted && !c.invalidated);
  const byKey = new Map();

  const add = (key, reason, contact) => {
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, { key, reason, contacts: [] });
    const group = byKey.get(key);
    if (!group.contacts.some((c) => c.id === contact.id)) {
      group.contacts.push(contact);
    }
  };

  list.forEach((c) => {
    const phone = normalizePhoneDigits(c.whatsapp || c.mobile);
    if (phone.length >= 10) add(`phone:${phone}`, "Same WhatsApp / mobile", c);

    const email = normalizeEmail(c.email);
    if (email && email.includes("@")) add(`email:${email}`, "Same email", c);

    const name = normalizePersonName(c.alumniName);
    const year = String(c.batch || c.passoutYear || "").trim();
    if (name && year) add(`nameyear:${name}|${year}`, "Same name + passout year", c);
  });

  const raw = [...byKey.values()]
    .filter((g) => g.contacts.length >= 2)
    .map((g) => ({
      ...g,
      contacts: g.contacts.slice().sort((a, b) => (a.alumniName || "").localeCompare(b.alumniName || "")),
    }));

  // Merge groups that contain the exact same contact set (avoids repeating the same rows).
  const merged = new Map();
  raw.forEach((g) => {
    const setKey = g.contacts
      .map((c) => c.id)
      .sort()
      .join("|");
    if (!merged.has(setKey)) {
      merged.set(setKey, {
        key: setKey,
        reasons: [g.reason],
        reason: g.reason,
        contacts: g.contacts,
      });
    } else {
      const existing = merged.get(setKey);
      if (!existing.reasons.includes(g.reason)) existing.reasons.push(g.reason);
      existing.reason = existing.reasons.join(" · ");
    }
  });

  return [...merged.values()].sort(
    (a, b) => b.contacts.length - a.contacts.length || a.reason.localeCompare(b.reason)
  );
}

export async function setContactInvalidated(contactId, invalidated, session, reason = "") {
  const payload = {
    invalidated: !!invalidated,
    invalidatedAt: invalidated ? new Date().toISOString().slice(0, 10) : "",
    invalidatedBy: invalidated
      ? session?.displayName || session?.username || "Faculty"
      : "",
    invalidatedReason: invalidated ? String(reason || "").trim() : "",
  };
  await updateAlumniContact(contactId, payload);
  return payload;
}

function detailField(label, value) {
  const text = value == null || String(value).trim() === "" ? "—" : String(value);
  return `
    <div class="ac-detail-grid__item">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(text)}</dd>
    </div>`;
}

export function contactDetailFieldsHtml(c) {
  return `
    <dl class="ac-detail-grid">
      ${detailField("Full name", c.alumniName)}
      ${detailField("Email", c.email)}
      ${detailField("WhatsApp", c.whatsapp)}
      ${detailField("Mobile", c.mobile)}
      ${detailField("Passout year", c.batch || c.passoutYear)}
      ${detailField("Company / Institution", c.company)}
      ${detailField("Job sector", c.jobSector)}
      ${detailField("Address", c.address)}
      ${detailField("Willingness", labelWillingness(c.willingness))}
      ${detailField("Registration", labelRegistration(c.registrationStatus))}
      ${detailField("Remarks", c.notes || c.feeRemarks)}
      ${detailField("Recorded by", c.createdByName || c.createdByUserId)}
      ${detailField("Department", c.department)}
      ${detailField("Team", c.team)}
      ${
        c.invalidated
          ? detailField(
              "Invalidated",
              `${c.invalidatedAt || "yes"}${c.invalidatedBy ? ` · ${c.invalidatedBy}` : ""}${
                c.invalidatedReason ? ` · ${c.invalidatedReason}` : ""
              }`
            )
          : ""
      }
    </dl>`;
}

/** Faculty/department detailed contacts table with expand + invalidate actions. */
export function facultyContactsDetailHtml(
  contacts,
  { expandedId = "", canManage = false, showVolunteer = true } = {}
) {
  if (!contacts.length) {
    return '<p class="empty-state">No alumni contacts recorded yet.</p>';
  }
  return `
    <div class="table-scroll">
      <table class="data-table data-table--dense">
        <thead>
          <tr>
            <th>Alumni</th>
            <th>Contact</th>
            <th>Passout</th>
            <th>Company / Sector</th>
            <th>Willingness</th>
            <th>Registration</th>
            ${showVolunteer ? "<th>Volunteer</th>" : ""}
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${contacts
            .map((c) => {
              const expanded = expandedId === c.id;
              const invalid = !!c.invalidated;
              return `
            <tr class="${invalid ? "ac-row--invalid" : ""}">
              <td>
                <strong>${escapeHtml(c.alumniName || "—")}</strong>
                ${c.email ? `<br><small style="color:var(--slate-500)">${escapeHtml(c.email)}</small>` : ""}
                ${c.notes || c.feeRemarks ? `<br><small style="color:var(--slate-500)">Note: ${escapeHtml(c.notes || c.feeRemarks)}</small>` : ""}
              </td>
              <td>
                ${escapeHtml(c.whatsapp || "—")}
                ${c.mobile && c.mobile !== c.whatsapp ? `<br><small style="color:var(--slate-500)">${escapeHtml(c.mobile)}</small>` : ""}
              </td>
              <td>${escapeHtml(c.batch || c.passoutYear || "—")}</td>
              <td>
                ${escapeHtml(c.company || "—")}
                ${c.jobSector ? `<br><small style="color:var(--slate-500)">${escapeHtml(c.jobSector)}</small>` : ""}
                ${c.address ? `<br><small style="color:var(--slate-500)">${escapeHtml(c.address)}</small>` : ""}
              </td>
              <td>${statusBadgeHtml("willingness", c.willingness)}</td>
              <td>${statusBadgeHtml("registration", c.registrationStatus)}</td>
              ${
                showVolunteer
                  ? `<td>${escapeHtml(c.createdByName || c.createdByUserId || "—")}</td>`
                  : ""
              }
              <td>
                ${
                  invalid
                    ? '<span class="badge badge--status badge--status-red">Invalidated</span>'
                    : '<span class="badge badge--status badge--status-green">Active</span>'
                }
              </td>
              <td class="table-actions">
                <button type="button" class="btn btn--ghost btn--sm" data-ac-toggle-detail="${escapeHtml(c.id)}">${
                  expanded ? "Hide" : "Details"
                }</button>
                ${
                  canManage
                    ? invalid
                      ? `<button type="button" class="btn btn--ghost btn--sm" data-ac-restore="${escapeHtml(c.id)}">Restore</button>`
                      : `<button type="button" class="btn btn--ghost btn--sm" data-ac-invalidate="${escapeHtml(c.id)}">Invalidate</button>`
                    : ""
                }
              </td>
            </tr>
            ${
              expanded
                ? `<tr class="ac-detail-row ${invalid ? "ac-row--invalid" : ""}">
                    <td colspan="${showVolunteer ? 9 : 8}">
                      <div class="ac-detail-panel">
                        <h4 class="ac-detail-panel__title">Full alumni details</h4>
                        ${contactDetailFieldsHtml(c)}
                      </div>
                    </td>
                  </tr>`
                : ""
            }`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;
}

export function duplicateSuggestionsHtml(groups, { canManage = false } = {}) {
  if (!groups.length) {
    return `
      <div class="ac-dup-empty">
        <strong>No likely duplicates found</strong>
        <p class="form-hint" style="margin:0.35rem 0 0;">Checked WhatsApp/mobile, email, and name + passout year within this department.</p>
      </div>`;
  }
  return `
    <div class="ac-dup-list">
      ${groups
        .map((g, gi) => {
          const ids = g.contacts.map((c) => c.id).join(",");
          return `
        <article class="ac-dup-card" data-dup-group="${gi}">
          <div class="ac-dup-card__head">
            <div>
              <strong>${escapeHtml(g.reason)}</strong>
              <span class="badge badge--status badge--status-orange">${g.contacts.length} entries</span>
            </div>
            <p class="form-hint" style="margin:0.25rem 0 0;">Review and invalidate extras so only one valid record remains.</p>
          </div>
          <div class="table-scroll">
            <table class="data-table data-table--dense ac-dup-table">
              <thead>
                <tr>
                  <th>Alumni</th>
                  <th>WhatsApp / Mobile</th>
                  <th>Email</th>
                  <th>Passout</th>
                  <th>Company</th>
                  <th>Willingness</th>
                  <th>Registration</th>
                  <th>Volunteer</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${g.contacts
                  .map((c) => {
                    return `
                  <tr>
                    <td><strong>${escapeHtml(c.alumniName || "—")}</strong></td>
                    <td>
                      ${escapeHtml(c.whatsapp || "—")}
                      ${
                        c.mobile && c.mobile !== c.whatsapp
                          ? `<br><small style="color:var(--slate-500)">${escapeHtml(c.mobile)}</small>`
                          : ""
                      }
                    </td>
                    <td>${escapeHtml(c.email || "—")}</td>
                    <td>${escapeHtml(c.batch || c.passoutYear || "—")}</td>
                    <td>
                      ${escapeHtml(c.company || "—")}
                      ${c.jobSector ? `<br><small style="color:var(--slate-500)">${escapeHtml(c.jobSector)}</small>` : ""}
                    </td>
                    <td>${statusBadgeHtml("willingness", c.willingness)}</td>
                    <td>${statusBadgeHtml("registration", c.registrationStatus)}</td>
                    <td>${escapeHtml(c.createdByName || c.createdByUserId || "—")}</td>
                    <td class="table-actions">
                      <button type="button" class="btn btn--ghost btn--sm" data-ac-toggle-detail="${escapeHtml(c.id)}">Details</button>
                      ${
                        canManage
                          ? `<button type="button" class="btn btn--ghost btn--sm" data-ac-invalidate="${escapeHtml(c.id)}" data-dup-siblings="${escapeHtml(ids)}">Invalidate</button>`
                          : ""
                      }
                    </td>
                  </tr>`;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        </article>`;
        })
        .join("")}
    </div>`;
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
              ? `<select class="${statusSelectClass("willingness", c.willingness || "undecided")}" data-status-field="willingness" data-contact-id="${escapeHtml(c.id)}">
                  ${optionsHtml(WILLINGNESS_OPTIONS, c.willingness || "undecided")}
                </select>`
              : statusBadgeHtml("willingness", c.willingness);

            const registrationCell = inlineStatus
              ? `<select class="${statusSelectClass("registration", c.registrationStatus || "not_registered")}" data-status-field="registrationStatus" data-contact-id="${escapeHtml(c.id)}">
                  ${optionsHtml(REGISTRATION_OPTIONS, c.registrationStatus || "not_registered")}
                </select>`
              : statusBadgeHtml("registration", c.registrationStatus);

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
  const notRegistered = countBy("registrationStatus", "not_registered");
  const registered = paid + pendingPayment;
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
    if (filters.validity === "active" && c.invalidated) return false;
    if (filters.validity === "invalidated" && !c.invalidated) return false;
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
        c.jobSector,
        c.address,
        c.notes,
        c.feeRemarks,
        c.createdByName,
        c.department,
        c.batch,
        c.passoutYear,
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
    showValidity = false,
    departments = [],
    batches = [],
    sectors = [],
    volunteers = [],
  } = options;

  const yearSuggestions = batches.length ? batches : passoutYears();
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
          <input
            type="search"
            id="${prefix}Batch"
            list="${prefix}BatchList"
            inputmode="numeric"
            autocomplete="off"
            placeholder="Type year or leave blank for all"
          >
          ${passoutYearDatalistHtml(`${prefix}BatchList`, yearSuggestions)}
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
        ${
          showValidity
            ? `<div class="form-group">
                <label for="${prefix}Validity">Record status</label>
                <select id="${prefix}Validity">
                  <option value="active">Active only</option>
                  <option value="invalidated">Invalidated only</option>
                  <option value="all">All records</option>
                </select>
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

export function readAlumniFilters(prefix, { showDepartment = false, hasVolunteer = false, showValidity = false } = {}) {
  return {
    search: document.getElementById(`${prefix}Search`)?.value || "",
    department: showDepartment ? document.getElementById(`${prefix}Department`)?.value || "" : "",
    willingness: document.getElementById(`${prefix}Willingness`)?.value || "",
    registrationStatus: document.getElementById(`${prefix}Registration`)?.value || "",
    batch: (document.getElementById(`${prefix}Batch`)?.value || "").trim(),
    jobSector: document.getElementById(`${prefix}Sector`)?.value || "",
    volunteerUserId: hasVolunteer
      ? document.getElementById(`${prefix}Volunteer`)?.value || ""
      : "",
    validity: showValidity
      ? document.getElementById(`${prefix}Validity`)?.value || "active"
      : "active",
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

/** Composite: contacted×1 + willing×2 + registered×3 + paid×5 */
export function scoreContactStats(stats) {
  const s = stats || {};
  const contacted = Number(s.total) || 0;
  const willing = Number(s.willing) || 0;
  const registered = Number(s.registered) || 0;
  const paid = Number(s.paid) || 0;
  return contacted * 1 + willing * 2 + registered * 3 + paid * 5;
}

/** How many passout years are in a department's alumni pool. */
export function departmentBatchPoolSize(
  departmentCode,
  endYear = ALUMNI_BATCH_POOL_END_YEAR
) {
  const start =
    DEPARTMENT_BATCH_START_YEAR[departmentCode] ??
    Math.min(...Object.values(DEPARTMENT_BATCH_START_YEAR));
  return Math.max(1, Number(endYear) - Number(start) + 1);
}

/**
 * Weight so departments with fewer batches (e.g. MECH from 2013) are comparable.
 * Prefer DEPARTMENT_SCORE_WEIGHT_OVERRIDE when set; else pool-ratio vs largest dept.
 */
export function departmentScoreWeight(
  departmentCode,
  endYear = ALUMNI_BATCH_POOL_END_YEAR
) {
  const override = DEPARTMENT_SCORE_WEIGHT_OVERRIDE[departmentCode];
  if (override != null && Number.isFinite(Number(override))) {
    return Number(override);
  }
  const pools = (DEPARTMENTS.length ? DEPARTMENTS : Object.keys(DEPARTMENT_BATCH_START_YEAR)).map(
    (d) => departmentBatchPoolSize(typeof d === "string" ? d : d.value, endYear)
  );
  const baseline = Math.max(...pools, 1);
  const pool = departmentBatchPoolSize(departmentCode, endYear);
  return baseline / pool;
}

export function weightedLeaderboardScore(rawScore, departmentCode) {
  const weight = departmentScoreWeight(departmentCode);
  return Math.round((Number(rawScore) || 0) * weight);
}

export function scoreWeightLabel(departmentCode) {
  const weight = departmentScoreWeight(departmentCode);
  if (Math.abs(weight - 1) < 0.001) return "";
  const start = DEPARTMENT_BATCH_START_YEAR[departmentCode];
  const pool = departmentBatchPoolSize(departmentCode);
  return `×${weight.toFixed(2)} batch weight (since ${start}; ${pool} batch-years)`;
}

function compareLeaderRows(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.rawScore !== a.rawScore && a.rawScore != null && b.rawScore != null) {
    return b.rawScore - a.rawScore;
  }
  if (b.paid !== a.paid) return b.paid - a.paid;
  if (b.willing !== a.willing) return b.willing - a.willing;
  if (b.total !== a.total) return b.total - a.total;
  return (a.label || a.name || "").localeCompare(b.label || b.name || "");
}

export function volunteerBreakdown(contacts, { applyBatchWeight = true } = {}) {
  const byVolunteer = new Map();
  (contacts || []).forEach((c) => {
    const id = c.createdByUserId || c.createdByName || "unknown";
    if (!byVolunteer.has(id)) {
      byVolunteer.set(id, {
        userId: c.createdByUserId || id,
        name: c.createdByName || c.createdByUserId || "Unknown",
        department: c.department || "",
        team: c.createdByTeam || c.team || "",
        contacts: [],
      });
    }
    const row = byVolunteer.get(id);
    row.contacts.push(c);
    if (!row.name && c.createdByName) row.name = c.createdByName;
    if (!row.department && c.department) row.department = c.department;
    if (!row.team && (c.createdByTeam || c.team)) {
      row.team = c.createdByTeam || c.team;
    }
  });

  return [...byVolunteer.values()].map((v) => {
    const stats = summarizeContacts(v.contacts);
    const rawScore = scoreContactStats(stats);
    const scoreWeight = applyBatchWeight ? departmentScoreWeight(v.department) : 1;
    return {
      userId: v.userId,
      name: v.name,
      label: v.name,
      department: v.department,
      team: v.team,
      ...stats,
      rawScore,
      scoreWeight,
      score: applyBatchWeight
        ? weightedLeaderboardScore(rawScore, v.department)
        : rawScore,
    };
  });
}

export function rankDepartments(contacts, departments = [], { applyBatchWeight = true } = {}) {
  return departmentBreakdown(contacts, departments)
    .map((row) => {
      const rawScore = scoreContactStats(row);
      const scoreWeight = applyBatchWeight
        ? departmentScoreWeight(row.department)
        : 1;
      return {
        ...row,
        rawScore,
        scoreWeight,
        score: applyBatchWeight
          ? weightedLeaderboardScore(rawScore, row.department)
          : rawScore,
      };
    })
    .filter((row) => row.total > 0)
    .sort(compareLeaderRows)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

export function rankVolunteers(contacts, options = {}) {
  return volunteerBreakdown(contacts, options)
    .filter((row) => row.total > 0)
    .sort(compareLeaderRows)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

export function buildLeaderboardData(contacts, departments = [], options = {}) {
  const stats = summarizeContacts(contacts);
  return {
    stats,
    departments: rankDepartments(contacts, departments, options),
    volunteers: rankVolunteers(contacts, options),
  };
}
