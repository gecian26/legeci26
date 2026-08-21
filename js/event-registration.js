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
  ROLES,
  TASK_TYPES,
  DEPT_TASKS_COLLECTION,
  ALUMNI_CONTACTS_COLLECTION,
  EVENT_DESK_PREREG_DOC,
  EVENT_DESK_RECORD_KIND,
  isEventDeskRecord,
  isEventDeskTestRecord,
  EVENT_REG_SOURCES,
  EVENT_DESK_STAFF_DEPT,
  EVENT_STAFF_ROLES,
  HILLVIEW_TRANSPORT,
  DEPARTMENTS,
  MAX_MEMBERS_ATTENDING,
  escapeHtml,
  normalizeUsername,
} from "./constants.js?v=er25";
import {
  jobSectorOptionsHtml,
  passoutYearSearchFieldHtml,
  loadAllAlumniContacts,
  loadRegistrationSettings,
  normalizePhoneDigits,
  normalizePersonName,
  normalizeMembersAttending,
} from "./alumni-connect.js?v=er4";
import { parseAlumniRegistrationExcel, inferDepartmentCode } from "./event-registration-excel.js?v=er14";
import { downloadDeskFeeReceipt, deskFeeModeLabel, makeDeskReceiptNo } from "./event-desk-receipt.js?v=er22";
import { copyDeskFeeIntoTreasurerBooks, findTreasurerContactForDeskFee } from "./legeci-accounts.js?v=fn4";

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
  if (code === EVENT_DESK_STAFF_DEPT) return "College staff";
  return DEPARTMENTS.find((d) => d.value === code)?.label || code || "—";
}

function isStaffCheckIn(row) {
  return row?.source === EVENT_REG_SOURCES.STAFF || row?.guestKind === "staff";
}

function omitUndefined(obj) {
  return Object.fromEntries(Object.entries(obj || {}).filter(([, value]) => value !== undefined));
}

function deskGuestLabel(row) {
  return isStaffCheckIn(row) ? "former staff" : "alumni";
}

function staffRoleLabel(value) {
  return EVENT_STAFF_ROLES.find((r) => r.value === value)?.label || value || "Staff";
}

function staffRoleOptionsHtml(selected = "") {
  return (
    '<option value="">Select role</option>' +
    EVENT_STAFF_ROLES.map(
      (r) =>
        `<option value="${escapeHtml(r.value)}" ${r.value === selected ? "selected" : ""}>${escapeHtml(r.label)}</option>`
    ).join("")
  );
}

function staffDepartmentOptionsHtml(selected = "") {
  const value = selected === EVENT_DESK_STAFF_DEPT ? "" : selected;
  return (
    '<option value="">College-wide / not a branch</option>' +
    DEPARTMENTS.map(
      (d) =>
        `<option value="${escapeHtml(d.value)}" ${d.value === value ? "selected" : ""}>${escapeHtml(d.label)}</option>`
    ).join("")
  );
}

function sourceBadgeClass(source) {
  if (source === EVENT_REG_SOURCES.GOOGLE_FORM) return "badge--source-form";
  if (source === EVENT_REG_SOURCES.ALUMNI_CONNECT) return "badge--source-connect";
  if (source === EVENT_REG_SOURCES.STAFF) return "badge--source-staff";
  return "badge--source-spot";
}

function sourceLabel(source) {
  if (source === EVENT_REG_SOURCES.GOOGLE_FORM) return "Google Form";
  if (source === EVENT_REG_SOURCES.ALUMNI_CONNECT) return "Alumni Connect";
  if (source === EVENT_REG_SOURCES.SPOT) return "Spot";
  if (source === EVENT_REG_SOURCES.STAFF) return "Former staff";
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
    row.staffRole,
    row.yearsServed,
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

function hillviewCount(rows) {
  return (rows || []).filter((r) => r.hillviewTrip).length;
}

function normalizeHillviewTransport(value, joining = false) {
  if (!joining) return "";
  const mode = String(value || "").trim();
  return HILLVIEW_TRANSPORT.some((o) => o.value === mode) ? mode : "";
}

function hillviewTransportLabel(value) {
  return HILLVIEW_TRANSPORT.find((o) => o.value === value)?.label || "";
}

function hillviewTransportCount(rows, mode) {
  return (rows || []).filter((r) => r.hillviewTrip && r.hillviewTransport === mode).length;
}

function isDeskFeeReceived(row) {
  return row?.deskFeeReceived === true;
}

function deskFeeAmountOf(row) {
  const n = Math.round(Number(row?.deskFeeAmount) || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function formatRupee(amount) {
  return `₹${Math.round(Number(amount) || 0).toLocaleString("en-IN")}`;
}

function suggestedDeskFeeAmount(record, feeSettings) {
  if (isDeskFeeReceived(record) && deskFeeAmountOf(record) > 0) return deskFeeAmountOf(record);
  const unit = Math.max(0, Number(feeSettings?.feeAmount) || 0);
  return unit * partySizeOf(record);
}

function todayISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function deskFeeLedgerStatus(row) {
  if (!isDeskFeeReceived(row) || isEventDeskTestRecord(row)) return "none";
  if (row.deskFeeTransferred) return "moved";
  if (row.deskFeeVerified) return "verified";
  return "pending";
}

function deskFeeStatusBadge(row) {
  const status = deskFeeLedgerStatus(row);
  if (status === "moved") return `<span class="badge badge--status badge--status-green">In treasurer</span>`;
  if (status === "verified") return `<span class="badge badge--status badge--status-orange">Verified · not moved</span>`;
  if (status === "pending") return `<span class="badge badge--source-spot">Desk only</span>`;
  return "";
}

function feeCellHtml(row, { admin = false } = {}) {
  if (!isDeskFeeReceived(row)) {
    return `<span class="er-fee-empty">Not collected</span>`;
  }
  const receiptNo = row.deskReceiptNo ? `<br><small>${escapeHtml(row.deskReceiptNo)}</small>` : "";
  const status = deskFeeLedgerStatus(row);
  const actions = admin
    ? `${deskFeeStatusBadge(row)}
       ${
         status === "pending"
           ? `<button type="button" class="btn btn--sm btn--primary er-receipt-btn" data-er-fee-verify="${escapeHtml(row.id)}">Verify</button>`
           : ""
       }
       ${
         status === "verified"
           ? `<button type="button" class="btn btn--sm btn--primary er-receipt-btn" data-er-fee-move="${escapeHtml(row.id)}">Move to treasurer</button>`
           : ""
       }`
    : "";
  return `<strong>${escapeHtml(formatRupee(deskFeeAmountOf(row)))}</strong><br><small>${escapeHtml(
    deskFeeModeLabel(row.deskFeeMode)
  )}</small>${receiptNo}
    <button type="button" class="btn btn--sm btn--ghost er-receipt-btn" data-er-receipt="${escapeHtml(row.id)}">Receipt</button>
    ${actions}`;
}

function bindDeskReceiptButtons(root, { enrollments, toast } = {}) {
  root?.querySelectorAll("[data-er-receipt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = (enrollments || []).find((r) => r.id === btn.dataset.erReceipt);
      if (!isDeskFeeReceived(row)) {
        toast?.("No registration fee is recorded for this check-in.", "error");
        return;
      }
      try {
        downloadDeskFeeReceipt(row);
      } catch (err) {
        console.error(err);
        toast?.(err.message || "Could not generate the receipt.", "error");
      }
    });
  });
}

function afterFeeSave(result, prefix, toast, message) {
  const wantsPdf = !!document.getElementById(`${prefix}FeeReceipt`)?.checked;
  if (wantsPdf && isDeskFeeReceived(result?.record)) {
    try {
      downloadDeskFeeReceipt(result.record);
      toast?.(`${message} Receipt downloaded.`, "success");
      return;
    } catch (err) {
      console.error(err);
      toast?.(`${message} Could not generate the receipt PDF.`, "error");
      return;
    }
  }
  toast?.(message, "success");
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
    if (!foodEl.checked) return;
    const n = Math.floor(Number(countEl.value));
    if (!Number.isFinite(n) || n < 1) countEl.value = membersDefault();
  });
  membersEl?.addEventListener("change", () => {
    if (!foodEl.checked) return;
    const n = Math.floor(Number(countEl.value));
    if (!Number.isFinite(n) || n < 1) countEl.value = membersDefault();
  });
  sync();
}

function wireHillviewTransport(prefix) {
  const hillEl = document.getElementById(`${prefix}Hillview`);
  const wrap = document.getElementById(`${prefix}HillviewTransportWrap`);
  const radios = [...document.querySelectorAll(`input[name="${prefix}HillviewTransport"]`)];
  if (!hillEl) return;
  const sync = () => {
    const on = hillEl.checked;
    if (wrap) wrap.hidden = !on;
    radios.forEach((input) => {
      input.disabled = !on;
    });
  };
  hillEl.addEventListener("change", sync);
  sync();
}

function issueRowHtml(prefix, r = {}, { foodIssuedTotal: issuedTotal = 0, hillviewTotal = 0 } = {}) {
  const couponValue = r.foodCouponIssued
    ? foodCouponCountOf(r) || partySizeOf(r)
    : 0;
  return `
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
      <div class="er-issue-food er-hillview-block">
        <label class="checkbox-label">
          <input type="checkbox" id="${prefix}Hillview" ${r.hillviewTrip ? "checked" : ""}>
          Joining Hillview trip
        </label>
        <span class="form-hint er-hillview-total">Joining: <strong>${hillviewTotal}</strong></span>
        <div class="er-fee-modes er-hillview-transport" id="${prefix}HillviewTransportWrap" ${r.hillviewTrip ? "" : "hidden"}>
          <span class="form-hint" style="margin:0;">Travel by</span>
          <label class="checkbox-label">
            <input type="radio" name="${prefix}HillviewTransport" value="own_vehicle" ${r.hillviewTransport === "own_vehicle" ? "checked" : ""}>
            Own vehicle
          </label>
          <label class="checkbox-label">
            <input type="radio" name="${prefix}HillviewTransport" value="college_bus" ${r.hillviewTransport === "college_bus" ? "checked" : ""}>
            College bus
          </label>
        </div>
      </div>
    </div>`;
}

function feeRowHtml(prefix, r = {}, feeSettings = null) {
  const paid = isDeskFeeReceived(r);
  const amount = suggestedDeskFeeAmount(r, feeSettings);
  const mode = r.deskFeeMode === "online" ? "online" : "cash";
  const unit = Math.max(0, Number(feeSettings?.feeAmount) || 0);
  return `
    <div class="er-fee-row">
      <label class="checkbox-label">
        <input type="checkbox" id="${prefix}FeePaid" ${paid ? "checked" : ""}>
        Registration fee received
      </label>
      <label class="er-food-count" for="${prefix}FeeAmount">
        Amount (₹)
        <input type="number" id="${prefix}FeeAmount" min="0" step="1" value="${escapeHtml(String(amount))}">
      </label>
      <div class="er-fee-modes" role="group" aria-label="Payment mode">
        <label class="checkbox-label">
          <input type="radio" name="${prefix}FeeMode" value="cash" ${mode !== "online" ? "checked" : ""}>
          Cash
        </label>
        <label class="checkbox-label">
          <input type="radio" name="${prefix}FeeMode" value="online" ${mode === "online" ? "checked" : ""}>
          Online
        </label>
      </div>
      <label class="er-food-count er-fee-ref" for="${prefix}FeeRef">
        UPI / ref
        <input type="text" id="${prefix}FeeRef" value="${escapeHtml(r.deskFeeRef || "")}" placeholder="Optional">
      </label>
      <label class="checkbox-label">
        <input type="checkbox" id="${prefix}FeeReceipt" ${paid ? "checked" : ""}>
        Download receipt
      </label>
      ${
        r.deskReceiptNo
          ? `<span class="form-hint er-fee-receipt-no">Receipt ${escapeHtml(r.deskReceiptNo)}</span>`
          : unit
            ? `<span class="form-hint">Configured fee: ${escapeHtml(formatRupee(unit))} per person</span>`
            : ""
      }
      <span class="form-hint er-fee-books-hint">Stays on Event Desk until admin verifies and moves it to treasurer books.</span>
    </div>`;
}

function wireFeeControls(prefix, feeSettings) {
  const paidEl = document.getElementById(`${prefix}FeePaid`);
  const amountEl = document.getElementById(`${prefix}FeeAmount`);
  const refEl = document.getElementById(`${prefix}FeeRef`);
  const receiptEl = document.getElementById(`${prefix}FeeReceipt`);
  const membersEl = document.getElementById(`${prefix}Members`);
  const modes = [...document.querySelectorAll(`input[name="${prefix}FeeMode"]`)];
  if (!paidEl || !amountEl) return;

  const suggested = () => {
    const family = normalizeAccompanyingFamily(membersEl?.value);
    const people = partySizeFromAccompanying(family);
    return (Number(feeSettings?.feeAmount) || 0) * people;
  };

  const sync = () => {
    const on = paidEl.checked;
    amountEl.disabled = !on;
    if (refEl) refEl.disabled = !on;
    if (receiptEl) receiptEl.disabled = !on;
    modes.forEach((input) => {
      input.disabled = !on;
    });
    if (on) {
      const n = Math.floor(Number(amountEl.value));
      if (!Number.isFinite(n) || n <= 0) amountEl.value = String(suggested());
      if (receiptEl && !receiptEl.dataset.touched) receiptEl.checked = true;
    }
  };

  paidEl.addEventListener("change", sync);
  membersEl?.addEventListener("change", () => {
    if (!paidEl.checked) return;
    amountEl.value = String(suggested());
  });
  receiptEl?.addEventListener("change", () => {
    receiptEl.dataset.touched = "1";
  });
  sync();
}

function enrollmentFormHtml(prefix, record = {}, { lockedIdentity = false, foodIssuedTotal: issuedTotal = 0, hillviewTotal = 0, feeSettings = null } = {}) {
  const r = record || {};
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
    ${issueRowHtml(prefix, r, { foodIssuedTotal: issuedTotal, hillviewTotal })}
    ${feeRowHtml(prefix, r, feeSettings)}`;
}

function staffFormHtml(prefix, record = {}) {
  const r = record || {};
  const accompanying = accompanyingOf(r);
  const deptValue = r.department === EVENT_DESK_STAFF_DEPT ? "" : r.department || "";
  return `
    <div class="form-row">
      <div class="form-group">
        <label for="${prefix}Name">Full name <span class="required">*</span></label>
        <input type="text" id="${prefix}Name" required value="${escapeHtml(r.alumniName || "")}" placeholder="Full name">
      </div>
      <div class="form-group">
        <label for="${prefix}StaffRole">Role at GECI <span class="required">*</span></label>
        <select id="${prefix}StaffRole" required>
          ${staffRoleOptionsHtml(r.staffRole || "")}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="${prefix}Department">Department they served in</label>
        <select id="${prefix}Department">
          ${staffDepartmentOptionsHtml(deptValue)}
        </select>
      </div>
      <div class="form-group">
        <label for="${prefix}Years">Years at GECI</label>
        <input type="text" id="${prefix}Years" value="${escapeHtml(r.yearsServed || "")}" placeholder="e.g. 1998–2012">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="${prefix}Mobile">Mobile Number <span class="required">*</span></label>
        <input type="tel" id="${prefix}Mobile" required value="${escapeHtml(r.mobile || r.whatsapp || "")}" placeholder="10–15 digits">
      </div>
      <div class="form-group">
        <label for="${prefix}Email">Email</label>
        <input type="email" id="${prefix}Email" value="${escapeHtml(r.email || "")}" placeholder="optional">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="${prefix}Members">Accompanying family</label>
        <input type="number" id="${prefix}Members" min="0" max="${MAX_MEMBERS_ATTENDING - 1}" value="${escapeHtml(String(accompanying))}">
      </div>
      <div class="form-group">
        <label for="${prefix}Notes">Notes</label>
        <input type="text" id="${prefix}Notes" value="${escapeHtml(r.notes || "")}" placeholder="Optional">
      </div>
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
  const hillviewTrip = !!document.getElementById(`${prefix}Hillview`)?.checked;
  const transportEl = document.querySelector(`input[name="${prefix}HillviewTransport"]:checked`);
  const hillviewTransport = normalizeHillviewTransport(transportEl?.value, hillviewTrip);
  const deskFeeReceived = !!document.getElementById(`${prefix}FeePaid`)?.checked;
  const deskFeeAmount = Math.max(0, Math.round(Number(document.getElementById(`${prefix}FeeAmount`)?.value) || 0));
  const modeEl = document.querySelector(`input[name="${prefix}FeeMode"]:checked`);
  const deskFeeMode = deskFeeReceived ? (modeEl?.value === "online" ? "online" : "cash") : "";
  const deskFeeRef = document.getElementById(`${prefix}FeeRef`)?.value.trim() || "";

  const errors = [];
  if (!alumniName) errors.push("Alumni name is required.");
  if (!department) errors.push("Department is required.");
  if (!mobile) errors.push("Mobile number is required.");
  if (mobile && !/^\d{10,15}$/.test(mobile)) errors.push("Mobile must be 10–15 digits.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email looks invalid.");
  if (batch && !/^\d{4}$/.test(batch)) errors.push("Passout year must be a 4-digit year.");
  if (deskFeeReceived && deskFeeAmount <= 0) errors.push("Enter the registration fee amount received.");
  if (deskFeeReceived && !deskFeeMode) errors.push("Choose cash or online payment.");
  if (hillviewTrip && !hillviewTransport) errors.push("Choose own vehicle or college bus for the Hillview trip.");

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
      hillviewTrip,
      hillviewTransport,
      deskFeeReceived,
      deskFeeAmount: deskFeeReceived ? deskFeeAmount : 0,
      deskFeeMode,
      deskFeeRef: deskFeeReceived ? deskFeeRef : "",
      guestKind: "alumni",
    },
  };
}

function staffDepartmentForSave(selected, session) {
  const code = String(selected || "").trim();
  if (DEPARTMENTS.some((d) => d.value === code)) return code;
  if (session?.role === ROLES.FACULTY && session.department) return session.department;
  return EVENT_DESK_STAFF_DEPT;
}

function readStaffForm(prefix, session) {
  const alumniName = document.getElementById(`${prefix}Name`)?.value.trim() || "";
  const staffRole = document.getElementById(`${prefix}StaffRole`)?.value || "";
  const selectedDept = document.getElementById(`${prefix}Department`)?.value || "";
  const department = staffDepartmentForSave(selectedDept, session);
  const yearsServed = document.getElementById(`${prefix}Years`)?.value.trim() || "";
  const email = document.getElementById(`${prefix}Email`)?.value.trim() || "";
  const mobile = (document.getElementById(`${prefix}Mobile`)?.value || "").replace(/[\s\-]/g, "");
  const notes = document.getElementById(`${prefix}Notes`)?.value.trim() || "";
  const familyAccompanying = normalizeAccompanyingFamily(
    document.getElementById(`${prefix}Members`)?.value
  );
  const membersAttending = partySizeFromAccompanying(familyAccompanying);
  const roleLabel = staffRoleLabel(staffRole);

  const errors = [];
  if (!alumniName) errors.push("Name is required.");
  if (!staffRole) errors.push("Role at GECI is required.");
  if (!mobile) errors.push("Mobile number is required.");
  if (mobile && !/^\d{10,15}$/.test(mobile)) errors.push("Mobile must be 10–15 digits.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email looks invalid.");

  return {
    errors,
    data: {
      alumniName,
      department,
      batch: "",
      email,
      mobile,
      whatsapp: mobile,
      address: "",
      company: yearsServed ? `GECI · ${yearsServed}` : "GECI",
      jobSector: "",
      jobRole: roleLabel,
      staffRole,
      yearsServed,
      notes,
      guestKind: "staff",
      membersAttending,
      familyAccompanying,
      foodCouponIssued: false,
      foodCouponCount: 0,
      souvenirIssued: false,
      hillviewTrip: false,
      hillviewTransport: "",
    },
  };
}

function findExistingCheckIn(enrollments, candidate, { staff = null } = {}) {
  const phone = normalizePhoneDigits(candidate.mobile || candidate.whatsapp);
  const email = String(candidate.email || "")
    .toLowerCase()
    .trim();
  const name = normalizePersonName(candidate.alumniName);
  return enrollments.find((r) => {
    if (isEventDeskTestRecord(r)) return false;
    if (staff === true && !isStaffCheckIn(r)) return false;
    if (staff === false && isStaffCheckIn(r)) return false;
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

function findTestCheckIn(enrollments, candidate, { staff = null } = {}) {
  const phone = normalizePhoneDigits(candidate.mobile || candidate.whatsapp);
  const email = String(candidate.email || "")
    .toLowerCase()
    .trim();
  const name = normalizePersonName(candidate.alumniName);
  return enrollments.find((r) => {
    if (!isEventDeskTestRecord(r)) return false;
    if (staff === true && !isStaffCheckIn(r)) return false;
    if (staff === false && isStaffCheckIn(r)) return false;
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

function issuedControlsHtml(row, { canEdit = true } = {}) {
  if (isStaffCheckIn(row)) {
    return `<span class="er-fee-empty">Not issued to former staff</span>`;
  }
  const transportText = hillviewTransportLabel(row.hillviewTransport);
  if (canEdit) {
    return `<label class="checkbox-label"><input type="checkbox" data-er-food="${escapeHtml(row.id)}" ${row.foodCouponIssued ? "checked" : ""}> Food</label>
      <input type="number" class="er-food-count-input" min="0" max="${MAX_MEMBERS_ATTENDING}" data-er-food-count="${escapeHtml(row.id)}" value="${escapeHtml(String(foodCouponCountOf(row)))}" ${row.foodCouponIssued ? "" : "disabled"} aria-label="Food coupons">
      <label class="checkbox-label"><input type="checkbox" data-er-souvenir="${escapeHtml(row.id)}" ${row.souvenirIssued ? "checked" : ""}> Souvenir</label>
      <label class="checkbox-label"><input type="checkbox" data-er-hillview="${escapeHtml(row.id)}" ${row.hillviewTrip ? "checked" : ""}> Hillview</label>
      <select class="er-hillview-transport-select" data-er-hillview-transport="${escapeHtml(row.id)}" ${row.hillviewTrip ? "" : "disabled"} aria-label="Hillview travel">
        <option value="" ${row.hillviewTransport ? "" : "selected"}>Own vehicle or bus?</option>
        ${HILLVIEW_TRANSPORT.map(
          (o) =>
            `<option value="${escapeHtml(o.value)}" ${row.hillviewTransport === o.value ? "selected" : ""}>${escapeHtml(o.label)}</option>`
        ).join("")}
      </select>`;
  }
  return `${row.foodCouponIssued ? `Food ×${foodCouponCountOf(row)}` : "—"} / ${row.souvenirIssued ? "Souvenir" : "—"} / ${
    row.hillviewTrip ? `Hillview${transportText ? ` · ${transportText}` : ""}` : "—"
  }`;
}

function readDeskIssueToggle(wrap, id, row) {
  const foodEl = wrap.querySelector(`[data-er-food="${id}"]`);
  const souvenirEl = wrap.querySelector(`[data-er-souvenir="${id}"]`);
  const hillviewEl = wrap.querySelector(`[data-er-hillview="${id}"]`);
  const countEl = wrap.querySelector(`[data-er-food-count="${id}"]`);
  const transportEl = wrap.querySelector(`[data-er-hillview-transport="${id}"]`);
  const issued = !!foodEl?.checked;
  const hillviewTrip = !!hillviewEl?.checked;
  if (countEl) countEl.disabled = !issued;
  if (transportEl) {
    transportEl.disabled = !hillviewTrip;
    if (!hillviewTrip) transportEl.value = "";
  }
  const foodCouponCount = normalizeFoodCouponCount(countEl?.value, {
    issued,
    membersAttending: row.membersAttending,
  });
  if (countEl) countEl.value = String(foodCouponCount);
  return {
    foodCouponIssued: issued,
    foodCouponCount,
    souvenirIssued: !!souvenirEl?.checked,
    hillviewTrip,
    hillviewTransport: normalizeHillviewTransport(transportEl?.value, hillviewTrip),
  };
}

function checkInRowHtml(row, { canEdit = true } = {}) {
  return `
    <tr>
      <td><strong>${escapeHtml(row.alumniName || "—")}</strong><br><small style="color:var(--slate-500)">${escapeHtml(sourceLabel(row.source))}${
        isStaffCheckIn(row) && row.staffRole ? ` · ${escapeHtml(staffRoleLabel(row.staffRole))}` : ""
      }</small></td>
      <td>${escapeHtml(departmentLabel(row.department))}${row.batch ? `<br><small>${escapeHtml(row.batch)}</small>` : ""}</td>
      <td>${escapeHtml(row.mobile || row.whatsapp || "—")}<br><small style="color:var(--slate-500)">${escapeHtml(row.email || "")}</small></td>
      <td>${partySizeOf(row)}${accompanyingOf(row) ? `<br><small>${accompanyingOf(row)} family</small>` : ""}</td>
      <td>${issuedControlsHtml(row, { canEdit })}</td>
      <td>${feeCellHtml(row)}</td>
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
      alreadyCheckedIn: !!findExistingCheckIn(enrolled, item, { staff: false }),
      existing: findExistingCheckIn(enrolled, item, { staff: false }),
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
  const live = existing?.id && !isEventDeskTestRecord(existing) ? existing : findExistingCheckIn(enrollments || [], parsed.data, { staff: false });
  const testHit = findTestCheckIn(enrollments || [], parsed.data, { staff: false });
  const row = live || testHit;
  if (row?.id) {
    payload.id = row.id;
    if (row.createdByUserId) payload.createdByUserId = row.createdByUserId;
    if (row.createdByName) payload.createdByName = row.createdByName;
    if (row.deskReceiptNo) payload.deskReceiptNo = row.deskReceiptNo;
  } else {
    payload.createdByUserId = normalizeUsername(session.username);
    payload.createdByName = session.displayName || session.username;
  }
  if (payload.deskFeeReceived) {
    payload.deskFeeReceivedAt = row?.deskFeeReceivedAt || todayISODate();
    payload.deskFeeReceivedBy = row?.deskFeeReceivedBy || session.displayName || session.username;
    if (row?.deskFeeVerified) {
      payload.deskFeeVerified = true;
      payload.deskFeeVerifiedAt = row.deskFeeVerifiedAt || "";
      payload.deskFeeVerifiedBy = row.deskFeeVerifiedBy || "";
    }
    if (row?.deskFeeTransferred) {
      payload.deskFeeTransferred = true;
      payload.deskFeeTransferredAt = row.deskFeeTransferredAt || "";
      payload.deskFeeTransferredBy = row.deskFeeTransferredBy || "";
      payload.deskFeeTreasurerContactId = row.deskFeeTreasurerContactId || "";
    }
  } else {
    payload.deskFeeReceivedAt = "";
    payload.deskFeeReceivedBy = "";
    if (row?.deskReceiptNo) payload.deskReceiptNo = row.deskReceiptNo;
    if (row?.deskFeeTransferred) {
      payload.deskFeeTransferred = true;
      payload.deskFeeTreasurerContactId = row.deskFeeTreasurerContactId || "";
    }
  }
  const id = await saveCheckIn(payload);
  if (payload.deskFeeReceived && !payload.deskReceiptNo) {
    const deskReceiptNo = makeDeskReceiptNo(id);
    await updateDoc(
      doc(db, ALUMNI_CONTACTS_COLLECTION, id),
      withSession(
        omitUndefined({
          deskReceiptNo,
          department: payload.department,
          createdByUserId: payload.createdByUserId,
          recordKind: EVENT_DESK_RECORD_KIND,
          updatedAt: serverTimestamp(),
        })
      )
    );
    payload.deskReceiptNo = deskReceiptNo;
  }
  return { id, record: { ...payload, id } };
}

async function persistStaffCheckIn({ session, task, enrollments }) {
  const parsed = readStaffForm("erStaff", session);
  if (parsed.errors.length) {
    throw new Error(parsed.errors[0]);
  }
  const payload = {
    ...parsed.data,
    source: EVENT_REG_SOURCES.STAFF,
    sourceId: "",
    deptTaskId: task?.id || "",
    taskTitle: task?.title || "Event Registration",
    volunteerDepartment: session.department || "",
    isTest: false,
  };
  const live = findExistingCheckIn(enrollments || [], parsed.data, { staff: true });
  const testHit = findTestCheckIn(enrollments || [], parsed.data, { staff: true });
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
    feeSettings: { feeAmount: 0 },
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
    try {
      state.feeSettings = await loadRegistrationSettings();
    } catch (err) {
      console.error(err);
      state.feeSettings = { feeAmount: 0 };
    }
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
                Use <strong>Former staff</strong> for past teachers, principals, lab and office staff.
              </p>`
        }

        <div class="acct-tabs" role="tablist">
          <button type="button" class="acct-tab ${state.tab === "search" ? "acct-tab--active" : ""}" data-er-tab="search">Already registered</button>
          <button type="button" class="acct-tab ${state.tab === "spot" ? "acct-tab--active" : ""}" data-er-tab="spot">Spot registration</button>
          <button type="button" class="acct-tab ${state.tab === "staff" ? "acct-tab--active" : ""}" data-er-tab="staff">Former staff</button>
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
            <div id="erSpotFields">${enrollmentFormHtml("erSpot", {}, { foodIssuedTotal: foodIssuedTotal(liveEnrollments), hillviewTotal: hillviewCount(liveEnrollments), feeSettings: state.feeSettings })}</div>
            <div style="margin-top:1rem;">
              <button type="submit" class="btn btn--primary" ${canSave ? "" : "disabled"}>Save spot registration</button>
              ${canSave ? "" : `<p class="form-hint">Assigned Event Registration volunteers can save check-ins.</p>`}
            </div>
          </form>
        </div>

        <div class="er-panel" ${state.tab === "staff" ? "" : "hidden"}>
          <h3 class="er-subtitle">Past teachers, principal &amp; staff</h3>
          <p class="form-hint">For people who served at GECI and are not alumni. Food coupons, souvenirs, and the Hillview trip are not issued to former staff.</p>
          <form id="erStaffForm">
            <div id="erStaffFields">${staffFormHtml("erStaff")}</div>
            <div style="margin-top:1rem;">
              <button type="submit" class="btn btn--primary" ${canSave ? "" : "disabled"}>Save staff registration</button>
              ${canSave ? "" : `<p class="form-hint">Assigned Event Registration volunteers can save check-ins.</p>`}
            </div>
          </form>
        </div>

        <div class="er-today">
          <h3 class="er-subtitle">Desk registrations ${deptFilter ? `(${escapeHtml(departmentLabel(deptFilter))})` : ""}</h3>
          <p class="form-hint">${liveEnrollments.length} checked in · Food ${foodIssuedTotal(liveEnrollments.filter((r) => !isStaffCheckIn(r)))} · Souvenir ${liveEnrollments.filter((r) => !isStaffCheckIn(r) && r.souvenirIssued).length} · Hillview ${hillviewCount(liveEnrollments.filter((r) => !isStaffCheckIn(r)))} (${hillviewTransportCount(liveEnrollments, "college_bus")} bus / ${hillviewTransportCount(liveEnrollments, "own_vehicle")} own) · Fees ${liveEnrollments.filter(isDeskFeeReceived).length}</p>
          ${
            liveEnrollments.length
              ? `<div class="table-scroll"><table class="data-table">
                  <thead><tr><th>Name</th><th>Dept</th><th>Contact</th><th>People</th><th>Issued</th><th>Fee</th></tr></thead>
                  <tbody>${liveEnrollments.map((r) => checkInRowHtml(r, { canEdit: canSave })).join("")}</tbody>
                </table></div>`
              : `<p class="empty-state">No desk registrations yet.</p>`
          }
        </div>
      </div>`;

    bind();
    wireFoodCouponControls("erSpot");
    wireHillviewTransport("erSpot");
    wireFeeControls("erSpot", state.feeSettings);
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
          hillviewTrip: false,
        };
    fields.innerHTML = enrollmentFormHtml("erPre", seed, {
      lockedIdentity: false,
      foodIssuedTotal: foodIssuedTotal((state.enrollments || []).filter((r) => !isEventDeskTestRecord(r))),
      hillviewTotal: hillviewCount((state.enrollments || []).filter((r) => !isEventDeskTestRecord(r))),
      feeSettings: state.feeSettings,
    });
    wireFoodCouponControls("erPre");
    wireHillviewTransport("erPre");
    wireFeeControls("erPre", state.feeSettings);
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
        const result = await persistCheckIn({
          session,
          task: state.task,
          source: state.selected.source,
          sourceId: state.selected.sourceId,
          formPrefix: "erPre",
          existing: state.selected.existing,
          enrollments: state.enrollments,
        });
        afterFeeSave(result, "erPre", toast, "Registration saved.");
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
        const existing = findExistingCheckIn(state.enrollments, parsed.data, { staff: false });
        const result = await persistCheckIn({
          session,
          task: state.task,
          source: EVENT_REG_SOURCES.SPOT,
          sourceId: "",
          formPrefix: "erSpot",
          existing,
          enrollments: state.enrollments,
        });
        afterFeeSave(result, "erSpot", toast, existing ? "Updated existing check-in." : "Spot registration saved.");
        await refreshLists();
        state.tab = "spot";
        render();
      } catch (err) {
        console.error(err);
        toast(err.message || "Could not save spot registration.", "error");
      }
    });

    wrap.querySelector("#erStaffForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const parsed = readStaffForm("erStaff", session);
        if (parsed.errors.length) throw new Error(parsed.errors[0]);
        const existing = findExistingCheckIn(state.enrollments, parsed.data, { staff: true });
        await persistStaffCheckIn({
          session,
          task: state.task,
          enrollments: state.enrollments,
        });
        toast(existing ? "Updated existing check-in." : "Staff registration saved.", "success");
        await refreshLists();
        state.tab = "staff";
        render();
      } catch (err) {
        console.error(err);
        toast(err.message || "Could not save staff registration.", "error");
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

    wrap.querySelectorAll("[data-er-food], [data-er-souvenir], [data-er-hillview], [data-er-food-count], [data-er-hillview-transport]").forEach((input) => {
      input.addEventListener("change", async () => {
        const id =
          input.dataset.erFood ||
          input.dataset.erSouvenir ||
          input.dataset.erHillview ||
          input.dataset.erFoodCount ||
          input.dataset.erHillviewTransport;
        const row = state.enrollments.find((r) => r.id === id);
        if (!row || isStaffCheckIn(row)) return;
        const patch = readDeskIssueToggle(wrap, id, row);
        try {
          await updateDoc(
            doc(db, ALUMNI_CONTACTS_COLLECTION, id),
            withSession({
              department: row.department,
              createdByUserId: row.createdByUserId,
              recordKind: EVENT_DESK_RECORD_KIND,
              ...patch,
              updatedAt: serverTimestamp(),
            })
          );
          Object.assign(row, patch);
          const live = (state.enrollments || []).filter((r) => !isEventDeskTestRecord(r));
          const alumniLive = live.filter((r) => !isStaffCheckIn(r));
          const total = foodIssuedTotal(alumniLive);
          const hint = wrap.querySelector(".er-today > .form-hint");
          if (hint) {
            const feeCount = live.filter(isDeskFeeReceived).length;
            hint.textContent = `${live.length} checked in · Food ${total} · Souvenir ${alumniLive.filter((r) => r.souvenirIssued).length} · Hillview ${hillviewCount(alumniLive)} (${hillviewTransportCount(alumniLive, "college_bus")} bus / ${hillviewTransportCount(alumniLive, "own_vehicle")} own) · Fees ${feeCount}`;
          }
          wrap.querySelectorAll(".er-food-total strong").forEach((el) => {
            el.textContent = String(total);
          });
          wrap.querySelectorAll(".er-hillview-total strong").forEach((el) => {
            el.textContent = String(hillviewCount(alumniLive));
          });
        } catch (err) {
          console.error(err);
          toast("Could not update coupon / souvenir / trip.", "error");
          if (input.type === "checkbox") input.checked = !input.checked;
        }
      });
    });

    bindDeskReceiptButtons(wrap, { enrollments: state.enrollments, toast });
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
  const testRows = (enrollments || []).filter(isEventDeskTestRecord);
  const testCount = testRows.length;
  const testStaffCount = testRows.filter(isStaffCheckIn).length;
  enrollments = (enrollments || []).filter((r) => !isEventDeskTestRecord(r));
  const alumni = enrollments.filter((r) => !isStaffCheckIn(r));
  const people = enrollments.reduce((n, r) => n + partySizeOf(r), 0);
  const alumniPeople = alumni.reduce((n, r) => n + partySizeOf(r), 0);
  const food = foodIssuedTotal(alumni);
  const souvenir = alumni.filter((r) => r.souvenirIssued).length;
  const hillview = hillviewCount(alumni);
  const hillviewOwn = hillviewTransportCount(alumni, "own_vehicle");
  const hillviewBus = hillviewTransportCount(alumni, "college_bus");
  const feeRows = enrollments.filter(isDeskFeeReceived);
  const deskFeeCount = feeRows.length;
  const deskFeeTotal = feeRows.reduce((n, r) => n + deskFeeAmountOf(r), 0);
  const deskFeeCash = feeRows.filter((r) => String(r.deskFeeMode || "").toLowerCase() === "cash").length;
  const deskFeeOnline = feeRows.filter((r) => {
    const mode = String(r.deskFeeMode || "").toLowerCase();
    return mode === "online" || mode === "upi" || mode === "bank" || mode === "card";
  }).length;
  const deskFeePendingVerify = feeRows.filter((r) => deskFeeLedgerStatus(r) === "pending").length;
  const deskFeeVerified = feeRows.filter((r) => deskFeeLedgerStatus(r) === "verified").length;
  const deskFeeMoved = feeRows.filter((r) => deskFeeLedgerStatus(r) === "moved").length;
  const deskFeePendingTotal = feeRows
    .filter((r) => deskFeeLedgerStatus(r) === "pending")
    .reduce((n, r) => n + deskFeeAmountOf(r), 0);
  const deskFeeVerifiedTotal = feeRows
    .filter((r) => deskFeeLedgerStatus(r) === "verified")
    .reduce((n, r) => n + deskFeeAmountOf(r), 0);
  const deskFeeMovedTotal = feeRows
    .filter((r) => deskFeeLedgerStatus(r) === "moved")
    .reduce((n, r) => n + deskFeeAmountOf(r), 0);
  const deskFeeUnmovedTotal = deskFeePendingTotal + deskFeeVerifiedTotal;
  const bySource = {
    google_form: enrollments.filter((r) => r.source === EVENT_REG_SOURCES.GOOGLE_FORM).length,
    alumni_connect: enrollments.filter((r) => r.source === EVENT_REG_SOURCES.ALUMNI_CONNECT).length,
    spot: enrollments.filter((r) => r.source === EVENT_REG_SOURCES.SPOT).length,
    staff: enrollments.filter(isStaffCheckIn).length,
  };
  const pendingForm = preRegs.filter((r) => !findExistingCheckIn(enrollments, r, { staff: false })).length;

  function deptStats(rows, code, label) {
    const alumniRows = rows.filter((r) => !isStaffCheckIn(r));
    return {
      code,
      label,
      checkIns: rows.length,
      people: rows.reduce((n, r) => n + partySizeOf(r), 0),
      food: foodIssuedTotal(alumniRows),
      souvenir: alumniRows.filter((r) => r.souvenirIssued).length,
      hillview: hillviewCount(alumniRows),
      hillviewOwn: hillviewTransportCount(alumniRows, "own_vehicle"),
      hillviewBus: hillviewTransportCount(alumniRows, "college_bus"),
      fees: rows.filter(isDeskFeeReceived).length,
      feeTotal: rows.filter(isDeskFeeReceived).reduce((n, r) => n + deskFeeAmountOf(r), 0),
      spot: rows.filter((r) => r.source === EVENT_REG_SOURCES.SPOT).length,
      form: rows.filter((r) => r.source === EVENT_REG_SOURCES.GOOGLE_FORM).length,
      connect: rows.filter((r) => r.source === EVENT_REG_SOURCES.ALUMNI_CONNECT).length,
      staff: rows.filter(isStaffCheckIn).length,
    };
  }

  const deptRows = DEPARTMENTS.map((d) => deptStats(enrollments.filter((r) => r.department === d.value), d.value, d.label));
  const collegeStaff = enrollments.filter((r) => r.department === EVENT_DESK_STAFF_DEPT);
  if (collegeStaff.length) {
    deptRows.push(deptStats(collegeStaff, EVENT_DESK_STAFF_DEPT, "College staff"));
  }
  const other = enrollments.filter(
    (r) => r.department !== EVENT_DESK_STAFF_DEPT && !DEPARTMENTS.some((d) => d.value === r.department)
  );
  if (other.length) {
    deptRows.push(deptStats(other, "OTHER", "Other / unset"));
  }

  return {
    formCount: preRegs.length,
    connectCount: contacts.length,
    checkIns: enrollments.length,
    people,
    alumniPeople,
    alumniCheckIns: alumni.length,
    food,
    souvenir,
    hillview,
    hillviewOwn,
    hillviewBus,
    deskFeeCount,
    deskFeeTotal,
    deskFeeCash,
    deskFeeOnline,
    deskFeePendingVerify,
    deskFeeVerified,
    deskFeeMoved,
    deskFeePendingTotal,
    deskFeeVerifiedTotal,
    deskFeeMovedTotal,
    deskFeeUnmovedTotal,
    foodPending: Math.max(0, alumniPeople - food),
    souvenirPending: Math.max(0, alumni.length - souvenir),
    hillviewPending: Math.max(0, alumni.length - hillview),
    pendingForm,
    arrivedForm: preRegs.length - pendingForm,
    bySource,
    deptRows,
    batches: countBy(
      enrollments.filter((r) => !isStaffCheckIn(r)),
      (r) => r.batch || "—"
    ),
    volunteers: countBy(enrollments, (r) => r.createdByName || r.createdByUserId || "—"),
    testCount,
    testStaffCount,
  };
}

const ER_CHART_COLORS = {
  form: "#2563eb",
  connect: "#6b2d7b",
  spot: "#ea580c",
  issued: "#16a34a",
  pending: "#e2e8f0",
  hillview: "#0f766e",
  checkIn: "#6b2d7b",
  people: "#0d9488",
  year: "#8b3fa0",
  staff: "#0f766e",
  arrived: "#16a34a",
  waiting: "#d97706",
};

function erChartPolar(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: +(cx + r * Math.cos(rad)).toFixed(3),
    y: +(cy + r * Math.sin(rad)).toFixed(3),
  };
}

function erDonutSlicePath(cx, cy, rOuter, rInner, start, end) {
  const sweep = end - start;
  if (sweep <= 0.01) return "";
  if (sweep >= 359.99) {
    return [
      `M ${cx} ${cy - rOuter}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${cx} ${cy + rOuter}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${cx} ${cy - rOuter}`,
      `M ${cx} ${cy - rInner}`,
      `A ${rInner} ${rInner} 0 1 0 ${cx} ${cy + rInner}`,
      `A ${rInner} ${rInner} 0 1 0 ${cx} ${cy - rInner}`,
    ].join(" ");
  }
  const large = sweep > 180 ? 1 : 0;
  const p1 = erChartPolar(cx, cy, rOuter, start);
  const p2 = erChartPolar(cx, cy, rOuter, end);
  const p3 = erChartPolar(cx, cy, rInner, end);
  const p4 = erChartPolar(cx, cy, rInner, start);
  return `M ${p1.x} ${p1.y} A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${rInner} ${rInner} 0 ${large} 0 ${p4.x} ${p4.y} Z`;
}

function erDonutHtml(slices, { title, caption, centerValue, centerLabel }) {
  const items = (slices || []).filter((s) => Number(s.value) > 0);
  const total = items.reduce((n, s) => n + Number(s.value || 0), 0);
  const cx = 80;
  const cy = 80;
  const rOuter = 70;
  const rInner = 44;
  const paths = [];
  if (total > 0) {
    let angle = 0;
    items.forEach((s, i) => {
      const sweep = (Number(s.value) / total) * 360;
      const end = i === items.length - 1 ? 360 : angle + sweep;
      const d = erDonutSlicePath(cx, cy, rOuter, rInner, angle, end);
      if (d) {
        paths.push(`<path d="${d}" fill="${s.color}" fill-rule="evenodd"></path>`);
      }
      angle = end;
    });
  } else {
    paths.push(
      `<path d="${erDonutSlicePath(cx, cy, rOuter, rInner, 0, 360)}" fill="${ER_CHART_COLORS.pending}" fill-rule="evenodd"></path>`
    );
  }
  const legend = (slices || [])
    .map(
      (s) => `
        <li>
          <span class="er-chart__swatch" style="background:${s.color}"></span>
          <span>${escapeHtml(s.label)}</span>
          <strong>${Number(s.value || 0)}</strong>
        </li>`
    )
    .join("");
  return `
    <figure class="er-chart">
      <figcaption class="er-chart__title">${escapeHtml(title)}</figcaption>
      <div class="er-donut-wrap">
        <div class="er-donut" role="img" aria-label="${escapeHtml(`${title}: ${centerValue ?? total} ${centerLabel || ""}`)}">
          <svg viewBox="0 0 160 160" aria-hidden="true">${paths.join("")}</svg>
          <div class="er-donut__center">
            <strong>${escapeHtml(String(centerValue ?? total))}</strong>
            <span>${escapeHtml(centerLabel || "")}</span>
          </div>
        </div>
        <ul class="er-chart__legend">${legend}</ul>
      </div>
      ${caption ? `<p class="er-chart__caption">${escapeHtml(caption)}</p>` : ""}
    </figure>`;
}

function erStackBarsHtml(rows, { title, caption }) {
  const body = (rows || [])
    .map((row) => {
      const total = row.segments.reduce((n, s) => n + Number(s.value || 0), 0);
      const segs =
        total > 0
          ? row.segments
              .filter((s) => Number(s.value) > 0)
              .map((s) => {
                const pct = Math.max(0, (Number(s.value) / total) * 100);
                return `<span class="er-stack__seg" style="width:${pct}%;background:${s.color}" title="${escapeHtml(s.label)}: ${s.value}"></span>`;
              })
              .join("")
          : `<span class="er-stack__seg er-stack__seg--empty"></span>`;
      return `
        <div class="er-stack">
          <div class="er-stack__head">
            <span>${escapeHtml(row.label)}</span>
            <span>${escapeHtml(row.summary)}</span>
          </div>
          <div class="er-stack__track" role="img" aria-label="${escapeHtml(`${row.label} ${row.summary}`)}">${segs}</div>
        </div>`;
    })
    .join("");
  return `
    <figure class="er-chart er-chart--wide">
      <figcaption class="er-chart__title">${escapeHtml(title)}</figcaption>
      ${body}
      ${caption ? `<p class="er-chart__caption">${escapeHtml(caption)}</p>` : ""}
    </figure>`;
}

function erDeptBarsHtml(deptRows) {
  const rows = (deptRows || []).filter((r) => r.checkIns);
  if (!rows.length) return "";
  const max = Math.max(1, ...rows.map((r) => Math.max(r.checkIns, r.people)));
  const body = rows
    .map((r) => {
      const checkPct = Math.max(r.checkIns ? 4 : 0, (r.checkIns / max) * 100);
      const peoplePct = Math.max(r.people ? 4 : 0, (r.people / max) * 100);
      return `
        <div class="er-dept-bar">
          <div class="er-dept-bar__code" title="${escapeHtml(r.label)}">${escapeHtml(r.code || r.label)}</div>
          <div class="er-dept-bar__rows">
            <div class="er-dept-bar__row">
              <div class="er-dept-bar__track">
                <span class="er-dept-bar__fill" style="width:${checkPct}%;background:${ER_CHART_COLORS.checkIn}"></span>
              </div>
              <span>${r.checkIns}</span>
            </div>
            <div class="er-dept-bar__row">
              <div class="er-dept-bar__track">
                <span class="er-dept-bar__fill" style="width:${peoplePct}%;background:${ER_CHART_COLORS.people}"></span>
              </div>
              <span>${r.people}</span>
            </div>
          </div>
        </div>`;
    })
    .join("");
  return `
    <figure class="er-chart er-chart--wide">
      <figcaption class="er-chart__title">Check-ins and people by department</figcaption>
      <ul class="er-chart__legend er-chart__legend--row">
        <li><span class="er-chart__swatch" style="background:${ER_CHART_COLORS.checkIn}"></span> Check-ins</li>
        <li><span class="er-chart__swatch" style="background:${ER_CHART_COLORS.people}"></span> People on campus</li>
      </ul>
      ${body}
      <p class="er-chart__caption">Bar length is relative to the largest department total. Test check-ins are excluded.</p>
    </figure>`;
}

function erYearColumnsHtml(batches) {
  const known = (batches || [])
    .filter(([year]) => year && year !== "—")
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const unknown = (batches || []).find(([year]) => year === "—");
  const items = unknown ? [...known, ["n/a", unknown[1]]] : known;
  if (!items.length) return "";
  const max = Math.max(1, ...items.map(([, n]) => n));
  const cols = items
    .map(([year, n]) => {
      const h = Math.max(8, Math.round((n / max) * 120));
      return `
        <div class="er-col" title="${escapeHtml(String(year))}: ${n}">
          <span class="er-col__value">${n}</span>
          <span class="er-col__bar" style="height:${h}px;background:${ER_CHART_COLORS.year}"></span>
          <span class="er-col__label">${escapeHtml(String(year))}</span>
        </div>`;
    })
    .join("");
  return `
    <figure class="er-chart er-chart--wide">
      <figcaption class="er-chart__title">Check-ins by passout year</figcaption>
      <div class="er-cols" role="img" aria-label="Check-ins by passout year">${cols}</div>
    </figure>`;
}

function erChartsHtml(stats) {
  const parts = [];
  if (stats.checkIns) {
    parts.push(
      erDonutHtml(
        [
          { label: "Google Form", value: stats.bySource.google_form, color: ER_CHART_COLORS.form },
          { label: "Alumni Connect", value: stats.bySource.alumni_connect, color: ER_CHART_COLORS.connect },
          { label: "Spot", value: stats.bySource.spot, color: ER_CHART_COLORS.spot },
          { label: "Former staff", value: stats.bySource.staff, color: ER_CHART_COLORS.staff },
        ],
        {
          title: "Check-in source",
          caption: "Live desk check-ins. Test rows are excluded.",
          centerValue: stats.checkIns,
          centerLabel: "check-ins",
        }
      )
    );
  }
  if (stats.formCount) {
    parts.push(
      erDonutHtml(
        [
          { label: "Arrived", value: stats.arrivedForm, color: ER_CHART_COLORS.arrived },
          { label: "Yet to arrive", value: stats.pendingForm, color: ER_CHART_COLORS.waiting },
        ],
        {
          title: "Google Form arrival",
          caption: "Pre-registered alumni who have checked in at the desk.",
          centerValue: stats.formCount,
          centerLabel: "on file",
        }
      )
    );
  }
  if (stats.checkIns) {
    const foodRemain = Math.max(0, (stats.alumniPeople || stats.people) - stats.food);
    parts.push(
      erStackBarsHtml(
        [
          {
            label: "Food coupons",
            summary: `${stats.food} / ${stats.alumniPeople || stats.people} people`,
            segments: [
              { label: "Issued", value: stats.food, color: ER_CHART_COLORS.issued },
              { label: "Remaining", value: foodRemain, color: ER_CHART_COLORS.pending },
            ],
          },
          {
            label: "Souvenirs",
            summary: `${stats.souvenir} / ${stats.alumniCheckIns || stats.checkIns} alumni`,
            segments: [
              { label: "Issued", value: stats.souvenir, color: ER_CHART_COLORS.issued },
              { label: "Pending", value: stats.souvenirPending, color: ER_CHART_COLORS.pending },
            ],
          },
          {
            label: "Hillview trip",
            summary: `${stats.hillview} joining · ${stats.hillviewBus || 0} bus / ${stats.hillviewOwn || 0} own`,
            segments: [
              { label: "College bus", value: stats.hillviewBus || 0, color: ER_CHART_COLORS.hillview },
              { label: "Own vehicle", value: stats.hillviewOwn || 0, color: ER_CHART_COLORS.checkIn },
              { label: "Not joining", value: stats.hillviewPending, color: ER_CHART_COLORS.pending },
            ],
          },
        ],
        {
          title: "Coupons, souvenirs & Hillview",
          caption: "Food is coupon count versus alumni and family on campus. Souvenir and Hillview are per alumni check-in. Hillview travel is own vehicle or college bus. Former staff are not included.",
        }
      )
    );
    parts.push(erDeptBarsHtml(stats.deptRows));
    parts.push(erYearColumnsHtml(stats.batches));
  }
  if (!parts.length) return "";
  return `
    <div>
      <h3 class="ac-dashboard__subtitle">Charts</h3>
      <div class="er-charts">${parts.join("")}</div>
    </div>`;
}

function erStatCardsHtml(stats) {
  const cards = [
    { label: "Google Form responses", value: stats.formCount, tone: "neutral" },
    { label: "Alumni Connect pool", value: stats.connectCount, tone: "neutral" },
    { label: "Desk check-ins", value: stats.checkIns, tone: "good" },
    { label: "People on campus", value: stats.people, tone: "good" },
    { label: "Food coupons issued", value: `${stats.food} / ${stats.alumniPeople || stats.people}`, tone: stats.food < (stats.alumniPeople || stats.people) ? "warn" : "good" },
    { label: "Souvenirs issued", value: `${stats.souvenir} / ${stats.alumniCheckIns || stats.checkIns}`, tone: stats.souvenirPending ? "warn" : "good" },
    { label: `Hillview trip · ${stats.hillviewBus || 0} college bus / ${stats.hillviewOwn || 0} own vehicle`, value: `${stats.hillview} / ${stats.alumniCheckIns || stats.checkIns}`, tone: stats.hillviewPending ? "warn" : "good" },
    {
      label: `Event Desk fees still off treasurer books · ${stats.deskFeeCash || 0} cash / ${stats.deskFeeOnline || 0} online`,
      value: `${formatRupee(stats.deskFeeUnmovedTotal)} (${(stats.deskFeePendingVerify || 0) + (stats.deskFeeVerified || 0)})`,
      tone: stats.deskFeeUnmovedTotal ? "warn" : "neutral",
    },
    {
      label: "Awaiting admin verification",
      value: `${formatRupee(stats.deskFeePendingTotal)} (${stats.deskFeePendingVerify || 0})`,
      tone: stats.deskFeePendingVerify ? "warn" : "good",
    },
    {
      label: "Moved to treasurer books",
      value: `${formatRupee(stats.deskFeeMovedTotal)} (${stats.deskFeeMoved || 0})`,
      tone: stats.deskFeeMoved ? "good" : "neutral",
    },
    { label: "Spot registrations", value: stats.bySource.spot, tone: "neutral" },
    { label: "Former staff", value: stats.bySource.staff, tone: "neutral" },
    { label: "From Google Form", value: stats.bySource.google_form, tone: "neutral" },
    { label: "From Alumni Connect", value: stats.bySource.alumni_connect, tone: "neutral" },
    { label: "Form yet to arrive", value: stats.pendingForm, tone: stats.pendingForm ? "warn" : "good" },
    { label: "Test check-ins", value: stats.testStaffCount ? `${stats.testCount} (${stats.testStaffCount} staff)` : stats.testCount || 0, tone: stats.testCount ? "warn" : "neutral" },
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
    if (source === EVENT_REG_SOURCES.STAFF) {
      if (!isStaffCheckIn(r)) return false;
    } else if (source && r.source !== source) return false;
    if (issue === "test" && !isEventDeskTestRecord(r)) return false;
    if (issue === "live" && isEventDeskTestRecord(r)) return false;
    if (issue === "food" && (isStaffCheckIn(r) || !r.foodCouponIssued)) return false;
    if (issue === "food_pending" && (isStaffCheckIn(r) || r.foodCouponIssued)) return false;
    if (issue === "souvenir" && (isStaffCheckIn(r) || !r.souvenirIssued)) return false;
    if (issue === "souvenir_pending" && (isStaffCheckIn(r) || r.souvenirIssued)) return false;
    if (issue === "hillview" && (isStaffCheckIn(r) || !r.hillviewTrip)) return false;
    if (issue === "hillview_pending" && (isStaffCheckIn(r) || r.hillviewTrip)) return false;
    if (issue === "hillview_bus" && (isStaffCheckIn(r) || r.hillviewTransport !== "college_bus")) return false;
    if (issue === "hillview_own" && (isStaffCheckIn(r) || r.hillviewTransport !== "own_vehicle")) return false;
    if (issue === "fee_paid" && !isDeskFeeReceived(r)) return false;
    if (issue === "fee_pending" && isDeskFeeReceived(r)) return false;
    if (issue === "fee_verify_pending" && deskFeeLedgerStatus(r) !== "pending") return false;
    if (issue === "fee_verified" && deskFeeLedgerStatus(r) !== "verified") return false;
    if (issue === "fee_moved" && deskFeeLedgerStatus(r) !== "moved") return false;
    if (search && !matchesSearch(r, search)) return false;
    return true;
  });
}

function deskFeeLedgerHtml(state) {
  const live = (state.enrollments || []).filter((r) => !isEventDeskTestRecord(r) && isDeskFeeReceived(r));
  const queue = live.filter((r) => deskFeeLedgerStatus(r) !== "moved");
  const moved = live.filter((r) => deskFeeLedgerStatus(r) === "moved");
  const rowHtml = (r) => {
    const match = findTreasurerContactForDeskFee(r, state.contacts || []);
    const status = deskFeeLedgerStatus(r);
    const matchNote = match
      ? match.registrationStatus === "paid"
        ? `Already paid in treasurer (${escapeHtml(match.alumniName || "alumni")}) — move will link only`
        : `Will update Alumni Connect: ${escapeHtml(match.alumniName || "alumni")}`
      : "No treasurer record yet — move will create a fee entry";
    return `
      <tr>
        <td>
          <strong>${escapeHtml(r.alumniName || "—")}</strong>
          ${deskFeeStatusBadge(r)}
          <br><small style="color:var(--slate-500)">${escapeHtml(sourceLabel(r.source))} · ${escapeHtml(departmentLabel(r.department))}${r.batch ? ` · ${escapeHtml(r.batch)}` : ""}</small>
        </td>
        <td>${escapeHtml(formatRupee(deskFeeAmountOf(r)))}<br><small>${escapeHtml(deskFeeModeLabel(r.deskFeeMode))}</small></td>
        <td>${escapeHtml(r.deskReceiptNo || "—")}<br><small>${escapeHtml(r.deskFeeReceivedBy || r.createdByName || "—")}</small></td>
        <td><small>${escapeHtml(matchNote)}</small></td>
        <td>
          <button type="button" class="btn btn--sm btn--ghost er-receipt-btn" data-er-receipt="${escapeHtml(r.id)}">Receipt</button>
          ${
            status === "pending"
              ? `<button type="button" class="btn btn--sm btn--primary er-receipt-btn" data-er-fee-verify="${escapeHtml(r.id)}">Verify</button>`
              : ""
          }
          ${
            status === "verified"
              ? `<button type="button" class="btn btn--sm btn--primary er-receipt-btn" data-er-fee-move="${escapeHtml(r.id)}">Move to treasurer</button>`
              : ""
          }
        </td>
      </tr>`;
  };

  return `
    <div class="er-fee-ledger">
      <h3 class="ac-dashboard__subtitle">Event Desk fees — verify, then move to treasurer</h3>
      <p class="form-hint" style="margin-top:0;">
        These amounts are <strong>not</strong> mixed with treasurer registration fees.
        Verify a desk receipt first, then move it into treasurer books. Until then, Finance totals stay unchanged.
      </p>
      ${
        queue.length
          ? `<div class="table-scroll">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Alumni</th>
                    <th>Amount</th>
                    <th>Receipt</th>
                    <th>Treasurer match</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>${queue.map(rowHtml).join("")}</tbody>
              </table>
            </div>`
          : `<p class="empty-state">No Event Desk fees waiting for verification or transfer.</p>`
      }
      ${
        moved.length
          ? `<p class="form-hint">${moved.length} receipt${moved.length === 1 ? "" : "s"} already moved to treasurer (${escapeHtml(formatRupee(moved.reduce((n, r) => n + deskFeeAmountOf(r), 0)))}).</p>`
          : ""
      }
    </div>`;
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
    feeSettings: { feeAmount: 0 },
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
    try {
      state.feeSettings = await loadRegistrationSettings();
    } catch (err) {
      console.error(err);
      state.feeSettings = { feeAmount: 0 };
    }
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

        ${erChartsHtml(stats)}

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
                  <th>Hillview</th>
                  <th>Fees</th>
                  <th>Form</th>
                  <th>Connect</th>
                  <th>Spot</th>
                  <th>Staff</th>
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
                      <td>${r.hillview}${
                        r.hillview
                          ? `<br><small>${r.hillviewBus || 0} bus · ${r.hillviewOwn || 0} own</small>`
                          : ""
                      }</td>
                      <td>${r.fees ? `${formatRupee(r.feeTotal)} (${r.fees})` : "—"}</td>
                      <td>${r.form}</td>
                      <td>${r.connect}</td>
                      <td>${r.spot}</td>
                      <td>${r.staff || 0}</td>
                    </tr>`
                        )
                        .join("")
                    : `<tr><td colspan="11" class="empty-state">No desk check-ins yet.</td></tr>`
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

        ${deskFeeLedgerHtml(state)}

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
                <option value="${EVENT_DESK_STAFF_DEPT}" ${state.department === EVENT_DESK_STAFF_DEPT ? "selected" : ""}>College staff</option>
              </select>
            </div>
            <div class="form-group">
              <label for="erAdmSource">Source</label>
              <select id="erAdmSource">
                <option value="">All</option>
                <option value="${EVENT_REG_SOURCES.GOOGLE_FORM}" ${state.source === EVENT_REG_SOURCES.GOOGLE_FORM ? "selected" : ""}>Google Form</option>
                <option value="${EVENT_REG_SOURCES.ALUMNI_CONNECT}" ${state.source === EVENT_REG_SOURCES.ALUMNI_CONNECT ? "selected" : ""}>Alumni Connect</option>
                <option value="${EVENT_REG_SOURCES.SPOT}" ${state.source === EVENT_REG_SOURCES.SPOT ? "selected" : ""}>Spot</option>
                <option value="${EVENT_REG_SOURCES.STAFF}" ${state.source === EVENT_REG_SOURCES.STAFF ? "selected" : ""}>Former staff</option>
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
                <option value="hillview" ${state.issue === "hillview" ? "selected" : ""}>Hillview joining</option>
                <option value="hillview_pending" ${state.issue === "hillview_pending" ? "selected" : ""}>Hillview not joining</option>
                <option value="hillview_bus" ${state.issue === "hillview_bus" ? "selected" : ""}>Hillview — college bus</option>
                <option value="hillview_own" ${state.issue === "hillview_own" ? "selected" : ""}>Hillview — own vehicle</option>
                <option value="fee_paid" ${state.issue === "fee_paid" ? "selected" : ""}>Fee received (desk)</option>
                <option value="fee_pending" ${state.issue === "fee_pending" ? "selected" : ""}>Fee not collected</option>
                <option value="fee_verify_pending" ${state.issue === "fee_verify_pending" ? "selected" : ""}>Fee awaiting verification</option>
                <option value="fee_verified" ${state.issue === "fee_verified" ? "selected" : ""}>Fee verified, not moved</option>
                <option value="fee_moved" ${state.issue === "fee_moved" ? "selected" : ""}>Fee in treasurer books</option>
              </select>
            </div>
          </div>
          <p class="form-hint">Showing ${filtered.length} of ${state.enrollments.length} check-ins. Event Desk fees stay off treasurer books until you verify and move them above.</p>
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Dept / year</th>
                  <th>Contact</th>
                  <th>People</th>
                  <th>Work</th>
                  <th>Source</th>
                  <th>Issued</th>
                  <th>Fee</th>
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
                      ${isEventDeskTestRecord(r) ? ` <span class="badge ${isStaffCheckIn(r) ? "badge--source-staff" : "badge--source-spot"}">Test</span>` : ""}
                      ${r.address ? `<br><small style="color:var(--slate-500)">${escapeHtml(r.address)}</small>` : ""}
                    </td>
                    <td>${escapeHtml(departmentLabel(r.department))}${
                      isStaffCheckIn(r) && r.yearsServed
                        ? `<br><small>${escapeHtml(r.yearsServed)}</small>`
                        : r.batch
                          ? `<br><small>${escapeHtml(r.batch)}</small>`
                          : ""
                    }</td>
                    <td>${escapeHtml(r.mobile || r.whatsapp || "—")}${r.email ? `<br><small style="color:var(--slate-500)">${escapeHtml(r.email)}</small>` : ""}</td>
                    <td>${partySizeOf(r)}${accompanyingOf(r) ? `<br><small>${accompanyingOf(r)} family</small>` : ""}</td>
                    <td>${
                      isStaffCheckIn(r)
                        ? `${escapeHtml(staffRoleLabel(r.staffRole))}${r.yearsServed ? `<br><small style="color:var(--slate-500)">${escapeHtml(r.yearsServed)}</small>` : ""}`
                        : `${escapeHtml(r.company || "—")}${r.jobRole || r.jobSector ? `<br><small style="color:var(--slate-500)">${escapeHtml([r.jobRole, r.jobSector].filter(Boolean).join(" · "))}</small>` : ""}`
                    }</td>
                    <td>${escapeHtml(sourceLabel(r.source))}</td>
                    <td>${issuedControlsHtml(r)}</td>
                    <td>${feeCellHtml(r, { admin: true })}</td>
                    <td>
                      <label class="checkbox-label"><input type="checkbox" data-er-test="${escapeHtml(r.id)}" ${isEventDeskTestRecord(r) ? "checked" : ""}> Mark as test</label>
                    </td>
                    <td>${escapeHtml(r.createdByName || r.createdByUserId || "—")}</td>
                  </tr>`
                        )
                        .join("")
                    : `<tr><td colspan="10" class="empty-state">No matching check-ins.</td></tr>`
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
    wrap.querySelectorAll("[data-er-food], [data-er-souvenir], [data-er-hillview], [data-er-food-count], [data-er-hillview-transport]").forEach((input) => {
      input.addEventListener("change", async () => {
        const id =
          input.dataset.erFood ||
          input.dataset.erSouvenir ||
          input.dataset.erHillview ||
          input.dataset.erFoodCount ||
          input.dataset.erHillviewTransport;
        const row = state.enrollments.find((r) => r.id === id);
        if (!row || isStaffCheckIn(row)) return;
        const patch = readDeskIssueToggle(wrap, id, row);
        try {
          await updateDoc(
            doc(db, ALUMNI_CONTACTS_COLLECTION, id),
            withSession({
              department: row.department,
              createdByUserId: row.createdByUserId,
              recordKind: EVENT_DESK_RECORD_KIND,
              ...patch,
              updatedAt: serverTimestamp(),
            })
          );
          Object.assign(row, patch);
          render();
        } catch (err) {
          console.error(err);
          toast("Could not update coupon / souvenir / trip.", "error");
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
            withSession(
              omitUndefined({
                department: row.department || (isStaffCheckIn(row) ? EVENT_DESK_STAFF_DEPT : ""),
                createdByUserId: row.createdByUserId,
                recordKind: EVENT_DESK_RECORD_KIND,
                source: row.source,
                guestKind: row.guestKind || (isStaffCheckIn(row) ? "staff" : "alumni"),
                staffRole: row.staffRole,
                yearsServed: row.yearsServed,
                isTest,
                updatedAt: serverTimestamp(),
              })
            )
          );
          row.isTest = isTest;
          const who = row.alumniName || (isStaffCheckIn(row) ? "Former staff" : "Alumni");
          toast(
            isTest
              ? `${who} marked as test and treated as unregistered ${deskGuestLabel(row)}.`
              : `${who} is a live ${deskGuestLabel(row)} check-in again.`,
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

    bindDeskReceiptButtons(wrap, { enrollments: state.enrollments, toast });

    async function patchDeskLedger(row, patch) {
      await updateDoc(
        doc(db, ALUMNI_CONTACTS_COLLECTION, row.id),
        withSession(
          omitUndefined({
            department: row.department,
            createdByUserId: row.createdByUserId,
            recordKind: EVENT_DESK_RECORD_KIND,
            source: row.source,
            guestKind: row.guestKind,
            ...patch,
            updatedAt: serverTimestamp(),
          })
        )
      );
      Object.assign(row, patch);
    }

    wrap.querySelectorAll("[data-er-fee-verify]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = state.enrollments.find((r) => r.id === btn.dataset.erFeeVerify);
        if (!row) return;
        if (
          !window.confirm(
            `Verify the Event Desk receipt for ${row.alumniName || "this alumni"} (${formatRupee(deskFeeAmountOf(row))})?\n\nIt will still not appear in treasurer books until you move it.`
          )
        ) {
          return;
        }
        try {
          await patchDeskLedger(row, {
            deskFeeVerified: true,
            deskFeeVerifiedAt: todayISODate(),
            deskFeeVerifiedBy: session.displayName || session.username,
          });
          toast("Verified. Move it to treasurer when you are ready.", "success");
          render();
        } catch (err) {
          console.error(err);
          toast(err.message || "Could not verify this fee.", "error");
        }
      });
    });

    wrap.querySelectorAll("[data-er-fee-move]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = state.enrollments.find((r) => r.id === btn.dataset.erFeeMove);
        if (!row) return;
        const match = findTreasurerContactForDeskFee(row, state.contacts);
        const prompt =
          match?.registrationStatus === "paid"
            ? `${row.alumniName || "This alumni"} is already marked paid in treasurer books. Link this Event Desk receipt without adding the amount again?`
            : `Move the verified Event Desk fee for ${row.alumniName || "this alumni"} (${formatRupee(deskFeeAmountOf(row))}) into treasurer registration fees?\n\nThe Event Desk receipt stays on Event Desk.`;
        if (!window.confirm(prompt)) return;
        try {
          const result = await copyDeskFeeIntoTreasurerBooks(row, state.contacts, state.feeSettings, session);
          await patchDeskLedger(row, {
            deskFeeTransferred: true,
            deskFeeTransferredAt: todayISODate(),
            deskFeeTransferredBy: session.displayName || session.username,
            deskFeeTreasurerContactId: result.contactId,
          });
          await refresh();
          toast(
            result.linkedExistingPaid
              ? "Linked to an existing treasurer payment. Amount was not added again."
              : "Moved to treasurer books.",
            "success"
          );
          render();
        } catch (err) {
          console.error(err);
          toast(err.message || "Could not move this fee to treasurer.", "error");
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
