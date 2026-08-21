import writeExcelFile from "https://cdn.jsdelivr.net/npm/write-excel-file@4.1.1/browser/+esm";
import {
  DEPARTMENTS,
  MEETUP_NAME,
  formatDateShort,
} from "./constants.js";
import {
  contactFeeUnitAmount,
  contactFeeLineTotal,
  contactMembersAttending,
  labelRegistration,
  isRegistrationDue,
} from "./alumni-connect.js";
import {
  categoryLabel,
  paymentModeLabel,
  summarizeAccounts,
  summarizeRegistrationFees,
  contactFeeRemarks,
} from "./legeci-accounts.js?v=fn2";

const HEADER_STYLE = {
  fontWeight: "bold",
  color: "#FFFFFF",
  backgroundColor: "#6B2D7B",
  align: "center",
};

function deptLabel(code) {
  return DEPARTMENTS.find((d) => d.value === code)?.label || code || "";
}

function fileDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function generatedAt() {
  return new Date().toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function headerRow(values) {
  return values.map((value) => ({ value, ...HEADER_STYLE }));
}

function money(n) {
  return {
    value: Number(n) || 0,
    type: Number,
    format: "#,##0",
    align: "right",
  };
}

function integer(n) {
  return { value: Number(n) || 0, type: Number, align: "right" };
}

function text(value) {
  return value == null || value === "" ? "" : String(value);
}

function feeStatusLabel(contact) {
  const status = contact?.registrationStatus || "not_registered";
  if (status === "paid") return "Received";
  if (status === "pending_payment") return "Pending";
  return labelRegistration(status);
}

function feeSourceLabel(contact) {
  if (contact?.source === "manual_fee") return "Manual entry";
  return "Alumni Connect";
}

function feeRow(contact, feeSettings) {
  const members = contactMembersAttending(contact);
  const unit = contactFeeUnitAmount(contact, feeSettings);
  const due = isRegistrationDue(contact.registrationStatus);
  const total = due ? contactFeeLineTotal(contact, feeSettings) : 0;
  const paid = contact.registrationStatus === "paid";
  return [
    text(contact.alumniName),
    text(contact.whatsapp || contact.mobile),
    text(contact.email),
    text(deptLabel(contact.department) || contact.department),
    text(contact.batch),
    text(feeStatusLabel(contact)),
    integer(members),
    money(unit),
    money(total),
    text(paid ? paymentModeLabel(contact.feePaymentMode) : ""),
    text(paid ? formatDateShort(contact.feeReceivedAt) || contact.feeReceivedAt || "" : ""),
    text(paid ? contact.feeReceivedBy || "" : ""),
    text(contactFeeRemarks(contact)),
    text(feeSourceLabel(contact)),
  ];
}

const FEE_HEADERS = [
  "Alumni",
  "Phone",
  "Email",
  "Department",
  "Batch",
  "Status",
  "Members",
  "Fee per person (INR)",
  "Fee total (INR)",
  "Payment mode",
  "Received date",
  "Received by",
  "Remarks",
  "Source",
];

const FEE_WIDTHS = [28, 14, 28, 28, 10, 18, 10, 18, 16, 14, 14, 18, 32, 16];

function expenseRow(expense) {
  const paid = !!expense.reimbursed;
  return [
    text(formatDateShort(expense.date) || expense.date || ""),
    text(expense.title),
    text(categoryLabel(expense.category)),
    money(expense.amount),
    text(expense.paidBy),
    text(deptLabel(expense.department) || expense.department),
    text(paymentModeLabel(expense.paymentMode)),
    text(expense.billRef),
    text(paid ? "Paid to person" : "Not paid yet"),
    text(paid ? formatDateShort(expense.reimbursedAt) || expense.reimbursedAt || "" : ""),
    text(expense.notes),
  ];
}

const EXPENSE_HEADERS = [
  "Date",
  "Expense",
  "Category",
  "Amount (INR)",
  "Spent by",
  "Department",
  "Paid via",
  "Bill / voucher",
  "Paid to person?",
  "Paid date",
  "Notes",
];

const EXPENSE_WIDTHS = [14, 36, 22, 14, 22, 28, 14, 16, 16, 14, 32];

function tableSheet(name, headers, widths, rows) {
  const data = [headerRow(headers)];
  if (rows.length) data.push(...rows);
  else data.push([text("No records")]);
  return {
    sheet: name,
    columns: widths.map((width) => ({ width })),
    data,
  };
}

function summarySheet({ fees, accounts, feeSettings, generatedBy, listNote }) {
  const net = (fees.receivedTotal || 0) - (accounts.totalExpenses || 0);
  const title = `${MEETUP_NAME || "LEGECI"} finance report`;
  const rows = [
    [{ value: title, fontWeight: "bold", fontSize: 16, color: "#3d1454" }],
    [text(`Generated ${generatedAt()}${generatedBy ? ` · ${generatedBy}` : ""}`)],
    [text(`Fee rate: ₹${Number(fees.feeAmount) || 0} per person${fees.feeNote ? ` · ${fees.feeNote}` : ""}`)],
  ];
  if (listNote) rows.push([text(listNote)]);
  rows.push(
    [],
    headerRow(["Item", "Amount (INR)", "Entries", "People"]),
    [text("Fees received"), money(fees.receivedTotal), integer(fees.paidCount), integer(fees.paidMembers)],
    [text("Fees pending"), money(fees.pendingTotal), integer(fees.pendingCount), integer(fees.pendingMembers)],
    [text("Fees expected (received + pending)"), money(fees.expectedTotal), integer(fees.paidCount + fees.pendingCount), integer((fees.paidMembers || 0) + (fees.pendingMembers || 0))],
    [],
    [text("Total expenses"), money(accounts.totalExpenses), integer(accounts.expenseCount), ""],
    [text("Paid to person"), money(accounts.totalPaid), integer((accounts.enriched || []).filter((e) => e.reimbursed).length), ""],
    [text("Not paid to person"), money(accounts.totalOutstanding), integer(accounts.pendingCount), ""],
    [],
    [{ value: "Net (fees received − expenses)", fontWeight: "bold" }, money(net), "", ""]
  );
  return {
    sheet: "Summary",
    columns: [{ width: 42 }, { width: 16 }, { width: 12 }, { width: 12 }],
    data: rows,
  };
}

function feesByDepartmentSheet(contacts, feeSettings) {
  const map = new Map();
  (contacts || []).forEach((c) => {
    if (!isRegistrationDue(c.registrationStatus)) return;
    const code = c.department || "—";
    if (!map.has(code)) {
      map.set(code, {
        code,
        receivedAmount: 0,
        receivedEntries: 0,
        receivedPeople: 0,
        pendingAmount: 0,
        pendingEntries: 0,
        pendingPeople: 0,
      });
    }
    const row = map.get(code);
    const amount = contactFeeLineTotal(c, feeSettings);
    const people = contactMembersAttending(c);
    if (c.registrationStatus === "paid") {
      row.receivedAmount += amount;
      row.receivedEntries += 1;
      row.receivedPeople += people;
    } else {
      row.pendingAmount += amount;
      row.pendingEntries += 1;
      row.pendingPeople += people;
    }
  });
  const rows = [...map.values()]
    .sort((a, b) => (b.receivedAmount + b.pendingAmount) - (a.receivedAmount + a.pendingAmount))
    .map((r) => [
      text(deptLabel(r.code) || r.code),
      money(r.receivedAmount),
      integer(r.receivedEntries),
      integer(r.receivedPeople),
      money(r.pendingAmount),
      integer(r.pendingEntries),
      integer(r.pendingPeople),
      money(r.receivedAmount + r.pendingAmount),
    ]);
  return tableSheet(
    "Fees by department",
    [
      "Department",
      "Received (INR)",
      "Received entries",
      "Received people",
      "Pending (INR)",
      "Pending entries",
      "Pending people",
      "Total (INR)",
    ],
    [28, 16, 16, 16, 16, 16, 16, 14],
    rows
  );
}

function expensesByCategorySheet(expenses) {
  const map = new Map();
  (expenses || []).forEach((e) => {
    const key = e.category || "misc";
    if (!map.has(key)) {
      map.set(key, { paid: 0, unpaid: 0, count: 0 });
    }
    const row = map.get(key);
    const amount = Number(e.amount) || 0;
    row.count += 1;
    if (e.reimbursed) row.paid += amount;
    else row.unpaid += amount;
  });
  const rows = [...map.entries()]
    .sort((a, b) => b[1].paid + b[1].unpaid - (a[1].paid + a[1].unpaid))
    .map(([key, r]) => [
      text(categoryLabel(key)),
      integer(r.count),
      money(r.paid),
      money(r.unpaid),
      money(r.paid + r.unpaid),
    ]);
  return tableSheet(
    "Expenses by category",
    ["Category", "Entries", "Paid to person (INR)", "Not paid (INR)", "Total (INR)"],
    [28, 12, 22, 16, 14],
    rows
  );
}

function feeFilterLabel(feeFilter) {
  if (feeFilter === "paid") return "Received";
  if (feeFilter === "pending") return "Pending";
  if (feeFilter === "due") return "Pending + received";
  if (feeFilter === "all") return "All contacts";
  return "Current list";
}

/**
 * @param {{
 *   kind?: "full" | "fees-view" | "expenses",
 *   contacts?: object[],
 *   expenses?: object[],
 *   feeSettings?: object,
 *   feeRows?: object[],
 *   feeFilter?: string,
 *   generatedBy?: string,
 * }} opts
 */
export async function downloadFinanceExcel(opts = {}) {
  const kind = opts.kind || "full";
  const contacts = opts.contacts || [];
  const expenses = opts.expenses || [];
  const feeSettings = opts.feeSettings || {};
  const fees = summarizeRegistrationFees(contacts, feeSettings);
  const accounts = summarizeAccounts(expenses);
  const generatedBy = opts.generatedBy || "";

  const received = contacts.filter((c) => c.registrationStatus === "paid");
  const pending = contacts.filter((c) => c.registrationStatus === "pending_payment");
  const unpaidExpenses = (accounts.enriched || []).filter((e) => !e.reimbursed);

  const sheets = [];

  if (kind === "fees-view") {
    const rows = opts.feeRows || [];
    const label = feeFilterLabel(opts.feeFilter);
    const total = rows.reduce((s, c) => s + contactFeeLineTotal(c, feeSettings), 0);
    const people = rows.reduce((s, c) => s + contactMembersAttending(c), 0);
    sheets.push(
      summarySheet({
        fees,
        accounts,
        feeSettings,
        generatedBy,
        listNote: `This file is the current Registration fees view: ${label} (${rows.length} rows, ${people} people, ₹${total.toLocaleString("en-IN")}).`,
      })
    );
    sheets.push(tableSheet(label.slice(0, 31), FEE_HEADERS, FEE_WIDTHS, rows.map((c) => feeRow(c, feeSettings))));
    await writeExcelFile(sheets).toFile(`LEGECI-fees-${fileDate()}.xlsx`);
    return;
  }

  if (kind === "expenses") {
    sheets.push(
      summarySheet({
        fees,
        accounts,
        feeSettings,
        generatedBy,
        listNote: "This file is the expenses report (fees totals are included on Summary for context).",
      })
    );
    sheets.push(tableSheet("Expenses", EXPENSE_HEADERS, EXPENSE_WIDTHS, (accounts.enriched || []).map(expenseRow)));
    sheets.push(tableSheet("Not paid to person", EXPENSE_HEADERS, EXPENSE_WIDTHS, unpaidExpenses.map(expenseRow)));
    sheets.push(expensesByCategorySheet(accounts.enriched));
    await writeExcelFile(sheets).toFile(`LEGECI-expenses-${fileDate()}.xlsx`);
    return;
  }

  sheets.push(summarySheet({ fees, accounts, feeSettings, generatedBy }));
  sheets.push(tableSheet("Fees received", FEE_HEADERS, FEE_WIDTHS, received.map((c) => feeRow(c, feeSettings))));
  sheets.push(tableSheet("Fees pending", FEE_HEADERS, FEE_WIDTHS, pending.map((c) => feeRow(c, feeSettings))));
  sheets.push(feesByDepartmentSheet(contacts, feeSettings));
  sheets.push(tableSheet("Expenses", EXPENSE_HEADERS, EXPENSE_WIDTHS, (accounts.enriched || []).map(expenseRow)));
  sheets.push(tableSheet("Not paid to person", EXPENSE_HEADERS, EXPENSE_WIDTHS, unpaidExpenses.map(expenseRow)));
  sheets.push(expensesByCategorySheet(accounts.enriched));

  await writeExcelFile(sheets).toFile(`LEGECI-finance-${fileDate()}.xlsx`);
}
