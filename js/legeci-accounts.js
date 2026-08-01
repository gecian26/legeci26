import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { withSession } from "./auth.js";
import {
  LEGECI_EXPENSES_COLLECTION,
  EXPENSE_CATEGORIES,
  PAYMENT_MODES,
  EXPENSE_STATUS,
  DEPARTMENTS,
  MEETUP_NAME,
  USERS_COLLECTION,
  REGISTRY_DOC,
  ROLES,
  escapeHtml,
  formatDateShort,
  showToast,
  normalizeUsername,
} from "./constants.js";
import {
  loadAllAlumniContacts,
  loadRegistrationSettings,
  updateAlumniContact,
  saveAlumniContact,
  statusBadgeHtml,
} from "./alumni-connect.js";

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function formatINR(amount) {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `₹${n.toLocaleString("en-IN")}`;
  }
}

export function categoryLabel(value) {
  return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label || value || "—";
}

export function paymentModeLabel(value) {
  return PAYMENT_MODES.find((m) => m.value === value)?.label || value || "—";
}

export function expenseStatusMeta(expense) {
  if (expense?.reimbursed || expense?.status === EXPENSE_STATUS.SETTLED) {
    return { label: "Paid to person", tone: "green" };
  }
  return { label: "Not paid yet", tone: "orange" };
}

export async function loadExpenses() {
  const snap = await getDocs(collection(db, LEGECI_EXPENSES_COLLECTION));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => !e._deleted)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

export async function loadCoordinators() {
  try {
    const snap = await getDoc(doc(db, USERS_COLLECTION, REGISTRY_DOC));
    const users = snap.exists() ? snap.data().users || [] : [];
    return users
      .filter(
        (u) =>
          u.active !== false &&
          u.role &&
          u.role !== ROLES.ADMIN &&
          u.role !== ROLES.STUDENT
      )
      .map((u) => ({
        userId: u.userId,
        displayName: u.displayName || u.fullName || u.username || u.userId,
        department: u.department || "",
        role: u.role,
      }))
      .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
  } catch (err) {
    console.error(err);
    return [];
  }
}

export async function saveExpense(data) {
  const reimbursed = !!data.reimbursed;
  return addDoc(
    collection(db, LEGECI_EXPENSES_COLLECTION),
    withSession({
      title: (data.title || "").trim(),
      category: data.category || "misc",
      amount: Number(data.amount) || 0,
      date: data.date || todayISO(),
      paidBy: (data.paidBy || "").trim(),
      paidByUserId: data.paidByUserId || "",
      department: data.department || "",
      paymentMode: data.paymentMode || "cash",
      billRef: (data.billRef || "").trim(),
      notes: (data.notes || "").trim(),
      reimbursed,
      reimbursedAt: reimbursed ? data.reimbursedAt || todayISO() : "",
      status: reimbursed ? EXPENSE_STATUS.SETTLED : EXPENSE_STATUS.PENDING,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
}

export async function updateExpense(id, data) {
  return updateDoc(
    doc(db, LEGECI_EXPENSES_COLLECTION, id),
    withSession({
      ...data,
      updatedAt: serverTimestamp(),
    })
  );
}

export async function softDeleteExpense(id) {
  return updateExpense(id, { _deleted: true });
}

export async function setExpenseReimbursed(id, reimbursed) {
  return updateExpense(id, {
    reimbursed: !!reimbursed,
    reimbursedAt: reimbursed ? todayISO() : "",
    status: reimbursed ? EXPENSE_STATUS.SETTLED : EXPENSE_STATUS.PENDING,
  });
}

export function enrichExpenses(expenses) {
  return (expenses || []).map((e) => {
    const reimbursed = e.reimbursed === true || e.status === EXPENSE_STATUS.SETTLED;
    return {
      ...e,
      reimbursed,
      outstanding: reimbursed ? 0 : Number(e.amount) || 0,
      status: reimbursed ? EXPENSE_STATUS.SETTLED : EXPENSE_STATUS.PENDING,
    };
  });
}

export function summarizeAccounts(expenses) {
  const enriched = enrichExpenses(expenses);
  const totalExpenses = enriched.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalPaid = enriched
    .filter((e) => e.reimbursed)
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalOutstanding = enriched
    .filter((e) => !e.reimbursed)
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const pendingCount = enriched.filter((e) => !e.reimbursed).length;
  const byCategory = {};
  enriched.forEach((e) => {
    const key = e.category || "misc";
    byCategory[key] = (byCategory[key] || 0) + (Number(e.amount) || 0);
  });
  return {
    totalExpenses,
    totalPaid,
    totalOutstanding,
    totalSettlements: totalPaid,
    pendingCount,
    expenseCount: enriched.length,
    byCategory,
    enriched,
  };
}

export function contactFeeAmount(contact, feeSettings) {
  const fromContact = Number(contact?.feeAmount);
  if (fromContact > 0) return fromContact;
  return Number(feeSettings?.feeAmount) || 0;
}

export function summarizeRegistrationFees(contacts, feeSettings) {
  const list = contacts || [];
  const feeAmount = Number(feeSettings?.feeAmount) || 0;
  const paid = list.filter((c) => c.registrationStatus === "paid");
  const pending = list.filter((c) => c.registrationStatus === "pending_payment");
  const receivedTotal = paid.reduce((s, c) => s + contactFeeAmount(c, feeSettings), 0);
  const pendingTotal = pending.reduce((s, c) => s + contactFeeAmount(c, feeSettings), 0);
  return {
    feeAmount,
    feeNote: feeSettings?.feeNote || "",
    paidCount: paid.length,
    pendingCount: pending.length,
    receivedTotal,
    pendingTotal,
    expectedTotal: receivedTotal + pendingTotal,
  };
}

export async function setAlumniFeeReceived(contact, received, feeSettings, session, paymentMode = "cash") {
  const feeAmount = contactFeeAmount(contact, feeSettings);
  const feeCurrency = contact.feeCurrency || feeSettings?.feeCurrency || "INR";
  const payload = {
    registrationStatus: received ? "paid" : "pending_payment",
    feeAmount,
    feeCurrency,
    feeReceivedAt: received ? todayISO() : "",
    feePaymentMode: received ? paymentMode || "cash" : "",
    feeReceivedBy: received
      ? session?.displayName || session?.username || "Treasurer"
      : "",
  };
  await updateAlumniContact(contact.id, payload);
  return payload;
}

export function contactFeeRemarks(contact) {
  return String(contact?.feeRemarks || contact?.notes || "").trim();
}

export async function saveFeeRemarks(contactId, remarks) {
  const feeRemarks = String(remarks || "").trim();
  await updateAlumniContact(contactId, { feeRemarks });
  return feeRemarks;
}

/** Manual registration fee entry (not from Alumni Connect outreach). */
export async function saveManualRegistrationFee(data, feeSettings, session) {
  const paid = data.registrationStatus === "paid" || data.feeReceived === true;
  const feeAmount =
    Number(data.feeAmount) > 0
      ? Number(data.feeAmount)
      : Number(feeSettings?.feeAmount) || 0;
  const feeCurrency = feeSettings?.feeCurrency || "INR";
  const paymentMode = data.feePaymentMode || "cash";
  const createdByUserId = normalizeUsername(session?.username || "treasurer");
  const whatsapp = (data.whatsapp || data.mobile || "").trim();
  const feeRemarks = String(data.feeRemarks || data.notes || "").trim();

  return saveAlumniContact({
    alumniName: (data.alumniName || "").trim(),
    email: (data.email || "").trim(),
    whatsapp,
    mobile: (data.mobile || "").trim(),
    address: "",
    company: "",
    jobSector: "",
    batch: (data.batch || "").trim(),
    willingness: "willing",
    registrationStatus: paid ? "paid" : "pending_payment",
    notes: feeRemarks,
    feeRemarks,
    department: data.department || "",
    team: "",
    deptTaskId: "manual_fee",
    parentTaskId: "",
    taskTitle: "Manual registration fee",
    source: "manual_fee",
    feeAmount,
    feeCurrency,
    feeReceivedAt: paid ? data.feeReceivedAt || todayISO() : "",
    feePaymentMode: paid ? paymentMode : "",
    feeReceivedBy: paid
      ? session?.displayName || session?.username || "Treasurer"
      : "",
    createdByUserId,
    createdByName: session?.displayName || session?.username || "Treasurer",
  });
}

function optionsHtml(options, selected = "") {
  return options
    .map(
      (o) =>
        `<option value="${escapeHtml(o.value)}" ${o.value === selected ? "selected" : ""}>${escapeHtml(o.label)}</option>`
    )
    .join("");
}

export async function mountTreasurerAccounts(wrap, { toast, session } = {}) {
  if (!wrap) return;

  let expenses = [];
  let coordinators = [];
  let contacts = [];
  let feeSettings = null;
  let tab = "overview";
  let feeFilter = "pending";
  let feeSearch = "";
  let editingRemarksId = "";
  let bound = wrap.dataset.accountsBound === "1";

  async function refresh() {
    wrap.innerHTML = '<p class="empty-state">Loading finance…</p>';
    try {
      [expenses, coordinators, contacts, feeSettings] = await Promise.all([
        loadExpenses(),
        loadCoordinators(),
        loadAllAlumniContacts(),
        loadRegistrationSettings(),
      ]);
      render();
    } catch (err) {
      console.error(err);
      wrap.innerHTML = '<p class="empty-state">Failed to load finance. Check Firestore rules.</p>';
    }
  }

  function render() {
    const summary = summarizeAccounts(expenses);
    const fees = summarizeRegistrationFees(contacts, feeSettings);
    wrap.innerHTML = `
      <div class="acct">
        <div class="acct-hero">
          <div>
            <p class="acct-hero__eyebrow">${escapeHtml(MEETUP_NAME || "LEGECI")} Finance</p>
            <h2 class="acct-hero__title">Money at a glance</h2>
            <p class="acct-hero__sub">Track expenses paid to coordinators and registration fees received from alumni.</p>
          </div>
          <div class="acct-hero__actions">
            <button type="button" class="btn btn--ghost btn--sm" data-acct-tab="fee-add">+ Add fee entry</button>
            <button type="button" class="btn btn--primary btn--sm" data-acct-tab="expense">+ Add expense</button>
          </div>
        </div>

        <div class="acct-stat-grid">
          <div class="acct-stat acct-stat--good"><div class="acct-stat__value">${formatINR(fees.receivedTotal)}</div><div class="acct-stat__label">Fees received</div></div>
          <div class="acct-stat acct-stat--warn"><div class="acct-stat__value">${formatINR(fees.pendingTotal)}</div><div class="acct-stat__label">Fees pending</div></div>
          <div class="acct-stat"><div class="acct-stat__value">${formatINR(summary.totalExpenses)}</div><div class="acct-stat__label">Total expenses</div></div>
          <div class="acct-stat"><div class="acct-stat__value">${formatINR(summary.totalOutstanding)}</div><div class="acct-stat__label">Not paid to person</div></div>
        </div>

        <div class="acct-tabs" role="tablist">
          <button type="button" class="acct-tab ${tab === "overview" ? "acct-tab--active" : ""}" data-acct-tab="overview">Overview</button>
          <button type="button" class="acct-tab ${tab === "fees" ? "acct-tab--active" : ""}" data-acct-tab="fees">Registration fees</button>
          <button type="button" class="acct-tab ${tab === "fee-add" ? "acct-tab--active" : ""}" data-acct-tab="fee-add">Add fee entry</button>
          <button type="button" class="acct-tab ${tab === "expenses" ? "acct-tab--active" : ""}" data-acct-tab="expenses">All expenses</button>
          <button type="button" class="acct-tab ${tab === "expense" ? "acct-tab--active" : ""}" data-acct-tab="expense">Add expense</button>
        </div>

        <div class="acct-panel">
          ${
            tab === "expense"
              ? expenseFormHtml()
              : tab === "expenses"
                ? expensesListHtml(summary.enriched)
                : tab === "fee-add"
                  ? feeEntryFormHtml()
                  : tab === "fees"
                    ? feesPanelHtml(fees)
                    : overviewHtml(summary, fees)
          }
        </div>
      </div>`;
  }

  function overviewHtml(summary, fees) {
    const cats = Object.entries(summary.byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const open = summary.enriched.filter((e) => !e.reimbursed).slice(0, 6);
    const pendingFees = contacts
      .filter((c) => c.registrationStatus === "pending_payment")
      .slice(0, 6);

    return `
      <div class="acct-overview">
        <div class="acct-card">
          <h3 class="acct-card__title">Registration fees</h3>
          <p class="form-hint" style="margin-top:0;">Fee rate: <strong>${formatINR(fees.feeAmount)}</strong>${
            fees.feeNote ? ` · ${escapeHtml(fees.feeNote)}` : ""
          }</p>
          <ul class="acct-cat-list">
            <li><span>Received (${fees.paidCount})</span><strong>${formatINR(fees.receivedTotal)}</strong></li>
            <li><span>Pending (${fees.pendingCount})</span><strong>${formatINR(fees.pendingTotal)}</strong></li>
          </ul>
          ${
            pendingFees.length
              ? `<ul class="acct-open-list" style="margin-top:1rem;">
                  ${pendingFees
                    .map(
                      (c) => `
                    <li>
                      <div>
                        <strong>${escapeHtml(c.alumniName || "—")}</strong>
                        <small>${escapeHtml(c.department || "—")}${c.batch ? ` · ${escapeHtml(c.batch)}` : ""}</small>
                      </div>
                      <div class="acct-open-list__right">
                        <strong>${formatINR(contactFeeAmount(c, feeSettings))}</strong>
                        <button type="button" class="btn btn--primary btn--sm" data-acct-mark-fee="${escapeHtml(c.id)}">Mark received</button>
                      </div>
                    </li>`
                    )
                    .join("")}
                </ul>`
              : '<p class="empty-state" style="margin-top:0.75rem;">No pending registration fees.</p>'
          }
          <button type="button" class="btn btn--ghost btn--sm" data-acct-tab="fees" style="margin-top:0.75rem;">Manage all fees</button>
        </div>
        <div class="acct-card">
          <h3 class="acct-card__title">Spend by category</h3>
          ${
            cats.length
              ? `<ul class="acct-cat-list">
                  ${cats
                    .map(
                      ([k, v]) => `
                    <li>
                      <span>${escapeHtml(categoryLabel(k))}</span>
                      <strong>${formatINR(v)}</strong>
                    </li>`
                    )
                    .join("")}
                </ul>`
              : '<p class="empty-state">No expenses yet. Tap Add expense to start.</p>'
          }
        </div>
        <div class="acct-card">
          <h3 class="acct-card__title">Not paid to person yet</h3>
          ${
            open.length
              ? `<ul class="acct-open-list">
                  ${open
                    .map((e) => {
                      const meta = expenseStatusMeta(e);
                      return `
                    <li>
                      <div>
                        <strong>${escapeHtml(e.title)}</strong>
                        <small>${escapeHtml(e.paidBy || "—")} · ${escapeHtml(formatDateShort(e.date) || "—")}</small>
                      </div>
                      <div class="acct-open-list__right">
                        <span class="badge badge--status badge--status-${meta.tone}">${meta.label}</span>
                        <strong>${formatINR(e.amount)}</strong>
                        <button type="button" class="btn btn--primary btn--sm" data-acct-mark-paid="${escapeHtml(e.id)}">Mark paid</button>
                      </div>
                    </li>`;
                    })
                    .join("")}
                </ul>`
              : '<p class="empty-state">All clear — everyone has been paid.</p>'
          }
        </div>
      </div>`;
  }

  function filteredFeeContacts() {
    const q = feeSearch.trim().toLowerCase();
    return contacts
      .filter((c) => {
        const status = c.registrationStatus || "not_registered";
        if (feeFilter === "pending") return status === "pending_payment";
        if (feeFilter === "paid") return status === "paid";
        if (feeFilter === "due") return status === "pending_payment" || status === "paid";
        return true;
      })
      .filter((c) => {
        if (!q) return true;
        const hay = [c.alumniName, c.whatsapp, c.mobile, c.department, c.batch, c.email, contactFeeRemarks(c)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
  }

  function remarksCellHtml(c) {
    const remarks = contactFeeRemarks(c);
    if (editingRemarksId === c.id) {
      return `
        <div class="acct-remarks-edit">
          <textarea id="acctRemarksInput" rows="2" maxlength="500" placeholder="e.g. Paid via UPI at desk">${escapeHtml(remarks)}</textarea>
          <div class="acct-remarks-edit__actions">
            <button type="button" class="btn btn--primary btn--sm" data-acct-save-remarks="${escapeHtml(c.id)}">Save</button>
            <button type="button" class="btn btn--ghost btn--sm" data-acct-cancel-remarks>Cancel</button>
          </div>
        </div>`;
    }
    return `
      <div class="acct-remarks-cell">
        <span class="acct-remarks-text">${remarks ? escapeHtml(remarks) : "—"}</span>
        <button type="button" class="btn btn--ghost btn--sm" data-acct-edit-remarks="${escapeHtml(c.id)}">${remarks ? "Edit" : "Add"}</button>
      </div>`;
  }

  function feesPanelHtml(fees) {
    if (feeFilter === "manual") feeFilter = "pending";
    const rows = filteredFeeContacts();
    return `
      <div class="acct-fees">
        <div class="acct-fees__head">
          <div>
            <h3 class="acct-card__title">Alumni registration fees</h3>
            <p class="form-hint" style="margin:0;">Configured fee: <strong>${formatINR(fees.feeAmount)}</strong>${
              fees.feeNote ? ` · ${escapeHtml(fees.feeNote)}` : ""
            }. Mark when payment is received, or add a new fee entry.</p>
          </div>
          <div class="acct-fees__stats">
            <span><strong>${formatINR(fees.receivedTotal)}</strong> received (${fees.paidCount})</span>
            <span><strong>${formatINR(fees.pendingTotal)}</strong> pending (${fees.pendingCount})</span>
            <button type="button" class="btn btn--primary btn--sm" data-acct-tab="fee-add">+ Add fee entry</button>
          </div>
        </div>
        <div class="acct-fees__filters">
          <div class="acct-fees__chips" role="group" aria-label="Fee filter">
            <button type="button" class="acct-chip ${feeFilter === "pending" ? "acct-chip--active" : ""}" data-acct-fee-filter="pending">Pending</button>
            <button type="button" class="acct-chip ${feeFilter === "paid" ? "acct-chip--active" : ""}" data-acct-fee-filter="paid">Received</button>
            <button type="button" class="acct-chip ${feeFilter === "due" ? "acct-chip--active" : ""}" data-acct-fee-filter="due">Pending + received</button>
            <button type="button" class="acct-chip ${feeFilter === "all" ? "acct-chip--active" : ""}" data-acct-fee-filter="all">All contacts</button>
          </div>
          <input type="search" id="acctFeeSearch" class="acct-fees__search" placeholder="Search name, phone, dept…" value="${escapeHtml(feeSearch)}">
        </div>
        ${
          rows.length
            ? `<div class="table-scroll">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Alumni</th>
                      <th>Department</th>
                      <th>Status</th>
                      <th>Fee</th>
                      <th>Remarks</th>
                      <th>Received?</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows
                      .map((c) => {
                        const paid = c.registrationStatus === "paid";
                        const amount = contactFeeAmount(c, feeSettings);
                        return `
                      <tr>
                        <td>
                          <strong>${escapeHtml(c.alumniName || "—")}</strong>
                          ${c.whatsapp || c.mobile ? `<br><small style="color:var(--slate-500)">${escapeHtml(c.whatsapp || c.mobile)}</small>` : ""}
                          ${c.batch ? `<br><small style="color:var(--slate-500)">Batch ${escapeHtml(c.batch)}</small>` : ""}
                        </td>
                        <td>${escapeHtml(c.department || "—")}</td>
                        <td>${statusBadgeHtml("registration", c.registrationStatus || "not_registered")}</td>
                        <td>
                          ${formatINR(amount)}
                          ${paid && c.feeReceivedAt ? `<br><small style="color:var(--slate-500)">${escapeHtml(formatDateShort(c.feeReceivedAt) || c.feeReceivedAt)}${c.feePaymentMode ? ` · ${escapeHtml(paymentModeLabel(c.feePaymentMode))}` : ""}</small>` : ""}
                        </td>
                        <td>${remarksCellHtml(c)}</td>
                        <td>
                          <label class="acct-paid-toggle">
                            <input type="checkbox" data-acct-toggle-fee="${escapeHtml(c.id)}" ${paid ? "checked" : ""}>
                            <span class="badge badge--status badge--status-${paid ? "green" : "orange"}">${paid ? "Received" : "Not received"}</span>
                          </label>
                        </td>
                      </tr>`;
                      })
                      .join("")}
                  </tbody>
                </table>
              </div>`
            : `<p class="empty-state">${
                feeFilter === "pending"
                  ? "No alumni with payment pending."
                  : feeFilter === "paid"
                    ? "No fees marked received yet."
                    : "No matching alumni contacts."
              }</p>`
        }
      </div>`;
  }

  function feeEntryFormHtml(prefill = {}) {
    const defaultAmount =
      prefill.feeAmount != null
        ? String(prefill.feeAmount)
        : String(Number(feeSettings?.feeAmount) || "");
    const received = prefill.registrationStatus
      ? prefill.registrationStatus === "paid"
      : prefill.feeReceived !== false;

    return `
      <form id="acctFeeEntryForm" class="acct-form">
        <h3 class="acct-card__title">Add registration fee entry</h3>
        <p class="form-hint">Add an alumni registration fee that isn’t already in the list.</p>
        <div class="form-row">
          <div class="form-group" style="flex:2;">
            <label for="acctFeeName">Alumni name <span class="required">*</span></label>
            <input type="text" id="acctFeeName" required placeholder="Full name" value="${escapeHtml(prefill.alumniName || "")}">
          </div>
          <div class="form-group">
            <label for="acctFeeDept">Department <span class="required">*</span></label>
            <select id="acctFeeDept" required>
              <option value="">Select department</option>
              ${optionsHtml(DEPARTMENTS, prefill.department || "")}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="acctFeePhone">WhatsApp / mobile <span class="required">*</span></label>
            <input type="tel" id="acctFeePhone" required placeholder="Phone number" value="${escapeHtml(prefill.whatsapp || prefill.mobile || "")}">
          </div>
          <div class="form-group">
            <label for="acctFeeBatch">Batch / year</label>
            <input type="text" id="acctFeeBatch" placeholder="e.g. 2018" value="${escapeHtml(prefill.batch || "")}">
          </div>
          <div class="form-group">
            <label for="acctFeeEmail">Email</label>
            <input type="email" id="acctFeeEmail" placeholder="Optional" value="${escapeHtml(prefill.email || "")}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="acctFeeAmount">Fee amount (₹) <span class="required">*</span></label>
            <input type="number" id="acctFeeAmount" required min="0" step="1" placeholder="${escapeHtml(String(Number(feeSettings?.feeAmount) || "0"))}" value="${escapeHtml(defaultAmount)}">
          </div>
          <div class="form-group">
            <label for="acctFeeMode">Payment mode</label>
            <select id="acctFeeMode">${optionsHtml(PAYMENT_MODES, prefill.feePaymentMode || "cash")}</select>
          </div>
          <div class="form-group">
            <label for="acctFeeDate">Fee date</label>
            <input type="date" id="acctFeeDate" value="${escapeHtml(prefill.feeReceivedAt || todayISO())}">
          </div>
        </div>
        <div class="form-group">
          <label class="checkbox-label" for="acctFeeReceived">
            <input type="checkbox" id="acctFeeReceived" ${received ? "checked" : ""}>
            Fee already received
          </label>
          <p class="form-hint" style="margin-top:0.35rem;">Untick to save as payment pending.</p>
        </div>
        <div class="form-group">
          <label for="acctFeeNotes">Remarks</label>
          <textarea id="acctFeeNotes" rows="2" placeholder="e.g. Paid at registration desk / UPI ref">${escapeHtml(prefill.feeRemarks || prefill.notes || "")}</textarea>
        </div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
          <button type="submit" class="btn btn--primary">Save fee entry</button>
          <button type="button" class="btn btn--ghost" data-acct-tab="fees">Cancel</button>
        </div>
      </form>`;
  }

  function expenseFormHtml(prefill = {}) {
    const isOther =
      prefill.paidByUserId === "__other__" ||
      (!!prefill.paidBy &&
        !prefill.paidByUserId &&
        !coordinators.find((c) => c.displayName === prefill.paidBy));
    const selectedId = isOther ? "__other__" : prefill.paidByUserId || "";
    const selectedCoord = !isOther
      ? coordinators.find((c) => c.userId === selectedId) ||
        coordinators.find((c) => c.displayName === prefill.paidBy)
      : null;
    const deptValue = selectedCoord?.department || prefill.department || "";
    const otherName = isOther ? prefill.paidBy || "" : "";
    const reimbursed = !!prefill.reimbursed;

    const coordinatorOpts =
      '<option value="">Select coordinator</option>' +
      coordinators
        .map((c) => {
          const dept = c.department ? ` (${c.department})` : "";
          return `<option value="${escapeHtml(c.userId)}" data-department="${escapeHtml(c.department || "")}" data-name="${escapeHtml(c.displayName)}" ${
            selectedCoord?.userId === c.userId ? "selected" : ""
          }>${escapeHtml(c.displayName)}${escapeHtml(dept)}</option>`;
        })
        .join("") +
      `<option value="__other__" data-department="" data-name="" ${isOther ? "selected" : ""}>Other</option>`;

    return `
      <form id="acctExpenseForm" class="acct-form">
        <h3 class="acct-card__title">Add an expense</h3>
        <p class="form-hint">Record money spent for ${escapeHtml(MEETUP_NAME || "LEGECI")}, and whether it was paid back to that person.</p>
        <div class="form-row">
          <div class="form-group" style="flex:2;">
            <label for="acctExpTitle">What was spent? <span class="required">*</span></label>
            <input type="text" id="acctExpTitle" required placeholder="e.g. Stage backdrop printing" value="${escapeHtml(prefill.title || "")}">
          </div>
          <div class="form-group">
            <label for="acctExpAmount">Amount (₹) <span class="required">*</span></label>
            <input type="number" id="acctExpAmount" required min="1" step="1" placeholder="5000" value="${escapeHtml(prefill.amount != null ? String(prefill.amount) : "")}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="acctExpCategory">Category</label>
            <select id="acctExpCategory">${optionsHtml(EXPENSE_CATEGORIES, prefill.category || "misc")}</select>
          </div>
          <div class="form-group">
            <label for="acctExpDate">Date</label>
            <input type="date" id="acctExpDate" value="${escapeHtml(prefill.date || todayISO())}">
          </div>
          <div class="form-group">
            <label for="acctExpMode">Paid via</label>
            <select id="acctExpMode">${optionsHtml(PAYMENT_MODES, prefill.paymentMode || "cash")}</select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="acctExpPaidBy">Spent by <span class="required">*</span></label>
            <select id="acctExpPaidBy" required>${coordinatorOpts}</select>
            <p class="form-hint" style="margin-top:0.35rem;">Pick a coordinator, or choose Other to type a name.</p>
          </div>
          <div class="form-group" id="acctExpOtherNameWrap" ${isOther ? "" : "hidden"}>
            <label for="acctExpOtherName">Name <span class="required">*</span></label>
            <input type="text" id="acctExpOtherName" placeholder="Enter name" value="${escapeHtml(otherName)}" ${isOther ? "required" : ""}>
          </div>
          <div class="form-group">
            <label for="acctExpDept">Department</label>
            <select id="acctExpDept" ${isOther ? "" : "disabled"}>
              <option value="">—</option>
              ${optionsHtml(DEPARTMENTS, deptValue)}
            </select>
          </div>
          <div class="form-group">
            <label for="acctExpBill">Bill / voucher no.</label>
            <input type="text" id="acctExpBill" placeholder="Optional" value="${escapeHtml(prefill.billRef || "")}">
          </div>
        </div>
        <div class="form-group">
          <label class="checkbox-label" for="acctExpReimbursed">
            <input type="checkbox" id="acctExpReimbursed" ${reimbursed ? "checked" : ""}>
            Amount paid to this person (reimbursed)
          </label>
          <p class="form-hint" style="margin-top:0.35rem;">Tick if the spender has already been paid back for this expense.</p>
        </div>
        <div class="form-group">
          <label for="acctExpNotes">Notes</label>
          <textarea id="acctExpNotes" rows="2" placeholder="Any extra detail">${escapeHtml(prefill.notes || "")}</textarea>
        </div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
          <button type="submit" class="btn btn--primary">Save expense</button>
          <button type="button" class="btn btn--ghost" data-acct-tab="overview">Cancel</button>
        </div>
      </form>`;
  }

  function expensesListHtml(enriched) {
    if (!enriched.length) {
      return '<p class="empty-state">No expenses yet. <button type="button" class="btn btn--primary btn--sm" data-acct-tab="expense">Add first expense</button></p>';
    }
    return `
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Expense</th>
              <th>Category</th>
              <th>Spent by</th>
              <th>Amount</th>
              <th>Paid to person?</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${enriched
              .map((e) => {
                const meta = expenseStatusMeta(e);
                return `
              <tr>
                <td>${escapeHtml(formatDateShort(e.date) || "—")}</td>
                <td>
                  <strong>${escapeHtml(e.title)}</strong>
                  ${e.billRef ? `<br><small style="color:var(--slate-500)">Bill: ${escapeHtml(e.billRef)}</small>` : ""}
                  ${e.department ? `<br><small style="color:var(--slate-500)">${escapeHtml(e.department)}</small>` : ""}
                </td>
                <td>${escapeHtml(categoryLabel(e.category))}</td>
                <td>${escapeHtml(e.paidBy || "—")}</td>
                <td>${formatINR(e.amount)}</td>
                <td>
                  <label class="acct-paid-toggle">
                    <input type="checkbox" data-acct-toggle-paid="${escapeHtml(e.id)}" ${e.reimbursed ? "checked" : ""}>
                    <span class="badge badge--status badge--status-${meta.tone}">${meta.label}</span>
                  </label>
                </td>
                <td class="table-actions">
                  <button type="button" class="btn btn--ghost btn--sm" data-acct-del-exp="${escapeHtml(e.id)}">Remove</button>
                </td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`;
  }

  if (!bound) {
    wrap.dataset.accountsBound = "1";
    bound = true;

    wrap.addEventListener("click", async (e) => {
      const tabBtn = e.target.closest("[data-acct-tab]");
      if (tabBtn) {
        tab = tabBtn.dataset.acctTab;
        editingRemarksId = "";
        render();
        return;
      }

      const feeFilterBtn = e.target.closest("[data-acct-fee-filter]");
      if (feeFilterBtn) {
        feeFilter = feeFilterBtn.dataset.acctFeeFilter || "pending";
        editingRemarksId = "";
        render();
        return;
      }

      const editRemarks = e.target.closest("[data-acct-edit-remarks]");
      if (editRemarks) {
        editingRemarksId = editRemarks.dataset.acctEditRemarks || "";
        render();
        const input = document.getElementById("acctRemarksInput");
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
        return;
      }

      if (e.target.closest("[data-acct-cancel-remarks]")) {
        editingRemarksId = "";
        render();
        return;
      }

      const saveRemarks = e.target.closest("[data-acct-save-remarks]");
      if (saveRemarks) {
        const id = saveRemarks.dataset.acctSaveRemarks;
        const contact = contacts.find((c) => c.id === id);
        const value = document.getElementById("acctRemarksInput")?.value || "";
        if (!contact) return;
        try {
          saveRemarks.disabled = true;
          const feeRemarks = await saveFeeRemarks(id, value);
          contact.feeRemarks = feeRemarks;
          editingRemarksId = "";
          showToast(toast, "Remarks saved.", "success");
          render();
        } catch (err) {
          console.error(err);
          showToast(
            toast,
            err.code === "permission-denied"
              ? "Permission denied. Republish firestore.rules in Firebase Console."
              : "Could not save remarks.",
            "error"
          );
        } finally {
          saveRemarks.disabled = false;
        }
        return;
      }

      const markFee = e.target.closest("[data-acct-mark-fee]");
      if (markFee) {
        const contact = contacts.find((c) => c.id === markFee.dataset.acctMarkFee);
        if (!contact) return;
        try {
          const payload = await setAlumniFeeReceived(contact, true, feeSettings, session);
          Object.assign(contact, payload);
          showToast(toast, "Registration fee marked received.", "success");
          render();
        } catch (err) {
          console.error(err);
          showToast(
            toast,
            err.code === "permission-denied"
              ? "Permission denied. Republish firestore.rules in Firebase Console."
              : "Could not mark fee received.",
            "error"
          );
        }
        return;
      }

      const markPaid = e.target.closest("[data-acct-mark-paid]");
      if (markPaid) {
        try {
          await setExpenseReimbursed(markPaid.dataset.acctMarkPaid, true);
          showToast(toast, "Marked as paid to person.", "success");
          await refresh();
        } catch (err) {
          console.error(err);
          showToast(toast, "Could not update payment status.", "error");
        }
        return;
      }

      const delExp = e.target.closest("[data-acct-del-exp]");
      if (delExp) {
        if (!confirm("Remove this expense?")) return;
        try {
          await softDeleteExpense(delExp.dataset.acctDelExp);
          showToast(toast, "Expense removed.", "success");
          await refresh();
        } catch (err) {
          console.error(err);
          showToast(toast, "Could not remove expense.", "error");
        }
      }
    });

    wrap.addEventListener("input", (e) => {
      if (e.target.id !== "acctFeeSearch") return;
      feeSearch = e.target.value || "";
      // Re-render only the fees panel content would be nicer; full render is fine and simple.
      const active = document.activeElement === e.target;
      const pos = e.target.selectionStart;
      render();
      if (active) {
        const input = document.getElementById("acctFeeSearch");
        if (input) {
          input.focus();
          try {
            input.setSelectionRange(pos, pos);
          } catch {
            /* ignore */
          }
        }
      }
    });

    wrap.addEventListener("change", async (e) => {
      if (e.target.id === "acctExpPaidBy") {
        const opt = e.target.selectedOptions?.[0];
        const isOther = e.target.value === "__other__";
        const otherWrap = document.getElementById("acctExpOtherNameWrap");
        const otherInput = document.getElementById("acctExpOtherName");
        const dept = document.getElementById("acctExpDept");
        if (otherWrap) otherWrap.hidden = !isOther;
        if (otherInput) {
          otherInput.required = isOther;
          if (!isOther) otherInput.value = "";
        }
        if (dept) {
          dept.disabled = !isOther;
          dept.value = isOther ? dept.value || "" : opt?.dataset?.department || "";
        }
        return;
      }

      const toggleFee = e.target.closest("[data-acct-toggle-fee]");
      if (toggleFee) {
        const id = toggleFee.dataset.acctToggleFee;
        const contact = contacts.find((c) => c.id === id);
        const received = toggleFee.checked;
        if (!contact) return;
        try {
          toggleFee.disabled = true;
          const payload = await setAlumniFeeReceived(contact, received, feeSettings, session);
          Object.assign(contact, payload);
          showToast(
            toast,
            received ? "Registration fee marked received." : "Marked as payment pending.",
            "success"
          );
          render();
        } catch (err) {
          console.error(err);
          toggleFee.checked = !received;
          showToast(
            toast,
            err.code === "permission-denied"
              ? "Permission denied. Republish firestore.rules in Firebase Console."
              : "Could not update fee status.",
            "error"
          );
        } finally {
          toggleFee.disabled = false;
        }
        return;
      }

      const toggle = e.target.closest("[data-acct-toggle-paid]");
      if (toggle) {
        const id = toggle.dataset.acctTogglePaid;
        const paid = toggle.checked;
        try {
          toggle.disabled = true;
          await setExpenseReimbursed(id, paid);
          showToast(
            toast,
            paid ? "Marked as paid to person." : "Marked as not paid yet.",
            "success"
          );
          await refresh();
        } catch (err) {
          console.error(err);
          toggle.checked = !paid;
          showToast(toast, "Could not update payment status.", "error");
        } finally {
          toggle.disabled = false;
        }
      }
    });

    wrap.addEventListener("submit", async (e) => {
      if (e.target.id === "acctFeeEntryForm") {
        e.preventDefault();
        const alumniName = document.getElementById("acctFeeName")?.value.trim();
        const department = document.getElementById("acctFeeDept")?.value || "";
        const phone = document.getElementById("acctFeePhone")?.value.trim();
        const feeAmount = Number(document.getElementById("acctFeeAmount")?.value);
        const feeReceived = !!document.getElementById("acctFeeReceived")?.checked;

        if (!alumniName) {
          showToast(toast, "Alumni name is required.", "error");
          return;
        }
        if (!department) {
          showToast(toast, "Select a department.", "error");
          return;
        }
        if (!phone) {
          showToast(toast, "WhatsApp / mobile is required.", "error");
          return;
        }
        if (!Number.isFinite(feeAmount) || feeAmount < 0) {
          showToast(toast, "Enter a valid fee amount.", "error");
          return;
        }

        const btn = e.target.querySelector('[type="submit"]');
        try {
          if (btn) btn.disabled = true;
          await saveManualRegistrationFee(
            {
              alumniName,
              department,
              whatsapp: phone,
              mobile: phone,
              batch: document.getElementById("acctFeeBatch")?.value,
              email: document.getElementById("acctFeeEmail")?.value,
              feeAmount,
              feePaymentMode: document.getElementById("acctFeeMode")?.value,
              feeReceivedAt: document.getElementById("acctFeeDate")?.value,
              feeReceived,
              feeRemarks: document.getElementById("acctFeeNotes")?.value,
              notes: document.getElementById("acctFeeNotes")?.value,
            },
            feeSettings,
            session
          );
          showToast(toast, "Registration fee entry saved.", "success");
          feeFilter = feeReceived ? "paid" : "pending";
          tab = "fees";
          await refresh();
        } catch (err) {
          console.error(err);
          showToast(
            toast,
            err.code === "permission-denied"
              ? "Permission denied. Republish firestore.rules in Firebase Console."
              : "Could not save fee entry.",
            "error"
          );
        } finally {
          if (btn) btn.disabled = false;
        }
        return;
      }

      if (e.target.id !== "acctExpenseForm") return;
      e.preventDefault();
      const title = document.getElementById("acctExpTitle")?.value.trim();
      const amount = Number(document.getElementById("acctExpAmount")?.value);
      const paidBySelect = document.getElementById("acctExpPaidBy");
      const paidByOpt = paidBySelect?.selectedOptions?.[0];
      const paidByValue = paidBySelect?.value || "";
      const isOther = paidByValue === "__other__";
      const paidByUserId = isOther ? "" : paidByValue;
      const paidBy = isOther
        ? (document.getElementById("acctExpOtherName")?.value || "").trim()
        : (paidByOpt?.dataset?.name || "").trim();
      const department = isOther
        ? document.getElementById("acctExpDept")?.value || ""
        : paidByOpt?.dataset?.department || document.getElementById("acctExpDept")?.value || "";
      const reimbursed = !!document.getElementById("acctExpReimbursed")?.checked;

      if (!title || !amount || amount <= 0) {
        showToast(toast, "Title and amount are required.", "error");
        return;
      }
      if (!paidByValue) {
        showToast(toast, "Select who spent, or choose Other.", "error");
        return;
      }
      if (!paidBy) {
        showToast(toast, isOther ? "Enter the name for Other." : "Spent by is required.", "error");
        return;
      }

      const btn = e.target.querySelector('[type="submit"]');
      try {
        if (btn) btn.disabled = true;
        await saveExpense({
          title,
          amount,
          paidBy,
          paidByUserId,
          category: document.getElementById("acctExpCategory")?.value,
          date: document.getElementById("acctExpDate")?.value,
          paymentMode: document.getElementById("acctExpMode")?.value,
          department,
          billRef: document.getElementById("acctExpBill")?.value,
          notes: document.getElementById("acctExpNotes")?.value,
          reimbursed,
        });
        showToast(toast, "Expense saved.", "success");
        tab = "expenses";
        await refresh();
      } catch (err) {
        console.error(err);
        showToast(toast, "Could not save expense.", "error");
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  await refresh();
}
