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
} from "./constants.js";

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
  let tab = "overview";
  let bound = wrap.dataset.accountsBound === "1";

  async function refresh() {
    wrap.innerHTML = '<p class="empty-state">Loading finance…</p>';
    try {
      [expenses, coordinators] = await Promise.all([loadExpenses(), loadCoordinators()]);
      render();
    } catch (err) {
      console.error(err);
      wrap.innerHTML = '<p class="empty-state">Failed to load finance. Check Firestore rules.</p>';
    }
  }

  function render() {
    const summary = summarizeAccounts(expenses);
    wrap.innerHTML = `
      <div class="acct">
        <div class="acct-hero">
          <div>
            <p class="acct-hero__eyebrow">${escapeHtml(MEETUP_NAME || "LEGECI")} Finance</p>
            <h2 class="acct-hero__title">Money at a glance</h2>
            <p class="acct-hero__sub">Log expenses and mark whether the amount has been paid back to the person who spent.</p>
          </div>
          <div class="acct-hero__actions">
            <button type="button" class="btn btn--primary btn--sm" data-acct-tab="expense">+ Add expense</button>
          </div>
        </div>

        <div class="acct-stat-grid">
          <div class="acct-stat"><div class="acct-stat__value">${formatINR(summary.totalExpenses)}</div><div class="acct-stat__label">Total expenses</div></div>
          <div class="acct-stat acct-stat--good"><div class="acct-stat__value">${formatINR(summary.totalPaid)}</div><div class="acct-stat__label">Paid to person</div></div>
          <div class="acct-stat acct-stat--warn"><div class="acct-stat__value">${formatINR(summary.totalOutstanding)}</div><div class="acct-stat__label">Not paid yet</div></div>
          <div class="acct-stat"><div class="acct-stat__value">${summary.pendingCount}</div><div class="acct-stat__label">Awaiting payment</div></div>
        </div>

        <div class="acct-tabs" role="tablist">
          <button type="button" class="acct-tab ${tab === "overview" ? "acct-tab--active" : ""}" data-acct-tab="overview">Overview</button>
          <button type="button" class="acct-tab ${tab === "expenses" ? "acct-tab--active" : ""}" data-acct-tab="expenses">All expenses</button>
          <button type="button" class="acct-tab ${tab === "expense" ? "acct-tab--active" : ""}" data-acct-tab="expense">Add expense</button>
        </div>

        <div class="acct-panel">
          ${tab === "expense" ? expenseFormHtml() : tab === "expenses" ? expensesListHtml(summary.enriched) : overviewHtml(summary)}
        </div>
      </div>`;
  }

  function overviewHtml(summary) {
    const cats = Object.entries(summary.byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const open = summary.enriched.filter((e) => !e.reimbursed).slice(0, 6);

    return `
      <div class="acct-overview">
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
        render();
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
