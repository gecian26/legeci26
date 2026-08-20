import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { withSession } from "./auth.js";
import {
  TASK_TYPES,
  DEPT_TASKS_COLLECTION,
  ALUMNI_CONTACTS_COLLECTION,
  EVENT_DESK_PREREG_DOC,
  EVENT_DESK_RECORD_KIND,
  isEventDeskRecord,
  isEventDeskTestRecord,
  EVENT_REG_SOURCES,
  DEPARTMENTS,
  MAX_MEMBERS_ATTENDING,
  escapeHtml,
  normalizeUsername,
} from "./constants.js?v=er13";
import {
  jobSectorOptionsHtml,
  passoutYearSearchFieldHtml,
  loadAllAlumniContacts,
  normalizePhoneDigits,
  normalizePersonName,
  normalizeMembersAttending,
} from "./alumni-connect.js?v=er4";
import { parseAlumniRegistrationExcel, inferDepartmentCode } from "./event-registration-excel.js?v=er14";

export function isEventRegistrationTask(task) {
  return inferTaskTypeFromTitle(task) === TASK_TYPES.EVENT_REGISTRATION;
}

export function inferTaskTypeFromTitle(task) {
  const stored = String(task?.taskType || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (stored === TASK_TYPES.EVENT_REGISTRATION || stored === "event_desk") {
    return TASK_TYPES.EVENT_REGISTRATION;
  }
  if (stored === TASK_TYPES.ALUMNI_CONNECT) return TASK_TYPES.ALUMNI_CONNECT;
  if (stored === TASK_TYPES.VOLUNTEER_CERTIFICATE) return TASK_TYPES.VOLUNTEER_CERTIFICATE;

  const title = `${task?.title || ""} ${task?.description || ""}`;
  if (/alumni\s*connect/i.test(title)) return TASK_TYPES.ALUMNI_CONNECT;
  if (/volunteer\s*cert/i.test(title)) return TASK_TYPES.VOLUNTEER_CERTIFICATE;
  if (
    /event\s*(regist|desk)|spot\s*regist|alumni\s*regist|registration\s*(desk|counter)|check[\s-]*in/i.test(
      title
    )
  ) {
    return TASK_TYPES.EVENT_REGISTRATION;
  }
  return TASK_TYPES.GENERAL;
}

function assigneeIdList(task) {
  const raw = task?.assigneeUserIds;
  if (Array.isArray(raw)) return raw.map((id) => String(id || "").trim()).filter(Boolean);
  if (raw && typeof raw === "object") {
    return Object.values(raw)
      .map((id) => String(id || "").trim())
      .filter(Boolean);
  }
  return [];
}

function sessionIdentityKeys(session) {
  const username = String(session?.username || "").trim();
  const keys = new Set();
  if (!username) return keys;
  keys.add(username);
  keys.add(username.toLowerCase());
  keys.add(normalizeUsername(username));
  const digits = username.replace(/\D/g, "");
  if (digits.length >= 10) keys.add(digits);
  return keys;
}

function isVolunteerAssigned(task, session) {
  const keys = sessionIdentityKeys(session);
  return assigneeIdList(task).some((id) => {
    if (keys.has(id) || keys.has(id.toLowerCase()) || keys.has(normalizeUsername(id))) return true;
    const digits = id.replace(/\D/g, "");
    return digits.length >= 10 && keys.has(digits);
  });
}

function departmentOptionsHtml(selected = "") {
  return (
    '<option value="">Select department</option>' +
    DEPARTMENTS.map(
      (d) =>
        `<option value="${escapeHtml(d.value)}" ${d.value === selected ? "selected" : ""}>${escapeHtml(d.label)}</option>`
    ).join("")
  );
}

function departmentLabel(code) {
  return DEPARTMENTS.find((d) => d.value === code)?.label || code || "—";
}

function sourceBadgeClass(source) {
  if (source === EVENT_REG_SOURCES.GOOGLE_FORM) return "badge--source-form";
  if (source === EVENT_REG_SOURCES.ALUMNI_CONNECT) return "badge--source-connect";
  return "badge--source-spot";
}

function sourceLabel(source) {
  if (source === EVENT_REG_SOURCES.GOOGLE_FORM) return "Google Form";
  if (source === EVENT_REG_SOURCES.ALUMNI_CONNECT) return "Alumni Connect";
  if (source === EVENT_REG_SOURCES.SPOT) return "Spot";
  return source || "—";
}

function searchHaystack(row) {
  return [
    row.alumniName,
    row.email,
    row.mobile,
    row.whatsapp,
    row.company,
    row.jobRole,
    row.jobSector,
    row.address,
    row.batch,
    row.department,
    row.departmentLabel,
    row.notes,
    row.willingness,
    row.registrationStatus,
    row.notes,
    row.whatsapp,
  ]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
}

export function matchesSearch(row, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return true;
  const phoneQ = q.replace(/\D/g, "");
  if (phoneQ.length >= 4) {
    const phone = `${normalizePhoneDigits(row.mobile)} ${normalizePhoneDigits(row.whatsapp)}`;
    if (phone.includes(phoneQ)) return true;
  }
  return q.split(/\s+/).every((part) => searchHaystack(row).includes(part));
}

function stablePreRegId(record) {
  const key = [
    normalizePersonName(record.alumniName),
    normalizePhoneDigits(record.mobile || record.whatsapp),
    String(record.email || "")
      .toLowerCase()
      .trim(),
  ].join("|");
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `pr_${(h >>> 0).toString(16)}`;
}

async function loadCollectionSafe(loader) {
  try {
    return await loader();
  } catch (err) {
    console.error(err);
    return [];
  }
}

export async function loadPreRegistrations() {
  const snap = await getDoc(doc(db, "settings", EVENT_DESK_PREREG_DOC));
  if (!snap.exists()) return [];
  return (snap.data().records || [])
    .filter((r) => r && !r._deleted && r.alumniName)
    .sort((a, b) => (a.alumniName || "").localeCompare(b.alumniName || ""));
}

export async function loadEventRegistrations(department = "") {
  const snap = await getDocs(collection(db, ALUMNI_CONTACTS_COLLECTION));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(
      (r) =>
        !r._deleted &&
        isEventDeskRecord(r) &&
        (!department || r.department === department)
    )
    .sort((a, b) => (a.alumniName || "").localeCompare(b.alumniName || ""));
}

export async function savePreRegistrationsFromExcel(file) {
  const { records, errors } = await parseAlumniRegistrationExcel(file);
  if (!records.length) {
    return { saved: 0, errors: errors.length ? errors : ["No alumni rows found in the file."] };
  }

  const stamped = records.map((record) => ({
    ...record,
    id: stablePreRegId(record),
    source: EVENT_REG_SOURCES.GOOGLE_FORM,
  }));

  await setDoc(
    doc(db, "settings", EVENT_DESK_PREREG_DOC),
    withSession({
      records: stamped,
      count: stamped.length,
      updatedAt: serverTimestamp(),
    }),
    { merge: true }
  );

  return { saved: stamped.length, errors };
}

function normalizeAccompanyingFamily(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_MEMBERS_ATTENDING - 1);
}

function partySizeFromAccompanying(value) {
  return 1 + normalizeAccompanyingFamily(value);
}

function accompanyingOf(row) {
  if (row?.familyAccompanying != null && String(row.familyAccompanying).trim() !== "") {
    return normalizeAccompanyingFamily(row.familyAccompanying);
  }
  return Math.max(0, normalizeMembersAttending(row?.membersAttending) - 1);
}

function partySizeOf(row) {
  return partySizeFromAccompanying(accompanyingOf(row));
}

function foodCouponCountOf(row) {
  if (!row?.foodCouponIssued) return 0;
  const n = Math.floor(Number(row.foodCouponCount));
  if (Number.isFinite(n) && n > 0) return Math.min(n, MAX_MEMBERS_ATTENDING);
  return 1;
}

function foodIssuedTotal(rows) {
  return (rows || []).reduce((n, r) => n + foodCouponCountOf(r), 0);
}

function normalizeFoodCouponCount(value, { issued = false, membersAttending = 1 } = {}) {
  if (!issued) return 0;
  const n = Math.floor(Number(value));
  if (Number.isFinite(n) && n >= 1) return Math.min(n, MAX_MEMBERS_ATTENDING);
  return normalizeMembersAttending(membersAttending);
}

function wireFoodCouponControls(prefix) {
  const foodEl = document.getElementById(`${prefix}Food`);
  const countEl = document.getElementById(`${prefix}FoodCount`);
  const membersEl = document.getElementById(`${prefix}Members`);
  if (!foodEl || !countEl) return;

  const membersDefault = () => String(partySizeFromAccompanying(membersEl?.value));
  const partyEl = document.getElementById(`${prefix}PartySize`);
  const updateParty = () => {
    if (partyEl) partyEl.textContent = String(partySizeFromAccompanying(membersEl?.value));
  };
  const sync = () => {
    countEl.disabled = !foodEl.checked;
    if (foodEl.checked) {
      const n = Math.floor(Number(countEl.value));
      if (!Number.isFinite(n) || n < 1) countEl.value = membersDefault();
    } else {
      countEl.value = "0";
    }
  };

  foodEl.addEventListener("change", sync);
  membersEl?.addEventListener("input", () => {
    updateParty();
    if (!foodEl.checked) return;
    const n = Math.floor(Number(countEl.value));
    if (!Number.isFinite(n) || n < 1) countEl.value = membersDefault();
  });
  membersEl?.addEventListener("change", () => {
    updateParty();
    if (!foodEl.checked) return;
    const n = Math.floor(Number(countEl.value));
    if (!Number.isFinite(n) || n < 1) countEl.value = membersDefault();
  });
  updateParty();
  sync();
}

function enrollmentFormHtml(prefix, record = {}, { lockedIdentity = false, foodIssuedTotal: issuedTotal = 0 } = {}) {
  const r = record || {};
  const couponValue = r.foodCouponIssued
    ? foodCouponCountOf(r) || partySizeOf(r)
    : 0;
  const accompanying = accompanyingOf(r);
  return `
    <div class="form-row">
      <div class="form-group">
        <label for="${prefix}Name">Alumni Name <span class="required">*</span></label>
        <input type="text" id="${prefix}Name" required value="${escapeHtml(r.alumniName || "")}" ${lockedIdentity ? "readonly" : ""} placeholder="Full name">
      </div>
      <div class="form-group">
        <label for="${prefix}Department">Department <span class="required">*</span></label>
        <select id="${prefix}Department" required ${lockedIdentity ? "disabled" : ""}>
          ${departmentOptionsHtml(r.department || "")}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="${prefix}Batch">Passout Year</label>
        ${passoutYearSearchFieldHtml(prefix, r.batch || "")}
      </div>
      <div class="form-group">
        <label for="${prefix}Members">Accompanying family</label>
        <input type="number" id="${prefix}Members" min="0" max="${MAX_MEMBERS_ATTENDING - 1}" value="${escapeHtml(String(accompanying))}">
        <p class="form-hint">Exclude the alumni. People in this group: <strong id="${prefix}PartySize">${partySizeOf(r)}</strong></p>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="${prefix}Email">Email</label>
        <input type="email" id="${prefix}Email" value="${escapeHtml(r.email || "")}" placeholder="alumni@email.com">
      </div>
      <div class="form-group">
        <label for="${prefix}Mobile">Mobile Number <span class="required">*</span></label>
        <input type="tel" id="${prefix}Mobile" required value="${escapeHtml(r.mobile || r.whatsapp || "")}" placeholder="10–15 digits">
      </div>
    </div>
    <div class="form-group">
      <label for="${prefix}Address">Address</label>
      <textarea id="${prefix}Address" rows="2" class="er-textarea">${escapeHtml(r.address || "")}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="${prefix}Company">Company / Institution</label>
        <input type="text" id="${prefix}Company" value="${escapeHtml(r.company || "")}" placeholder="Where they work">
      </div>
      <div class="form-group">
        <label for="${prefix}JobSector">Job Sector</label>
        <select id="${prefix}JobSector">${jobSectorOptionsHtml(r.jobSector || "")}</select>
      </div>
    </div>
    <div class="form-group">
      <label for="${prefix}JobRole">Job Role</label>
      <input type="text" id="${prefix}JobRole" value="${escapeHtml(r.jobRole || "")}" placeholder="Designation / role">
    </div>
    <div class="er-issue-row">
      <div class="er-issue-food">
        <label class="checkbox-label">
          <input type="checkbox" id="${prefix}Food" ${r.foodCouponIssued ? "checked" : ""}>
          Food coupon issued
        </label>
        <label class="er-food-count" for="${prefix}FoodCount">
          Coupons
          <input type="number" id="${prefix}FoodCount" min="0" max="${MAX_MEMBERS_ATTENDING}" value="${escapeHtml(String(couponValue))}">
        </label>
        <span class="form-hint er-food-total">Desk total issued: <strong>${issuedTotal}</strong></span>
      </div>
      <label class="checkbox-label">
        <input type="checkbox" id="${prefix}Souvenir" ${r.souvenirIssued ? "checked" : ""}>
        Souvenir issued
      </label>
    </div>`;
}

function readEnrollmentForm(prefix, { departmentLocked } = {}) {
  const alumniName = document.getElementById(`${prefix}Name`)?.value.trim() || "";
  const department = departmentLocked
    ? departmentLocked
    : document.getElementById(`${prefix}Department`)?.value || "";
  const batch = (document.getElementById(`${prefix}Batch`)?.value || "").trim();
  const email = document.getElementById(`${prefix}Email`)?.value.trim() || "";
  const mobile = (document.getElementById(`${prefix}Mobile`)?.value || "").replace(/[\s\-]/g, "");
  const address = document.getElementById(`${prefix}Address`)?.value.trim() || "";
  const company = document.getElementById(`${prefix}Company`)?.value.trim() || "";
  const jobSector = document.getElementById(`${prefix}JobSector`)?.value || "";
  const jobRole = document.getElementById(`${prefix}JobRole`)?.value.trim() || "";
  const familyAccompanying = normalizeAccompanyingFamily(
    document.getElementById(`${prefix}Members`)?.value
  );
  const membersAttending = partySizeFromAccompanying(familyAccompanying);
  const foodCouponIssued = !!document.getElementById(`${prefix}Food`)?.checked;
  const foodCouponCount = normalizeFoodCouponCount(
    document.getElementById(`${prefix}FoodCount`)?.value,
    { issued: foodCouponIssued, membersAttending }
  );
  const souvenirIssued = !!document.getElementById(`${prefix}Souvenir`)?.checked;

  const errors = [];
  if (!alumniName) errors.push("Alumni name is required.");
  if (!department) errors.push("Department is required.");
  if (!mobile) errors.push("Mobile number is required.");
  if (mobile && !/^\d{10,15}$/.test(mobile)) errors.push("Mobile must be 10–15 digits.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email looks invalid.");
  if (batch && !/^\d{4}$/.test(batch)) errors.push("Passout year must be a 4-digit year.");

  return {
    errors,
    data: {
      alumniName,
      department,
      batch,
      email,
      mobile,
      whatsapp: mobile,
      address,
      company,
      jobSector,
      jobRole,
      membersAttending,
      familyAccompanying,
      foodCouponIssued,
      foodCouponCount,
      souvenirIssued,
    },
  };
}

function findExistingCheckIn(enrollments, candidate) {
  const phone = normalizePhoneDigits(candidate.mobile || candidate.whatsapp);
  const email = String(candidate.email || "")
    .toLowerCase()
    .trim();
  const name = normalizePersonName(candidate.alumniName);
  return enrollments.find((r) => {
    if (isEventDeskTestRecord(r)) return false;
    const rPhone = normalizePhoneDigits(r.mobile || r.whatsapp);
    const rEmail = String(r.email || "")
      .toLowerCase()
      .trim();
    const rName = normalizePersonName(r.alumniName);
    if (phone && rPhone && phone === rPhone) return true;
    if (email && rEmail && email === rEmail && name && rName === name) return true;
    return false;
  });
}

function findTestCheckIn(enrollments, candidate) {
  const phone = normalizePhoneDigits(candidate.mobile || candidate.whatsapp);
  const email = String(candidate.email || "")
    .toLowerCase()
    .trim();
  const name = normalizePersonName(candidate.alumniName);
  return enrollments.find((r) => {
    if (!isEventDeskTestRecord(r)) return false;
    const rPhone = normalizePhoneDigits(r.mobile || r.whatsapp);
    const rEmail = String(r.email || "")
      .toLowerCase()
      .trim();
    const rName = normalizePersonName(r.alumniName);
    if (phone && rPhone && phone === rPhone) return true;
    if (email && rEmail && email === rEmail && name && rName === name) return true;
    return false;
  });
}

async function saveCheckIn(payload) {
  const body = {
    ...payload,
    recordKind: EVENT_DESK_RECORD_KIND,
    whatsapp: payload.whatsapp || payload.mobile,
    deptTaskId: payload.deptTaskId || "event_desk",
    isTest: payload.isTest === true,
    updatedAt: serverTimestamp(),
  };
  if (payload.id) {
    const { id, ...rest } = body;
    await updateDoc(doc(db, ALUMNI_CONTACTS_COLLECTION, id), withSession(rest));
    return id;
  }
  const ref = await addDoc(
    collection(db, ALUMNI_CONTACTS_COLLECTION),
    withSession({
      ...body,
      createdAt: serverTimestamp(),
    })
  );
  return ref.id;
}

function yearFromValue(value) {
  const m = String(value ?? "").match(/(19|20)\d{2}/);
  return m ? m[0] : "";
}

function isPresent(value) {
  const text = String(value || "").trim();
  return !!text && text !== "—";
}

function displayDepartment(item) {
  const coded = departmentLabel(item.department);
  if (isPresent(coded) && coded !== item.department) return coded;
  if (isPresent(coded)) return coded;
  return String(item.departmentLabel || item.department || "").trim();
}

function normalizeLookupPerson(row, extras = {}) {
  const alumniName = String(row.alumniName || row.name || row.fullName || "").trim();
  const email = String(row.email || row.emailAddress || "").trim();
  const mobile = normalizePhoneDigits(row.mobile || row.phone || row.whatsapp) || String(row.mobile || row.phone || "").trim();
  const whatsapp = normalizePhoneDigits(row.whatsapp || row.mobile) || String(row.whatsapp || "").trim();
  const departmentLabelText = String(row.departmentLabel || "").trim();
  const department =
    inferDepartmentCode(row.department) ||
    inferDepartmentCode(departmentLabelText) ||
    inferDepartmentCode(row.branch) ||
    "";
  const batch = yearFromValue(row.batch) || yearFromValue(row.passoutYear) || yearFromValue(row.year);
  return {
    ...row,
    alumniName,
    email,
    mobile: mobile || whatsapp,
    whatsapp: whatsapp || mobile,
    batch,
    department,
    departmentLabel: departmentLabelText || (department ? departmentLabel(department) : ""),
    membersAttending: partySizeOf({
      membersAttending: row.membersAttending || row.familyMembers || row.members,
      familyAccompanying: row.familyAccompanying,
    }),
    familyAccompanying: accompanyingOf({
      membersAttending: row.membersAttending || row.familyMembers || row.members,
      familyAccompanying: row.familyAccompanying,
    }),
    company: String(row.company || "").trim(),
    address: String(row.address || "").trim(),
    jobRole: String(row.jobRole || "").trim(),
    jobSector: String(row.jobSector || "").trim(),
    ...extras,
  };
}

function lookupSourceRank(source) {
  if (source === EVENT_REG_SOURCES.ALUMNI_CONNECT) return 0;
  if (source === EVENT_REG_SOURCES.GOOGLE_FORM) return 1;
  return 2;
}

function lookupResultsHtml(results, emptyMessage) {
  if (!results.length) return `<p class="empty-state">${emptyMessage}</p>`;
  const parts = [];
  let lastSource = null;
  results.forEach((item) => {
    if (item.source !== lastSource) {
      lastSource = item.source;
      const count = results.filter((r) => r.source === item.source).length;
      parts.push(
        `<p class="er-result-group">${escapeHtml(sourceLabel(item.source))} · ${count}</p>`
      );
    }
    parts.push(lookupCardHtml(item));
  });
  return parts.join("");
}

function lookupCardHtml(item) {
  const enrolled = item.alreadyCheckedIn;
  const phone = item.mobile || item.whatsapp || "";
  const family = accompanyingOf(item);
  const meta = [
    displayDepartment(item),
    item.batch,
    phone,
    item.email,
    family > 0 ? `${family} family` : "",
  ].filter(isPresent);
  if (meta.length < 2 && isPresent(item.company)) meta.push(item.company);
  if (!meta.length) meta.push("Details incomplete — open to fill in");
  return `
    <button type="button" class="er-result ${enrolled ? "er-result--done" : ""}" data-lookup-id="${escapeHtml(item.uid)}">
      <div class="er-result__top">
        <strong>${escapeHtml(item.alumniName || "—")}</strong>
        <span class="badge ${sourceBadgeClass(item.source)}">${escapeHtml(item.sourceLabel)}</span>
        ${enrolled ? '<span class="badge badge--status badge--status-green">Checked in</span>' : ""}
      </div>
      <p class="er-result__meta">${meta.map((part) => escapeHtml(String(part))).join(" · ")}</p>
    </button>`;
}

function checkInRowHtml(row, { canEdit = true } = {}) {
  return `
    <tr>
      <td><strong>${escapeHtml(row.alumniName || "—")}</strong><br><small style="color:var(--slate-500)">${escapeHtml(sourceLabel(row.source))}</small></td>
      <td>${escapeHtml(departmentLabel(row.department))}${row.batch ? `<br><small>${escapeHtml(row.batch)}</small>` : ""}</td>
      <td>${escapeHtml(row.mobile || row.whatsapp || "—")}<br><small style="color:var(--slate-500)">${escapeHtml(row.email || "")}</small></td>
      <td>${partySizeOf(row)}${accompanyingOf(row) ? `<br><small>${accompanyingOf(row)} family</small>` : ""}</td>
      <td>
        ${
          canEdit
            ? `<label class="checkbox-label"><input type="checkbox" data-er-food="${escapeHtml(row.id)}" ${row.foodCouponIssued ? "checked" : ""}> Food</label>
               <input type="number" class="er-food-count-input" min="0" max="${MAX_MEMBERS_ATTENDING}" data-er-food-count="${escapeHtml(row.id)}" value="${escapeHtml(String(foodCouponCountOf(row)))}" ${row.foodCouponIssued ? "" : "disabled"} aria-label="Food coupons">
               <label class="checkbox-label"><input type="checkbox" data-er-souvenir="${escapeHtml(row.id)}" ${row.souvenirIssued ? "checked" : ""}> Souvenir</label>`
            : `${row.foodCouponIssued ? `Food ×${foodCouponCountOf(row)}` : "—"} / ${row.souvenirIssued ? "Souvenir" : "—"}`
        }
      </td>
    </tr>`;
}

function buildLookupList(preRegs, contacts, enrollments, query) {
  const enrolled = enrollments || [];
  const fromForm = (preRegs || []).map((r) =>
    normalizeLookupPerson(r, {
      uid: `form:${r.id}`,
      source: EVENT_REG_SOURCES.GOOGLE_FORM,
      sourceLabel: "Google Form",
      sourceId: r.id,
    })
  );
  const fromConnect = (contacts || []).map((c) =>
    normalizeLookupPerson(
      {
        ...c,
        batch: c.batch || c.passoutYear,
        mobile: c.mobile || c.whatsapp,
        whatsapp: c.whatsapp || c.mobile,
      },
      {
        uid: `ac:${c.id}`,
        source: EVENT_REG_SOURCES.ALUMNI_CONNECT,
        sourceLabel: "Alumni Connect",
        sourceId: c.id,
      }
    )
  );

  const merged = [...fromForm, ...fromConnect]
    .map((item) => ({
      ...item,
      alreadyCheckedIn: !!findExistingCheckIn(enrolled, item),
      existing: findExistingCheckIn(enrolled, item),
    }))
    .filter((item) => matchesSearch(item, query))
    .sort((a, b) => {
      const sourceDiff = lookupSourceRank(a.source) - lookupSourceRank(b.source);
      if (sourceDiff) return sourceDiff;
      if (a.alreadyCheckedIn !== b.alreadyCheckedIn) return a.alreadyCheckedIn ? 1 : -1;
      return (a.alumniName || "").localeCompare(b.alumniName || "");
    });

  return merged;
}

async function persistCheckIn({ session, task, source, sourceId, formPrefix, existing, enrollments, departmentLocked }) {
  const parsed = readEnrollmentForm(formPrefix, { departmentLocked });
  if (parsed.errors.length) {
    throw new Error(parsed.errors[0]);
  }
  const payload = {
    ...parsed.data,
    source,
    sourceId: sourceId || "",
    deptTaskId: task?.id || "",
    taskTitle: task?.title || "Event Registration",
    volunteerDepartment: session.department || "",
    isTest: false,
  };
  const live = existing?.id && !isEventDeskTestRecord(existing) ? existing : findExistingCheckIn(enrollments || [], parsed.data);
  const testHit = findTestCheckIn(enrollments || [], parsed.data);
  const row = live || testHit;
  if (row?.id) {
    payload.id = row.id;
  } else {
    payload.createdByUserId = normalizeUsername(session.username);
    payload.createdByName = session.displayName || session.username;
  }
  return saveCheckIn(payload);
}

export async function mountEventDesk(wrap, { session, notify, mode = "volunteer" } = {}) {
  const toast = (message, type) => notify?.(message, type);
  if (!wrap) return;

  const state = {
    tab: "search",
    query: "",
    preRegs: [],
    contacts: [],
    enrollments: [],
    tasks: [],
    task: null,
    lookup: [],
    selected: null,
    loading: true,
  };

  const isAdmin = mode === "admin";
  const isFaculty = mode === "faculty";
  const canUpload = isAdmin;
  const deptFilter = "";

  async function refreshLists() {
    const [preRegs, contacts, enrollments] = await Promise.all([
      loadCollectionSafe(loadPreRegistrations),
      loadCollectionSafe(loadAllAlumniContacts),
      loadCollectionSafe(() => loadEventRegistrations(deptFilter)),
    ]);
    state.preRegs = preRegs || [];
    state.contacts = (contacts || []).filter((c) => !c._deleted && !c.invalidated);
    state.enrollments = enrollments || [];
    let taskDocs = [];
    try {
      const taskSnap = await getDocs(collection(db, DEPT_TASKS_COLLECTION));
      taskDocs = taskSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.error(err);
    }
    state.tasks = taskDocs.filter((t) => {
      if (t._deleted) return false;
      if (inferTaskTypeFromTitle(t) !== TASK_TYPES.EVENT_REGISTRATION) return false;
      if (isAdmin) return true;
      if (isFaculty) return !t.department || t.department === session.department;
      return isVolunteerAssigned(t, session);
    });
    state.task = state.tasks[0] || null;
  }

  function render() {
    const canSave = isAdmin || isFaculty || !!state.task;
    const liveEnrollments = (state.enrollments || []).filter((r) => !isEventDeskTestRecord(r));
    const results = buildLookupList(state.preRegs, state.contacts, state.enrollments, state.query);
    state.lookup = results;

    wrap.innerHTML = `
      <div class="er-desk">
        ${
          canUpload
            ? `<div class="er-upload">
                <div>
                  <h3 class="er-subtitle">Google Form responses</h3>
                  <p class="form-hint" style="margin:0;">
                    Upload the latest <strong>GECI Alumni Registration (Responses)</strong> spreadsheet.
                    Volunteers search these records under Already registered. Alumni Connect data is not changed.
                  </p>
                </div>
                <label class="btn btn--ghost er-file-btn">
                  Upload Excel
                  <input type="file" id="erExcel" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
                </label>
              </div>
              <p class="form-hint" id="erUploadMeta">${state.preRegs.length} pre-registered alumni on file.</p>`
            : `<p class="form-hint" style="margin:0 0 0.75rem;">
                Search Google Form + Alumni Connect records, then issue food coupon / souvenir.
                Spot registration is for alumni who are not already in those lists.
              </p>`
        }

        <div class="acct-tabs" role="tablist">
          <button type="button" class="acct-tab ${state.tab === "search" ? "acct-tab--active" : ""}" data-er-tab="search">Already registered</button>
          <button type="button" class="acct-tab ${state.tab === "spot" ? "acct-tab--active" : ""}" data-er-tab="spot">Spot registration</button>
        </div>

        <div class="er-panel" ${state.tab === "search" ? "" : "hidden"}>
          <div class="form-group">
            <label for="erSearch">Search already registered alumni</label>
            <input type="search" id="erSearch" value="${escapeHtml(state.query)}" placeholder="Name, mobile, email, company, batch…">
          </div>
          <p class="form-hint" id="erResultMeta">Showing ${results.length} record${results.length === 1 ? "" : "s"} · ${results.filter((r) => r.source === EVENT_REG_SOURCES.ALUMNI_CONNECT).length} Alumni Connect · ${results.filter((r) => r.source === EVENT_REG_SOURCES.GOOGLE_FORM).length} Google Form.</p>
          <div id="erResults" class="er-results">
            ${lookupResultsHtml(results, state.query ? "No matching alumni." : "No Google Form or Alumni Connect records found.")}
          </div>
          <div id="erSearchFormWrap" ${state.selected ? "" : "hidden"}>
            <h3 class="er-subtitle">Check in</h3>
            <p class="form-hint" id="erSelectedHint"></p>
            <form id="erSearchForm">
              <div id="erSearchFields"></div>
              <div style="margin-top:1rem;">
                <button type="submit" class="btn btn--primary" ${canSave ? "" : "disabled"}>Save registration</button>
                ${canSave ? "" : `<p class="form-hint">Assigned Event Registration volunteers can save check-ins.</p>`}
              </div>
            </form>
          </div>
        </div>

        <div class="er-panel" ${state.tab === "spot" ? "" : "hidden"}>
          <h3 class="er-subtitle">New walk-in alumni</h3>
          <form id="erSpotForm">
            <div id="erSpotFields">${enrollmentFormHtml("erSpot", {}, { foodIssuedTotal: foodIssuedTotal(liveEnrollments) })}</div>
            <div style="margin-top:1rem;">
              <button type="submit" class="btn btn--primary" ${canSave ? "" : "disabled"}>Save spot registration</button>
              ${canSave ? "" : `<p class="form-hint">Assigned Event Registration volunteers can save check-ins.</p>`}
            </div>
          </form>
        </div>

        <div class="er-today">
          <h3 class="er-subtitle">Desk registrations ${deptFilter ? `(${escapeHtml(departmentLabel(deptFilter))})` : ""}</h3>
          <p class="form-hint">${liveEnrollments.length} checked in · Food ${foodIssuedTotal(liveEnrollments)} · Souvenir ${liveEnrollments.filter((r) => r.souvenirIssued).length}</p>
          ${
            liveEnrollments.length
              ? `<div class="table-scroll"><table class="data-table">
                  <thead><tr><th>Alumni</th><th>Dept</th><th>Contact</th><th>People</th><th>Issued</th></tr></thead>
                  <tbody>${liveEnrollments.map((r) => checkInRowHtml(r, { canEdit: canSave })).join("")}</tbody>
                </table></div>`
              : `<p class="empty-state">No desk registrations yet.</p>`
          }
        </div>
      </div>`;

    bind();
    wireFoodCouponControls("erSpot");
    if (state.selected) fillSelectedForm();
  }

  function fillSelectedForm() {
    const hint = document.getElementById("erSelectedHint");
    const fields = document.getElementById("erSearchFields");
    if (!hint || !fields || !state.selected) return;
    const existing = state.selected.existing;
    hint.innerHTML = existing
      ? `Updating check-in for <strong>${escapeHtml(state.selected.alumniName)}</strong> (${escapeHtml(state.selected.sourceLabel)}).`
      : `Enrolling <strong>${escapeHtml(state.selected.alumniName)}</strong> from <strong>${escapeHtml(state.selected.sourceLabel)}</strong>. Alumni Connect records stay unchanged.`;
    const seed = existing
      ? existing
      : {
          ...state.selected,
          department:
            state.selected.department ||
            inferDepartmentCode(state.selected.departmentLabel) ||
            "",
          foodCouponIssued: false,
          foodCouponCount: 0,
          souvenirIssued: false,
        };
    fields.innerHTML = enrollmentFormHtml("erPre", seed, {
      lockedIdentity: false,
      foodIssuedTotal: foodIssuedTotal((state.enrollments || []).filter((r) => !isEventDeskTestRecord(r))),
    });
    wireFoodCouponControls("erPre");
  }

  function bind() {
    wrap.querySelectorAll("[data-er-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.tab = btn.dataset.erTab;
        state.selected = null;
        render();
      });
    });

    const search = wrap.querySelector("#erSearch");
    search?.addEventListener("input", () => {
      state.query = search.value;
      const box = document.getElementById("erResults");
      if (!box) return;
      const results = buildLookupList(state.preRegs, state.contacts, state.enrollments, state.query);
      state.lookup = results;
      box.innerHTML = lookupResultsHtml(results, "No matching alumni.");
      const meta = document.getElementById("erResultMeta");
      if (meta) {
        const connectCount = results.filter((r) => r.source === EVENT_REG_SOURCES.ALUMNI_CONNECT).length;
        const formCount = results.filter((r) => r.source === EVENT_REG_SOURCES.GOOGLE_FORM).length;
        meta.textContent = `Showing ${results.length} record${results.length === 1 ? "" : "s"} · ${connectCount} Alumni Connect · ${formCount} Google Form.`;
      }
      box.querySelectorAll("[data-lookup-id]").forEach((card) => {
        card.addEventListener("click", () => selectLookup(card.dataset.lookupId));
      });
    });

    wrap.querySelectorAll("[data-lookup-id]").forEach((card) => {
      card.addEventListener("click", () => selectLookup(card.dataset.lookupId));
    });

    wrap.querySelector("#erSearchForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.selected) return;
      try {
        await persistCheckIn({
          session,
          task: state.task,
          source: state.selected.source,
          sourceId: state.selected.sourceId,
          formPrefix: "erPre",
          existing: state.selected.existing,
          enrollments: state.enrollments,
        });
        toast("Registration saved.", "success");
        state.selected = null;
        await refreshLists();
        render();
      } catch (err) {
        console.error(err);
        toast(err.message || "Could not save registration.", "error");
      }
    });

    wrap.querySelector("#erSpotForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const parsed = readEnrollmentForm("erSpot");
        if (parsed.errors.length) throw new Error(parsed.errors[0]);
        const existing = findExistingCheckIn(state.enrollments, parsed.data);
        await persistCheckIn({
          session,
          task: state.task,
          source: EVENT_REG_SOURCES.SPOT,
          sourceId: "",
          formPrefix: "erSpot",
          existing,
          enrollments: state.enrollments,
        });
        toast(existing ? "Updated existing check-in." : "Spot registration saved.", "success");
        await refreshLists();
        state.tab = "spot";
        render();
      } catch (err) {
        console.error(err);
        toast(err.message || "Could not save spot registration.", "error");
      }
    });

    wrap.querySelector("#erExcel")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const { saved, errors } = await savePreRegistrationsFromExcel(file);
        await refreshLists();
        render();
        const extra = errors.length ? ` ${errors.length} row(s) skipped.` : "";
        toast(`Imported ${saved} Google Form response${saved === 1 ? "" : "s"}.${extra}`, saved ? "success" : "error");
      } catch (err) {
        console.error(err);
        toast(err.message || "Could not import the spreadsheet.", "error");
      }
    });

    wrap.querySelectorAll("[data-er-food], [data-er-souvenir], [data-er-food-count]").forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.dataset.erFood || input.dataset.erSouvenir || input.dataset.erFoodCount;
        const row = state.enrollments.find((r) => r.id === id);
        if (!row) return;
        const foodEl = wrap.querySelector(`[data-er-food="${id}"]`);
        const souvenirEl = wrap.querySelector(`[data-er-souvenir="${id}"]`);
        const countEl = wrap.querySelector(`[data-er-food-count="${id}"]`);
        const issued = !!foodEl?.checked;
        const foodCouponCount = normalizeFoodCouponCount(countEl?.value, {
          issued,
          membersAttending: row.membersAttending,
        });
        if (countEl) {
          countEl.disabled = !issued;
          countEl.value = String(foodCouponCount);
        }
        try {
          await updateDoc(
            doc(db, ALUMNI_CONTACTS_COLLECTION, id),
            withSession({
              department: row.department,
              createdByUserId: row.createdByUserId,
              recordKind: EVENT_DESK_RECORD_KIND,
              foodCouponIssued: issued,
              foodCouponCount,
              souvenirIssued: !!souvenirEl?.checked,
              updatedAt: serverTimestamp(),
            })
          );
          row.foodCouponIssued = issued;
          row.foodCouponCount = foodCouponCount;
          row.souvenirIssued = !!souvenirEl?.checked;
          const live = (state.enrollments || []).filter((r) => !isEventDeskTestRecord(r));
          const total = foodIssuedTotal(live);
          const hint = wrap.querySelector(".er-today > .form-hint");
          if (hint) {
            hint.textContent = `${live.length} checked in · Food ${total} · Souvenir ${live.filter((r) => r.souvenirIssued).length}`;
          }
          wrap.querySelectorAll(".er-food-total strong").forEach((el) => {
            el.textContent = String(total);
          });
        } catch (err) {
          console.error(err);
          toast("Could not update coupon / souvenir.", "error");
          if (input.type === "checkbox") input.checked = !input.checked;
        }
      });
    });
  }

  function selectLookup(uid) {
    state.selected = state.lookup.find((item) => item.uid === uid) || null;
    const wrapForm = document.getElementById("erSearchFormWrap");
    if (wrapForm) wrapForm.hidden = !state.selected;
    fillSelectedForm();
  }

  wrap.innerHTML = '<p class="empty-state">Loading event desk…</p>';
  try {
    await refreshLists();
    render();
  } catch (err) {
    console.error(err);
    wrap.innerHTML =
      '<p class="empty-state">Could not load event registration. Republish Firestore rules if this is a permission error.</p>';
  }
}

function countBy(list, fn) {
  const map = new Map();
  (list || []).forEach((item) => {
    const key = fn(item) || "—";
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

export function summarizeEventDesk({ preRegs = [], contacts = [], enrollments = [] } = {}) {
  const testCount = (enrollments || []).filter(isEventDeskTestRecord).length;
  enrollments = (enrollments || []).filter((r) => !isEventDeskTestRecord(r));
  const people = enrollments.reduce((n, r) => n + partySizeOf(r), 0);
  const foodCheckIns = enrollments.filter((r) => r.foodCouponIssued).length;
  const food = foodIssuedTotal(enrollments);
  const souvenir = enrollments.filter((r) => r.souvenirIssued).length;
  const bySource = {
    google_form: enrollments.filter((r) => r.source === EVENT_REG_SOURCES.GOOGLE_FORM).length,
    alumni_connect: enrollments.filter((r) => r.source === EVENT_REG_SOURCES.ALUMNI_CONNECT).length,
    spot: enrollments.filter((r) => r.source === EVENT_REG_SOURCES.SPOT).length,
  };
  const pendingForm = preRegs.filter((r) => !findExistingCheckIn(enrollments, r)).length;

  const deptRows = DEPARTMENTS.map((d) => {
    const rows = enrollments.filter((r) => r.department === d.value);
    return {
      code: d.value,
      label: d.label,
      checkIns: rows.length,
      people: rows.reduce((n, r) => n + partySizeOf(r), 0),
      food: foodIssuedTotal(rows),
      souvenir: rows.filter((r) => r.souvenirIssued).length,
      spot: rows.filter((r) => r.source === EVENT_REG_SOURCES.SPOT).length,
      form: rows.filter((r) => r.source === EVENT_REG_SOURCES.GOOGLE_FORM).length,
      connect: rows.filter((r) => r.source === EVENT_REG_SOURCES.ALUMNI_CONNECT).length,
    };
  });
  const other = enrollments.filter((r) => !DEPARTMENTS.some((d) => d.value === r.department));
  if (other.length) {
    deptRows.push({
      code: "OTHER",
      label: "Other / unset",
      checkIns: other.length,
      people: other.reduce((n, r) => n + partySizeOf(r), 0),
      food: foodIssuedTotal(other),
      souvenir: other.filter((r) => r.souvenirIssued).length,
      spot: other.filter((r) => r.source === EVENT_REG_SOURCES.SPOT).length,
      form: other.filter((r) => r.source === EVENT_REG_SOURCES.GOOGLE_FORM).length,
      connect: other.filter((r) => r.source === EVENT_REG_SOURCES.ALUMNI_CONNECT).length,
    });
  }

  return {
    formCount: preRegs.length,
    connectCount: contacts.length,
    checkIns: enrollments.length,
    people,
    food,
    souvenir,
    foodPending: Math.max(0, enrollments.length - foodCheckIns),
    souvenirPending: Math.max(0, enrollments.length - souvenir),
    pendingForm,
    arrivedForm: preRegs.length - pendingForm,
    bySource,
    deptRows,
    batches: countBy(enrollments, (r) => r.batch || "—"),
    volunteers: countBy(enrollments, (r) => r.createdByName || r.createdByUserId || "—"),
    testCount,
  };
}

function erStatCardsHtml(stats) {
  const cards = [
    { label: "Google Form responses", value: stats.formCount, tone: "neutral" },
    { label: "Alumni Connect pool", value: stats.connectCount, tone: "neutral" },
    { label: "Desk check-ins", value: stats.checkIns, tone: "good" },
    { label: "People on campus", value: stats.people, tone: "good" },
    { label: "Food coupons issued", value: `${stats.food} / ${stats.people}`, tone: stats.food < stats.people ? "warn" : "good" },
    { label: "Souvenirs issued", value: `${stats.souvenir} / ${stats.checkIns}`, tone: stats.souvenirPending ? "warn" : "good" },
    { label: "Spot registrations", value: stats.bySource.spot, tone: "neutral" },
    { label: "From Google Form", value: stats.bySource.google_form, tone: "neutral" },
    { label: "From Alumni Connect", value: stats.bySource.alumni_connect, tone: "neutral" },
    { label: "Form yet to arrive", value: stats.pendingForm, tone: stats.pendingForm ? "warn" : "good" },
    { label: "Test check-ins", value: stats.testCount || 0, tone: stats.testCount ? "warn" : "neutral" },
  ];
  return `
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
    </div>`;
}

function filterDeskRows(rows, { search = "", department = "", source = "", issue = "" } = {}) {
  return (rows || []).filter((r) => {
    if (department && r.department !== department) return false;
    if (source && r.source !== source) return false;
    if (issue === "test" && !isEventDeskTestRecord(r)) return false;
    if (issue === "live" && isEventDeskTestRecord(r)) return false;
    if (issue === "food" && !r.foodCouponIssued) return false;
    if (issue === "food_pending" && r.foodCouponIssued) return false;
    if (issue === "souvenir" && !r.souvenirIssued) return false;
    if (issue === "souvenir_pending" && r.souvenirIssued) return false;
    if (search && !matchesSearch(r, search)) return false;
    return true;
  });
}

export async function mountAdminEventDesk(wrap, { session, notify } = {}) {
  const toast = (message, type) => notify?.(message, type);
  if (!wrap) return;

  const state = {
    preRegs: [],
    contacts: [],
    enrollments: [],
    search: "",
    department: "",
    source: "",
    issue: "",
  };

  async function refresh() {
    const [preRegs, contacts, enrollments] = await Promise.all([
      loadCollectionSafe(loadPreRegistrations),
      loadCollectionSafe(loadAllAlumniContacts),
      loadCollectionSafe(() => loadEventRegistrations("")),
    ]);
    state.preRegs = preRegs || [];
    state.contacts = contacts || [];
    state.enrollments = enrollments || [];
  }

  function render() {
    const activeId = document.activeElement?.id;
    const cursor =
      document.activeElement && "selectionStart" in document.activeElement
        ? document.activeElement.selectionStart
        : null;
    const stats = summarizeEventDesk(state);
    const filtered = filterDeskRows(state.enrollments, state);
    wrap.innerHTML = `
      <div class="er-admin">
        <div class="er-upload">
          <div>
            <h3 class="er-subtitle">Google Form responses</h3>
            <p class="form-hint" style="margin:0;">
              Upload the latest <strong>GECI Alumni Registration (Responses)</strong> spreadsheet.
              Volunteers search these under Already registered. Alumni Connect is not changed.
            </p>
          </div>
          <label class="btn btn--ghost er-file-btn">
            Upload Excel
            <input type="file" id="erExcel" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
          </label>
        </div>
        <p class="form-hint" style="margin:0;">${stats.formCount} pre-registered alumni on file for desk search.</p>

        <div>
          <h3 class="ac-dashboard__subtitle">Overview</h3>
          ${erStatCardsHtml(stats)}
        </div>

        <div>
          <h3 class="ac-dashboard__subtitle">Department-wise check-ins</h3>
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Check-ins</th>
                  <th>People</th>
                  <th>Food</th>
                  <th>Souvenir</th>
                  <th>Form</th>
                  <th>Connect</th>
                  <th>Spot</th>
                </tr>
              </thead>
              <tbody>
                ${
                  stats.deptRows.some((r) => r.checkIns)
                    ? stats.deptRows
                        .filter((r) => r.checkIns)
                        .map(
                          (r) => `
                    <tr>
                      <td><strong>${escapeHtml(r.label)}</strong></td>
                      <td>${r.checkIns}</td>
                      <td>${r.people}</td>
                      <td>${r.food}</td>
                      <td>${r.souvenir}</td>
                      <td>${r.form}</td>
                      <td>${r.connect}</td>
                      <td>${r.spot}</td>
                    </tr>`
                        )
                        .join("")
                    : `<tr><td colspan="8" class="empty-state">No desk check-ins yet.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>

        <div class="er-admin__split">
          <div>
            <h3 class="ac-dashboard__subtitle">Passout year</h3>
            <div class="table-scroll">
              <table class="data-table">
                <thead><tr><th>Year</th><th>Check-ins</th></tr></thead>
                <tbody>
                  ${
                    stats.batches.length
                      ? stats.batches
                          .map(([year, n]) => `<tr><td>${escapeHtml(String(year))}</td><td>${n}</td></tr>`)
                          .join("")
                      : `<tr><td colspan="2" class="empty-state">—</td></tr>`
                  }
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3 class="ac-dashboard__subtitle">Recorded by</h3>
            <div class="table-scroll">
              <table class="data-table">
                <thead><tr><th>Volunteer / staff</th><th>Check-ins</th></tr></thead>
                <tbody>
                  ${
                    stats.volunteers.length
                      ? stats.volunteers
                          .map(([name, n]) => `<tr><td>${escapeHtml(String(name))}</td><td>${n}</td></tr>`)
                          .join("")
                      : `<tr><td colspan="2" class="empty-state">—</td></tr>`
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div>
          <h3 class="ac-dashboard__subtitle">Check-in details</h3>
          <div class="form-row">
            <div class="form-group">
              <label for="erAdmSearch">Search</label>
              <input type="search" id="erAdmSearch" value="${escapeHtml(state.search)}" placeholder="Name, mobile, email, company…">
            </div>
            <div class="form-group">
              <label for="erAdmDept">Department</label>
              <select id="erAdmDept">
                <option value="">All</option>
                ${DEPARTMENTS.map(
                  (d) =>
                    `<option value="${escapeHtml(d.value)}" ${state.department === d.value ? "selected" : ""}>${escapeHtml(d.label)}</option>`
                ).join("")}
              </select>
            </div>
            <div class="form-group">
              <label for="erAdmSource">Source</label>
              <select id="erAdmSource">
                <option value="">All</option>
                <option value="${EVENT_REG_SOURCES.GOOGLE_FORM}" ${state.source === EVENT_REG_SOURCES.GOOGLE_FORM ? "selected" : ""}>Google Form</option>
                <option value="${EVENT_REG_SOURCES.ALUMNI_CONNECT}" ${state.source === EVENT_REG_SOURCES.ALUMNI_CONNECT ? "selected" : ""}>Alumni Connect</option>
                <option value="${EVENT_REG_SOURCES.SPOT}" ${state.source === EVENT_REG_SOURCES.SPOT ? "selected" : ""}>Spot</option>
              </select>
            </div>
            <div class="form-group">
              <label for="erAdmIssue">Issued</label>
              <select id="erAdmIssue">
                <option value="">All</option>
                <option value="live" ${state.issue === "live" ? "selected" : ""}>Live check-ins</option>
                <option value="test" ${state.issue === "test" ? "selected" : ""}>Test only</option>
                <option value="food" ${state.issue === "food" ? "selected" : ""}>Food issued</option>
                <option value="food_pending" ${state.issue === "food_pending" ? "selected" : ""}>Food pending</option>
                <option value="souvenir" ${state.issue === "souvenir" ? "selected" : ""}>Souvenir issued</option>
                <option value="souvenir_pending" ${state.issue === "souvenir_pending" ? "selected" : ""}>Souvenir pending</option>
              </select>
            </div>
          </div>
          <p class="form-hint">Showing ${filtered.length} of ${state.enrollments.length} check-ins. Test rows are treated as unregistered at the desk.</p>
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Alumni</th>
                  <th>Dept / year</th>
                  <th>Contact</th>
                  <th>People</th>
                  <th>Work</th>
                  <th>Source</th>
                  <th>Issued</th>
                  <th>Test</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                ${
                  filtered.length
                    ? filtered
                        .map(
                          (r) => `
                  <tr class="${isEventDeskTestRecord(r) ? "er-row--test" : ""}">
                    <td>
                      <strong>${escapeHtml(r.alumniName || "—")}</strong>
                      ${isEventDeskTestRecord(r) ? ' <span class="badge badge--source-spot">Test</span>' : ""}
                      ${r.address ? `<br><small style="color:var(--slate-500)">${escapeHtml(r.address)}</small>` : ""}
                    </td>
                    <td>${escapeHtml(departmentLabel(r.department))}${r.batch ? `<br><small>${escapeHtml(r.batch)}</small>` : ""}</td>
                    <td>${escapeHtml(r.mobile || r.whatsapp || "—")}${r.email ? `<br><small style="color:var(--slate-500)">${escapeHtml(r.email)}</small>` : ""}</td>
                    <td>${partySizeOf(r)}${accompanyingOf(r) ? `<br><small>${accompanyingOf(r)} family</small>` : ""}</td>
                    <td>${escapeHtml(r.company || "—")}${r.jobRole || r.jobSector ? `<br><small style="color:var(--slate-500)">${escapeHtml([r.jobRole, r.jobSector].filter(Boolean).join(" · "))}</small>` : ""}</td>
                    <td>${escapeHtml(sourceLabel(r.source))}</td>
                    <td>
                      <label class="checkbox-label"><input type="checkbox" data-er-food="${escapeHtml(r.id)}" ${r.foodCouponIssued ? "checked" : ""}> Food</label>
                      <input type="number" class="er-food-count-input" min="0" max="${MAX_MEMBERS_ATTENDING}" data-er-food-count="${escapeHtml(r.id)}" value="${escapeHtml(String(foodCouponCountOf(r)))}" ${r.foodCouponIssued ? "" : "disabled"} aria-label="Food coupons">
                      <label class="checkbox-label"><input type="checkbox" data-er-souvenir="${escapeHtml(r.id)}" ${r.souvenirIssued ? "checked" : ""}> Souvenir</label>
                    </td>
                    <td>
                      <label class="checkbox-label"><input type="checkbox" data-er-test="${escapeHtml(r.id)}" ${isEventDeskTestRecord(r) ? "checked" : ""}> Mark as test</label>
                    </td>
                    <td>${escapeHtml(r.createdByName || r.createdByUserId || "—")}</td>
                  </tr>`
                        )
                        .join("")
                    : `<tr><td colspan="9" class="empty-state">No matching check-ins.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
    bind();
    if (activeId) {
      const el = document.getElementById(activeId);
      if (el) {
        el.focus();
        if (cursor != null && typeof el.setSelectionRange === "function") {
          el.setSelectionRange(cursor, cursor);
        }
      }
    }
  }

  function bind() {
    wrap.querySelector("#erAdmSearch")?.addEventListener("input", (e) => {
      state.search = e.target.value;
      render();
    });
    wrap.querySelector("#erAdmDept")?.addEventListener("change", (e) => {
      state.department = e.target.value;
      render();
    });
    wrap.querySelector("#erAdmSource")?.addEventListener("change", (e) => {
      state.source = e.target.value;
      render();
    });
    wrap.querySelector("#erAdmIssue")?.addEventListener("change", (e) => {
      state.issue = e.target.value;
      render();
    });
    wrap.querySelector("#erExcel")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const { saved, errors } = await savePreRegistrationsFromExcel(file);
        await refresh();
        render();
        const extra = errors.length ? ` ${errors.length} row(s) skipped.` : "";
        toast(`Imported ${saved} Google Form response${saved === 1 ? "" : "s"}.${extra}`, saved ? "success" : "error");
      } catch (err) {
        console.error(err);
        toast(err.message || "Could not import the spreadsheet.", "error");
      }
    });
    wrap.querySelectorAll("[data-er-food], [data-er-souvenir], [data-er-food-count]").forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.dataset.erFood || input.dataset.erSouvenir || input.dataset.erFoodCount;
        const row = state.enrollments.find((r) => r.id === id);
        if (!row) return;
        const foodEl = wrap.querySelector(`[data-er-food="${id}"]`);
        const souvenirEl = wrap.querySelector(`[data-er-souvenir="${id}"]`);
        const countEl = wrap.querySelector(`[data-er-food-count="${id}"]`);
        const issued = !!foodEl?.checked;
        const foodCouponCount = normalizeFoodCouponCount(countEl?.value, {
          issued,
          membersAttending: row.membersAttending,
        });
        try {
          await updateDoc(
            doc(db, ALUMNI_CONTACTS_COLLECTION, id),
            withSession({
              department: row.department,
              createdByUserId: row.createdByUserId,
              recordKind: EVENT_DESK_RECORD_KIND,
              foodCouponIssued: issued,
              foodCouponCount,
              souvenirIssued: !!souvenirEl?.checked,
              updatedAt: serverTimestamp(),
            })
          );
          row.foodCouponIssued = issued;
          row.foodCouponCount = foodCouponCount;
          row.souvenirIssued = !!souvenirEl?.checked;
          render();
        } catch (err) {
          console.error(err);
          toast("Could not update coupon / souvenir.", "error");
          if (input.type === "checkbox") input.checked = !input.checked;
        }
      });
    });
    wrap.querySelectorAll("[data-er-test]").forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.dataset.erTest;
        const row = state.enrollments.find((r) => r.id === id);
        if (!row) return;
        const isTest = !!input.checked;
        try {
          await updateDoc(
            doc(db, ALUMNI_CONTACTS_COLLECTION, id),
            withSession({
              department: row.department,
              createdByUserId: row.createdByUserId,
              recordKind: EVENT_DESK_RECORD_KIND,
              isTest,
              updatedAt: serverTimestamp(),
            })
          );
          row.isTest = isTest;
          toast(
            isTest
              ? `${row.alumniName || "Alumni"} marked as test and treated as unregistered.`
              : `${row.alumniName || "Alumni"} is a live check-in again.`,
            "success"
          );
          render();
        } catch (err) {
          console.error(err);
          toast("Could not update test flag.", "error");
          input.checked = !input.checked;
        }
      });
    });
  }

  wrap.innerHTML = '<p class="empty-state">Loading event desk statistics…</p>';
  try {
    await refresh();
    render();
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Could not load Event Desk statistics.</p>';
  }
}
