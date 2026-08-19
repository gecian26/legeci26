import { db } from "../js/firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  addDoc,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { hashPassword } from "../js/crypto.js";
import { initAuthGuard, logout, withSession, requireAuth } from "../js/auth.js";
import {
  ROLES,
  ROLE_LABELS,
  DEPARTMENTS,
  DEFAULT_MEETUP,
  USERS_COLLECTION,
  REGISTRY_DOC,
  MAIN_TASKS_COLLECTION,
  DEPT_TASKS_COLLECTION,
  TASK_TYPES,
  TASK_TYPE_LABELS,
  normalizeUsername,
  formatDateShort,
  escapeHtml,
  showToast,
} from "../js/constants.js?v=th1";
import {
  setupPasswordPanel,
  passwordFormHtml,
  renderPasswordPrompt,
} from "../js/password.js";
import {
  renderMeetupOverview,
  renderPreEventsOverview,
} from "../js/dashboard-event.js";
import { loadTeams, teamLabel } from "../js/teams.js";
import {
  loadRegistrationSettings,
  formatFee,
  isAlumniConnectTask,
  alumniContactFormHtml,
  readAlumniContactForm,
  saveAlumniContact,
  updateAlumniContact,
  loadContactsByDepartment,
  loadContactsByVolunteer,
  loadAllAlumniContacts,
  contactsTableHtml,
  facultyContactsDetailHtml,
  duplicateSuggestionsHtml,
  findDuplicateGroups,
  setContactInvalidated,
  summarizeContacts,
  filterAlumniContacts,
  uniqueSortedValues,
  departmentBreakdown,
  statsCardsHtml,
  alumniFiltersHtml,
  readAlumniFilters,
  insightsHtml,
  departmentBreakdownTableHtml,
  statusSelectClass,
  statusBadgeHtml,
  wireMembersFeeHint,
  normalizeMembersAttending,
  contactMembersAttending,
  isRegistrationDue,
  membersFeeHintText,
  compactAlumniStatsHtml,
} from "../js/alumni-connect.js";
import { downloadAlumniContactsPdf } from "../js/alumni-contacts-pdf.js";
import { loadLeaderboardPanel } from "../js/leaderboard.js";
import { mountVolunteerCertificates, isCertificateBatchRecord } from "../js/volunteer-certificates.js?v=th1";
import {
  mountTreasurerAccounts,
  loadExpenses,
  summarizeAccounts,
  summarizeRegistrationFees,
  formatINR,
} from "../js/legeci-accounts.js";

const INSTITUTIONAL_ROLES = [
  ROLES.FACULTY,
  ROLES.STUDENT,
  ROLES.SECRETARY,
  ROLES.JOINT_SECRETARY,
  ROLES.PRINCIPAL,
  ROLES.DEAN,
  ROLES.TREASURER,
];

const LEADERSHIP_ROLES = [ROLES.PRINCIPAL, ROLES.DEAN];

const toast = document.getElementById("toast");
let currentSession = null;
let cachedTeams = [];
let cachedDeptVolunteers = [];
let cachedRegistration = null;
let selectedAlumniTaskId = null;
let cachedMyContacts = [];
let editingContact = null;
let cachedDeptAlumniContacts = [];
let facultyAlumniFilterBound = false;
let facultyExpandedContactId = "";
let facultyShowDuplicatesOnly = false;
let cachedLeadershipContacts = [];
let cachedLeadershipFilters = {};
let cachedLeadershipFiltered = [];
let cachedLeadershipFeeLabel = "Not set";
let leadershipAlumniFilterBound = false;

initAuthGuard(INSTITUTIONAL_ROLES, (session) => {
  initPortal(session);
});

function initPortal(session) {
  currentSession = session;
  const deptLabel = session.department
    ? DEPARTMENTS.find((d) => d.value === session.department)?.label
    : null;

  document.getElementById("sidebarRole").textContent = ROLE_LABELS[session.role] || "Coordinator";
  document.getElementById("userName").textContent = session.displayName || session.username;
  document.getElementById("welcomeName").textContent = session.displayName || session.username;
  document.getElementById("roleLabel").textContent = ROLE_LABELS[session.role] || session.role;
  document.getElementById("deptLabel").textContent = deptLabel
    ? ` · ${deptLabel}${session.team ? ` · ${session.team}` : ""}`
    : session.team
      ? ` · ${session.team}`
      : "";

  if (session.role === ROLES.FACULTY && session.department) {
    document.getElementById("navDept").hidden = false;
    document.getElementById("navAlumni").hidden = false;
    document.getElementById("navCertificates").hidden = false;
    document.getElementById("execAlumniOverviewCard").hidden = true;
    document.getElementById("deptNameLabel").textContent = session.department;
    document.getElementById("alumniPanelTitle").textContent = "Alumni Connect — Department Dashboard";
    document.getElementById("alumniPanelHint").textContent =
      "Summary and filtered details of alumni contacted by volunteers in your department.";
    setupDepartmentPanel(session);
  } else {
    document.getElementById("navDept").hidden = true;
  }

  if (LEADERSHIP_ROLES.includes(session.role)) {
    document.getElementById("navAlumni").hidden = false;
    document.getElementById("navLeaderboard").hidden = false;
    document.getElementById("execAlumniOverviewCard").hidden = false;
    document.getElementById("alumniPanelTitle").textContent = "Alumni Connect — Institution Overview";
    document.getElementById("alumniPanelHint").textContent =
      "Consolidated department-wise status and alumni contacted across the college.";
    setupLeadershipAlumni(session);
  } else if (session.role === ROLES.STUDENT && session.department) {
    document.getElementById("navAlumni").hidden = false;
    document.getElementById("navLeaderboard").hidden = false;
    document.getElementById("execAlumniOverviewCard").hidden = true;
    const deptName =
      DEPARTMENTS.find((d) => d.value === session.department)?.label || session.department;
    document.getElementById("alumniPanelTitle").textContent =
      `Alumni Contacted — ${deptName}`;
    document.getElementById("alumniPanelHint").textContent =
      "Quick department view — name, status, and who recorded each contact. Use My Tasks to add or update records.";
  } else if (session.role !== ROLES.FACULTY) {
    document.getElementById("navAlumni").hidden = true;
    document.getElementById("navLeaderboard").hidden = true;
    document.getElementById("execAlumniOverviewCard").hidden = true;
  } else {
    document.getElementById("navLeaderboard").hidden = true;
  }

  if (session.role === ROLES.STUDENT) {
    document.getElementById("navMyTasks").hidden = false;
    setupStudentTasks(session);
  } else {
    document.getElementById("navMyTasks").hidden = true;
  }

  if (session.role === ROLES.TREASURER || LEADERSHIP_ROLES.includes(session.role)) {
    const financeCard = document.getElementById("treasurerAccountsOverviewCard");
    const financeHint = document.getElementById("financeOverviewHint");
    const financeBtn = document.getElementById("treasurerGotoAccountsBtn");
    if (financeCard) financeCard.hidden = false;
    document.getElementById("navAccounts").hidden = false;
    if (financeBtn) financeBtn.hidden = false;
    if (session.role === ROLES.TREASURER) {
      if (financeHint) {
        financeHint.textContent =
          "Track registration fees from alumni and expenses paid to coordinators.";
      }
      if (financeBtn) financeBtn.textContent = "Open Finance";
    } else {
      if (financeHint) {
        financeHint.textContent =
          "Institution-wide snapshot of registration fees and LEGECI expenses. Open Finance for full details.";
      }
      if (financeBtn) financeBtn.textContent = "Open Finance";
    }
  } else {
    document.getElementById("navAccounts").hidden = true;
    const financeCard = document.getElementById("treasurerAccountsOverviewCard");
    if (financeCard) financeCard.hidden = true;
  }

  setupNavigation();
  setupAccount(session);
  loadDashboard();

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await logout();
    window.location.href = "../login.html";
  });
}

function setupNavigation() {
  const titles = {
    dashboard: "Dashboard",
    dept: "Department Work",
    alumni: "Alumni Connect",
    certificates: "Certificates",
    leaderboard: "Leaderboard",
    mytasks: "My Tasks",
    accounts: "Finance",
    account: "Account",
  };

  document.querySelectorAll(".portal-nav__link[data-panel]").forEach((link) => {
    link.addEventListener("click", () => {
      if (link.hidden) return;
      const panel = link.dataset.panel;
      document.querySelectorAll(".portal-nav__link[data-panel]").forEach((l) => l.classList.remove("portal-nav__link--active"));
      link.classList.add("portal-nav__link--active");
      document.querySelectorAll(".portal-panel").forEach((p) => p.classList.remove("portal-panel--active"));
      document.getElementById(`panel-${panel}`).classList.add("portal-panel--active");
      document.getElementById("pageTitle").textContent = titles[panel] || "Portal";
      document.getElementById("sidebar").classList.remove("portal-sidebar--open");
      if (panel === "alumni") {
        if (LEADERSHIP_ROLES.includes(currentSession?.role)) {
          loadLeadershipAlumniDashboard();
        } else if (currentSession?.department) {
          loadDeptAlumniContacts(currentSession.department);
        }
      }
      if (panel === "certificates" && currentSession?.role === ROLES.FACULTY) {
        loadFacultyCertificates();
      }
      if (panel === "leaderboard") {
        if (
          LEADERSHIP_ROLES.includes(currentSession?.role) ||
          (currentSession?.role === ROLES.STUDENT && currentSession?.department)
        ) {
          loadPortalLeaderboard();
        }
      }
      if (
        panel === "accounts" &&
        (currentSession?.role === ROLES.TREASURER || LEADERSHIP_ROLES.includes(currentSession?.role))
      ) {
        loadFinanceAccounts();
      }
    });
  });

  document.getElementById("mobileToggle")?.addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("portal-sidebar--open");
  });

  document.getElementById("execGotoAlumniBtn")?.addEventListener("click", () => {
    document.querySelector('[data-panel="alumni"]')?.click();
  });

  document.getElementById("treasurerGotoAccountsBtn")?.addEventListener("click", () => {
    document.querySelector('[data-panel="accounts"]')?.click();
  });
}

function setupAccount(session) {
  document.getElementById("accountPasswordCard").innerHTML = passwordFormHtml("portal");
  renderPasswordPrompt(document.getElementById("passwordPrompt"), session.mustChangePassword);
  document.getElementById("passwordPrompt")?.addEventListener("click", (e) => {
    if (e.target.matches("[data-goto-password]")) {
      document.querySelector('[data-panel="account"]')?.click();
    }
  });
  setupPasswordPanel({
    formId: "portalpasswordForm",
    toast,
    onSuccess: (updated) => {
      renderPasswordPrompt(document.getElementById("passwordPrompt"), updated.mustChangePassword);
    },
  });
}

async function loadDashboard() {
  const meetupEl = document.getElementById("dashboardMeetup");
  const eventsEl = document.getElementById("dashboardEvents");
  let meetupData = DEFAULT_MEETUP;

  try {
    const snap = await getDoc(doc(db, "settings", "meetup"));
    meetupData = snap.exists() ? { ...DEFAULT_MEETUP, ...snap.data() } : DEFAULT_MEETUP;
    renderMeetupOverview(meetupEl, meetupData);
  } catch (err) {
    console.error(err);
    renderMeetupOverview(meetupEl, DEFAULT_MEETUP);
  }

  try {
    const q = query(collection(db, "pre_events"), orderBy("date", "asc"));
    const snap = await getDocs(q);
    const events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPreEventsOverview(eventsEl, events, meetupData);
  } catch (err) {
    console.error(err);
    renderPreEventsOverview(eventsEl, [], meetupData);
  }

  if (LEADERSHIP_ROLES.includes(currentSession?.role)) {
    loadLeadershipDashboardOverview();
  }
  if (
    currentSession?.role === ROLES.TREASURER ||
    LEADERSHIP_ROLES.includes(currentSession?.role)
  ) {
    loadFinanceDashboardSummary();
  }
}

async function loadFinanceDashboardSummary() {
  const wrap = document.getElementById("treasurerDashSummaryWrap");
  if (!wrap) return;
  wrap.innerHTML = '<p class="empty-state">Loading...</p>';
  try {
    const [expenses, contacts, feeSettings] = await Promise.all([
      loadExpenses(),
      loadAllAlumniContacts(),
      loadRegistrationSettings(),
    ]);
    const s = summarizeAccounts(expenses);
    const fees = summarizeRegistrationFees(contacts, feeSettings);
    wrap.innerHTML = `
      <div class="acct-stat-grid">
        <div class="acct-stat acct-stat--good"><div class="acct-stat__value">${formatINR(fees.receivedTotal)}</div><div class="acct-stat__label">Fees received (${fees.paidCount} · ${fees.paidMembers || 0} people)</div></div>
        <div class="acct-stat acct-stat--warn"><div class="acct-stat__value">${formatINR(fees.pendingTotal)}</div><div class="acct-stat__label">Fees pending (${fees.pendingCount} · ${fees.pendingMembers || 0} people)</div></div>
        <div class="acct-stat"><div class="acct-stat__value">${formatINR(s.totalExpenses)}</div><div class="acct-stat__label">Total expenses</div></div>
        <div class="acct-stat"><div class="acct-stat__value">${formatINR(s.totalOutstanding)}</div><div class="acct-stat__label">Not paid to person</div></div>
      </div>`;
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Could not load finance summary.</p>';
  }
}

async function setupLeadershipAlumni(session) {
  cachedRegistration = await loadRegistrationSettings();
  cachedLeadershipFeeLabel = formatFee(cachedRegistration);
}

async function loadLeadershipDashboardOverview() {
  const wrap = document.getElementById("execAlumniOverviewWrap");
  if (!wrap) return;
  wrap.innerHTML = '<p class="empty-state">Loading...</p>';
  try {
    if (!cachedLeadershipContacts.length) {
      cachedLeadershipContacts = await loadAllAlumniContacts();
    }
    const stats = summarizeContacts(cachedLeadershipContacts);
    const deptRows = departmentBreakdown(cachedLeadershipContacts, DEPARTMENTS);
    wrap.innerHTML = `
      ${statsCardsHtml(stats, { title: "Campus summary" })}
      <div style="margin-top:1rem;">
        <h3 class="ac-dashboard__subtitle">Department-wise status</h3>
        ${departmentBreakdownTableHtml(deptRows)}
      </div>
      ${insightsHtml(stats, deptRows)}
    `;
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Failed to load Alumni Connect status.</p>';
  }
}

async function loadLeadershipAlumniDashboard() {
  const wrap = document.getElementById("deptAlumniContactsWrap");
  if (!wrap) return;
  wrap.innerHTML = '<p class="empty-state">Loading...</p>';
  try {
    const [contacts, regSettings] = await Promise.all([
      loadAllAlumniContacts(),
      cachedRegistration ? Promise.resolve(cachedRegistration) : loadRegistrationSettings(),
    ]);
    cachedLeadershipContacts = contacts;
    cachedRegistration = regSettings;
    cachedLeadershipFeeLabel = formatFee(regSettings);
    renderLeadershipAlumniDashboard();
    // Keep dashboard overview in sync
    loadLeadershipDashboardOverview();
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Failed to load alumni contacts.</p>';
  }
}

function renderLeadershipAlumniDashboard() {
  const wrap = document.getElementById("deptAlumniContactsWrap");
  if (!wrap) return;

  const contacts = cachedLeadershipContacts || [];
  const batches = uniqueSortedValues(contacts, (c) => c.batch || c.passoutYear);
  const sectors = uniqueSortedValues(contacts, (c) => c.jobSector);

  wrap.innerHTML = `
    <div class="ac-dashboard">
      <div class="ac-dashboard__toolbar">
        <p class="form-hint" style="margin:0;">Registration fee: <strong>${escapeHtml(cachedLeadershipFeeLabel)}</strong></p>
        <button type="button" class="btn btn--primary btn--sm" id="leadAcDownloadPdf">Download contacts PDF</button>
      </div>
      <div id="leadAcOverallStats"></div>
      <div id="leadAcInsights"></div>
      <div>
        <h3 class="ac-dashboard__subtitle">Department-wise status</h3>
        <div id="leadAcDeptTable"></div>
      </div>
      ${alumniFiltersHtml("leadAc", {
        showDepartment: true,
        departments: DEPARTMENTS,
        batches,
        sectors,
      })}
      <div>
        <div class="ac-dashboard__toolbar" style="margin-bottom:0.5rem;">
          <h3 class="ac-dashboard__subtitle" style="margin:0;">Alumni contacted</h3>
          <button type="button" class="btn btn--ghost btn--sm" id="leadAcDownloadPdfSecondary">Download contacts PDF</button>
        </div>
        <div class="status-legend" aria-label="Status color key">
          <span class="status-legend__item"><span class="status-legend__dot status-legend__dot--green"></span> Willing / Paid</span>
          <span class="status-legend__item"><span class="status-legend__dot status-legend__dot--orange"></span> Undecided / Payment pending</span>
          <span class="status-legend__item"><span class="status-legend__dot status-legend__dot--red"></span> Not willing</span>
          <span class="status-legend__item"><span class="status-legend__dot status-legend__dot--gray"></span> No response / Not registered</span>
        </div>
        <p class="ac-results-meta" id="leadAcMeta"></p>
        <div id="leadAcFilteredStats"></div>
        <div id="leadAcTable" class="table-scroll" style="margin-top:1rem;"></div>
      </div>
    </div>`;

  if (!leadershipAlumniFilterBound) {
    leadershipAlumniFilterBound = true;
    wrap.addEventListener("click", async (e) => {
      if (e.target.id === "leadAcApplyFilters") {
        applyLeadershipAlumniFilters();
      } else if (e.target.id === "leadAcResetFilters") {
        [
          "leadAcSearch",
          "leadAcDepartment",
          "leadAcWillingness",
          "leadAcRegistration",
          "leadAcBatch",
          "leadAcSector",
        ].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
        applyLeadershipAlumniFilters();
      } else if (
        e.target.id === "leadAcDownloadPdf" ||
        e.target.id === "leadAcDownloadPdfSecondary" ||
        e.target.closest("#leadAcDownloadPdf") ||
        e.target.closest("#leadAcDownloadPdfSecondary")
      ) {
        await handleLeadershipContactsPdf(e.target.closest("button") || e.target);
      }
    });
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.closest("#leadAcFilters")) {
        e.preventDefault();
        applyLeadershipAlumniFilters();
      }
    });
  }

  applyLeadershipAlumniFilters();
}

function applyLeadershipAlumniFilters() {
  const filters = readAlumniFilters("leadAc", { showDepartment: true });
  const all = cachedLeadershipContacts || [];
  const filtered = filterAlumniContacts(all, filters);
  cachedLeadershipFilters = filters;
  cachedLeadershipFiltered = filtered;

  const overallStats = summarizeContacts(all);
  const filteredStats = summarizeContacts(filtered);
  const deptRows = departmentBreakdown(all, DEPARTMENTS);

  const overallEl = document.getElementById("leadAcOverallStats");
  const insightsEl = document.getElementById("leadAcInsights");
  const deptEl = document.getElementById("leadAcDeptTable");
  const filteredStatsEl = document.getElementById("leadAcFilteredStats");
  const metaEl = document.getElementById("leadAcMeta");
  const tableEl = document.getElementById("leadAcTable");
  if (!overallEl || !tableEl) return;

  overallEl.innerHTML = statsCardsHtml(overallStats, { title: "Institution summary" });
  if (insightsEl) insightsEl.innerHTML = insightsHtml(overallStats, deptRows);
  if (deptEl) deptEl.innerHTML = departmentBreakdownTableHtml(deptRows);

  const hasActiveFilter = Object.values(filters).some((v) => v);
  if (filteredStatsEl) {
    filteredStatsEl.innerHTML = hasActiveFilter
      ? statsCardsHtml(filteredStats, { title: "Filtered summary" })
      : "";
  }
  if (metaEl) {
    metaEl.textContent = `Showing ${filtered.length} of ${all.length} contacts`;
  }
  tableEl.innerHTML = leadershipContactsTableHtml(filtered);
}

function leadershipContactsTableHtml(contacts) {
  if (!contacts.length) {
    return '<p class="empty-state">No alumni contacts match the current filters.</p>';
  }
  const deptLabel = (code) =>
    DEPARTMENTS.find((d) => d.value === code)?.label || code || "—";

  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>Department</th>
          <th>Alumni</th>
          <th>WhatsApp</th>
          <th>Passout</th>
          <th>Willingness</th>
          <th>Registration</th>
          <th>Volunteer</th>
        </tr>
      </thead>
      <tbody>
        ${contacts
          .map(
            (c) => `
          <tr>
            <td>${escapeHtml(deptLabel(c.department))}</td>
            <td>
              <strong>${escapeHtml(c.alumniName)}</strong>
              ${c.email ? `<br><small style="color:var(--slate-500)">${escapeHtml(c.email)}</small>` : ""}
              ${c.company ? `<br><small style="color:var(--slate-500)">${escapeHtml(c.company)}</small>` : ""}
            </td>
            <td>${escapeHtml(c.whatsapp || "—")}</td>
            <td>${escapeHtml(c.batch || c.passoutYear || "—")}</td>
            <td>${statusBadgeHtml("willingness", c.willingness)}</td>
            <td>${statusBadgeHtml("registration", c.registrationStatus)}</td>
            <td>${escapeHtml(c.createdByName || c.createdByUserId || "—")}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

async function handleLeadershipContactsPdf(btn) {
  const original = btn?.textContent;
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Generating…";
    }
    await downloadAlumniContactsPdf({
      contacts: cachedLeadershipFiltered,
      filters: cachedLeadershipFilters,
      feeLabel: cachedLeadershipFeeLabel,
      allCount: (cachedLeadershipContacts || []).length,
    });
    showToast(toast, "Alumni contacts PDF downloaded.", "success");
  } catch (err) {
    console.error(err);
    showToast(toast, "Could not generate contacts PDF.", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = original || "Download contacts PDF";
    }
  }
}

async function loadPortalLeaderboard() {
  const wrap = document.getElementById("portalLeaderboardWrap");
  if (!wrap) return;
  const department =
    currentSession?.role === ROLES.STUDENT ? currentSession.department || null : null;
  await loadLeaderboardPanel(wrap, {
    toast,
    enrichVolunteers: enrichContactsWithVolunteerMeta,
    department,
  });
}

async function loadFinanceAccounts() {
  const wrap = document.getElementById("treasurerAccountsWrap");
  if (!wrap) return;
  const readOnly = LEADERSHIP_ROLES.includes(currentSession?.role);
  await mountTreasurerAccounts(wrap, {
    toast,
    session: currentSession,
    readOnly,
  });
}

async function enrichContactsWithVolunteerMeta(contacts) {
  try {
    const [registry, teams] = await Promise.all([getRegistry(), loadTeams()]);
    const byId = new Map(registry.map((u) => [u.userId, u]));
    return (contacts || []).map((c) => {
      const user = byId.get(c.createdByUserId);
      if (!user) return c;
      return {
        ...c,
        createdByName: c.createdByName || user.displayName || user.fullName || c.createdByUserId,
        createdByTeam: teamLabel(teams, user.team) || user.team || "",
        team: teamLabel(teams, user.team) || user.team || "",
        department: c.department || user.department || "",
      };
    });
  } catch (err) {
    console.error(err);
    return contacts;
  }
}

async function ensureFacultySession() {
  const result = await requireAuth([ROLES.FACULTY]);
  if (!result?.session) {
    showToast(toast, "Session expired. Please sign in again.", "error");
    window.location.href = "../login.html";
    return null;
  }
  currentSession = result.session;
  return result.session;
}

async function getRegistry() {
  const snap = await getDoc(doc(db, USERS_COLLECTION, REGISTRY_DOC));
  return snap.exists() ? snap.data().users || [] : [];
}

async function saveRegistry(users) {
  await setDoc(doc(db, USERS_COLLECTION, REGISTRY_DOC), withSession({
    users,
    updatedAt: serverTimestamp(),
  }));
}

function populateTeamSelect(selectEl, selected = "") {
  if (!selectEl) return;
  const activeTeams = cachedTeams.filter((t) => t.active !== false);
  selectEl.innerHTML =
    '<option value="">Select team</option>' +
    activeTeams
      .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)
      .join("");
  if (selected) selectEl.value = selected;
}

async function setupDepartmentPanel(session) {
  cachedTeams = await loadTeams();
  populateTeamSelect(document.getElementById("volTeam"));
  setupVolunteerForm(session);
  await refreshDepartmentData(session);
}

async function loadFacultyCertificates() {
  const wrap = document.getElementById("facultyCertificatesWrap");
  if (!wrap || !currentSession) return;
  await mountVolunteerCertificates(wrap, {
    session: currentSession,
    notify: (message, type) => showToast(toast, message, type),
  });
}

async function refreshDepartmentData(session) {
  await loadDeptVolunteers(session.department);
  await loadDeptMainTasks(session);
  await loadDeptTasks(session);
  await loadDeptAlumniContacts(session.department);
}

function setupVolunteerForm(session) {
  const form = document.getElementById("deptVolunteerForm");
  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!(await ensureFacultySession())) return;

    const fullName = document.getElementById("volFullName").value.trim();
    const mobile = document.getElementById("volMobile").value.trim().replace(/[\s\-]/g, "");
    const team = document.getElementById("volTeam").value;
    const department = session.department;

    if (!fullName) {
      showToast(toast, "Full name is required.", "error");
      return;
    }
    if (!/^\d{10,15}$/.test(mobile)) {
      showToast(toast, "Mobile must be 10–15 digits.", "error");
      return;
    }
    if (!team) {
      showToast(toast, "Select a team.", "error");
      return;
    }

    const userId = normalizeUsername(mobile);
    const existing = await getDoc(doc(db, USERS_COLLECTION, userId));
    const registry = await getRegistry();
    if (existing.exists() || registry.some((u) => u.userId === userId || u.username === mobile)) {
      showToast(toast, "A user with this mobile already exists.", "error");
      return;
    }

    try {
      const { passwordHash, salt } = await hashPassword(mobile);
      await setDoc(doc(db, USERS_COLLECTION, userId), withSession({
        username: mobile,
        displayName: fullName,
        role: ROLES.STUDENT,
        department,
        team,
        mobile,
        passwordHash,
        salt,
        active: true,
        mustChangePassword: true,
        createdAt: serverTimestamp(),
      }));

      registry.push({
        userId,
        username: mobile,
        displayName: fullName,
        role: ROLES.STUDENT,
        department,
        team,
        mobile,
        active: true,
      });
      await saveRegistry(registry);

      showToast(toast, `Volunteer ${fullName} created. Mobile is the temporary password.`, "success");
      form.reset();
      populateTeamSelect(document.getElementById("volTeam"));
      await refreshDepartmentData(session);
    } catch (err) {
      console.error(err);
      const msg = err.code === "permission-denied"
        ? "Permission denied. Republish firestore.rules in Firebase Console."
        : "Failed to create volunteer.";
      showToast(toast, msg, "error");
    }
  });
}

function normalizeDept(value) {
  return String(value || "").trim().toUpperCase();
}

async function getDepartmentVolunteers(department) {
  const deptNorm = normalizeDept(department);
  const registry = await getRegistry();

  const candidates = registry.filter(
    (u) => !u.role || u.role === ROLES.STUDENT
  );

  const enriched = [];
  for (const entry of candidates) {
    let data = {
      userId: entry.userId,
      username: entry.username || "",
      displayName: entry.displayName || entry.username || "",
      role: entry.role || ROLES.STUDENT,
      department: entry.department || "",
      team: entry.team || "",
      mobile: entry.mobile || entry.username || "",
      active: entry.active !== false,
    };

    if (entry.userId) {
      try {
        const snap = await getDoc(doc(db, USERS_COLLECTION, entry.userId));
        if (snap.exists()) {
          const user = snap.data();
          data = {
            userId: entry.userId,
            username: user.username || data.username,
            displayName: user.displayName || data.displayName,
            role: user.role || data.role,
            department: user.department || data.department,
            team: user.team || data.team,
            mobile: user.mobile || data.mobile,
            active: user.active !== false,
          };
        }
      } catch {
        // Keep registry values if user doc cannot be read
      }
    }

    if (data.role === ROLES.STUDENT && normalizeDept(data.department) === deptNorm) {
      enriched.push(data);
    }
  }

  return enriched.sort((a, b) => {
    const activeCmp = Number(b.active !== false) - Number(a.active !== false);
    if (activeCmp !== 0) return activeCmp;
    const teamCmp = (a.team || "").localeCompare(b.team || "");
    if (teamCmp !== 0) return teamCmp;
    return (a.displayName || "").localeCompare(b.displayName || "");
  });
}

async function loadDeptVolunteers(department) {
  const wrap = document.getElementById("deptVolunteersWrap");
  try {
    const volunteers = await getDepartmentVolunteers(department);
    cachedDeptVolunteers = volunteers.filter((u) => u.active !== false);

    if (!volunteers.length) {
      wrap.innerHTML = '<p class="empty-state">No volunteers in your department yet. Add one above, or ask admin to upload volunteers for this department.</p>';
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Name</th><th>Mobile / Username</th><th>Team</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${volunteers
            .map(
              (u) => `
            <tr>
              <td><strong>${escapeHtml(u.displayName)}</strong></td>
              <td>${escapeHtml(u.username || u.mobile || "—")}</td>
              <td><span class="badge badge--role">${escapeHtml(teamLabel(cachedTeams, u.team))}</span></td>
              <td>
                <span class="badge ${u.active !== false ? "badge--published" : "badge--inactive"}">
                  ${u.active !== false ? "Active" : "Inactive"}
                </span>
              </td>
              <td class="table-actions">
                <button class="btn btn--sm ${u.active !== false ? "btn--danger" : "btn--primary"}"
                  data-toggle-vol="${escapeHtml(u.userId)}"
                  data-active="${u.active !== false}">
                  ${u.active !== false ? "Deactivate" : "Activate"}
                </button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`;

    wrap.querySelectorAll("[data-toggle-vol]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await ensureFacultySession())) return;
        const userId = btn.dataset.toggleVol;
        const active = btn.dataset.active === "true";
        try {
          await updateDoc(doc(db, USERS_COLLECTION, userId), withSession({
            active: !active,
            updatedAt: serverTimestamp(),
          }));
          const registry = await getRegistry();
          const idx = registry.findIndex((u) => u.userId === userId);
          if (idx >= 0) {
            registry[idx].active = !active;
            await saveRegistry(registry);
          }
          showToast(toast, active ? "Volunteer deactivated." : "Volunteer activated.", "success");
          await refreshDepartmentData(currentSession);
        } catch (err) {
          console.error(err);
          showToast(toast, "Failed to update volunteer status.", "error");
        }
      });
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Failed to load volunteers.</p>';
  }
}

async function loadDeptMainTasks(session) {
  const wrap = document.getElementById("deptMainTasksWrap");
  try {
    const q = query(collection(db, MAIN_TASKS_COLLECTION), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    const tasks = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => !t._deleted);

    if (!tasks.length) {
      wrap.innerHTML = '<p class="empty-state">No main tasks from admin yet.</p>';
      return;
    }

    const activeTeams = cachedTeams.filter((t) => t.active !== false);

    function teamOptionsForTask(task) {
      const allowed = task.teams?.length ? task.teams : null;
      const options = allowed
        ? activeTeams.filter((t) => allowed.includes(t.id))
        : activeTeams;
      return options
        .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)
        .join("");
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Task</th><th>Type</th><th>Teams</th><th>Due</th><th>Assign to team</th><th></th></tr></thead>
        <tbody>
          ${tasks
            .map((t) => {
              const options = teamOptionsForTask(t);
              const type = inferTaskType(t);
              return `
            <tr>
              <td>
                <strong>${escapeHtml(t.title)}</strong>
                ${t.description ? `<br><small style="color:var(--slate-500)">${escapeHtml(t.description)}</small>` : ""}
              </td>
              <td><span class="badge badge--role">${escapeHtml(TASK_TYPE_LABELS[type] || TASK_TYPE_LABELS[TASK_TYPES.GENERAL])}</span></td>
              <td>${escapeHtml(
                t.teams?.length
                  ? t.teams.map((id) => teamLabel(cachedTeams, id)).join(", ")
                  : "All teams"
              )}</td>
              <td>${escapeHtml(formatDateShort(t.dueDate) || "—")}</td>
              <td>
                <select data-team-for="${t.id}" style="min-width:140px;" ${!options ? "disabled" : ""}>
                  <option value="">Select team</option>
                  ${options}
                </select>
              </td>
              <td>
                <button class="btn btn--primary btn--sm" data-replicate="${t.id}" ${!options ? "disabled" : ""}>Replicate</button>
              </td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;

    tasks.forEach((t) => {
      if (t.teams?.length === 1) {
        const select = wrap.querySelector(`[data-team-for="${t.id}"]`);
        if (select) select.value = t.teams[0];
      }
    });

    wrap.querySelectorAll("[data-replicate]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await ensureFacultySession())) return;
        const taskId = btn.dataset.replicate;
        const task = tasks.find((t) => t.id === taskId);
        const teamSelect = wrap.querySelector(`[data-team-for="${taskId}"]`);
        const team = teamSelect?.value;
        if (!team) {
          showToast(toast, "Select a team before replicating.", "error");
          return;
        }
        if (task.teams?.length && !task.teams.includes(team)) {
          showToast(toast, "Selected team is not allowed for this task.", "error");
          return;
        }

        try {
          const taskType =
            task.taskType ||
            (/alumni\s*connect/i.test(task.title || "")
              ? TASK_TYPES.ALUMNI_CONNECT
              : /volunteer\s*cert/i.test(task.title || "")
                ? TASK_TYPES.VOLUNTEER_CERTIFICATE
                : TASK_TYPES.GENERAL);

          await addDoc(collection(db, DEPT_TASKS_COLLECTION), withSession({
            parentTaskId: taskId,
            title: task.title,
            description: task.description || "",
            dueDate: task.dueDate || "",
            department: session.department,
            team,
            taskType,
            status: "open",
            progress: 0,
            assigneeUserIds: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }));
          showToast(
            toast,
            taskType === TASK_TYPES.VOLUNTEER_CERTIFICATE
              ? "Volunteer Certificate assigned. Open Certificates in the sidebar to generate PDFs."
              : "Task replicated for your department.",
            "success"
          );
          await loadDeptTasks(session);
          await loadDeptAlumniContacts(session.department);
        } catch (err) {
          console.error(err);
          showToast(toast, "Failed to replicate task. Check permissions / Firestore rules.", "error");
        }
      });
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Failed to load main tasks.</p>';
  }
}

function volunteerOptionsHtml(teamFilter, selectedIds = []) {
  const selected = new Set(selectedIds || []);
  let list = cachedDeptVolunteers.filter((u) => !teamFilter || u.team === teamFilter);
  // If no same-team volunteers, still show all department volunteers for assignment
  if (!list.length) list = [...cachedDeptVolunteers];
  if (!list.length) {
    return '<p class="form-hint">No active volunteers in your department yet.</p>';
  }
  return list
    .map(
      (u) => `
      <label class="checkbox-label">
        <input type="checkbox" value="${escapeHtml(u.userId)}" ${selected.has(u.userId) ? "checked" : ""}>
        ${escapeHtml(u.displayName)}
        <span style="color:var(--slate-500);font-size:0.8rem;">(${escapeHtml(teamLabel(cachedTeams, u.team))})</span>
      </label>`
    )
    .join("");
}

async function loadDeptTasks(session) {
  const wrap = document.getElementById("deptTasksWrap");
  const department = session.department;
  try {
    const snap = await getDocs(collection(db, DEPT_TASKS_COLLECTION));
    const tasks = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => !t._deleted && t.department === department && !isCertificateBatchRecord(t))
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    if (!tasks.length) {
      wrap.innerHTML = '<p class="empty-state">No department tasks yet. Replicate a main task above.</p>';
      return;
    }

    wrap.innerHTML = tasks
      .map((t) => {
        const assignees = t.assigneeUserIds || [];
        const assigneeNames = assignees
          .map((id) => cachedDeptVolunteers.find((v) => v.userId === id)?.displayName || id)
          .join(", ");
        return `
        <article class="portal-task-card" data-task-id="${t.id}">
          <div class="portal-task-card__head">
            <div>
              <h3 class="portal-task-card__title">${escapeHtml(t.title)}</h3>
              <p class="form-hint">
                Type: <strong>${escapeHtml(TASK_TYPE_LABELS[t.taskType] || TASK_TYPE_LABELS[TASK_TYPES.GENERAL])}</strong>
                · Team: <strong>${escapeHtml(teamLabel(cachedTeams, t.team))}</strong>
                · Due: ${escapeHtml(formatDateShort(t.dueDate) || "—")}
              </p>
              ${t.description ? `<p class="form-hint">${escapeHtml(t.description)}</p>` : ""}
              <p class="form-hint">Assigned: ${escapeHtml(assigneeNames || "None yet")}</p>
              ${
                inferTaskType(t) === TASK_TYPES.VOLUNTEER_CERTIFICATE
                  ? `<p class="form-hint">Generate PDFs from the <strong>Certificates</strong> sidebar after this task is assigned.</p>`
                  : ""
              }
            </div>
          </div>
          <div class="form-row" style="margin-top:0.75rem;">
            <div class="form-group">
              <label>Status</label>
              <select data-status="${t.id}">
                <option value="open" ${t.status === "open" ? "selected" : ""}>Open</option>
                <option value="in_progress" ${t.status === "in_progress" ? "selected" : ""}>In Progress</option>
                <option value="done" ${t.status === "done" ? "selected" : ""}>Done</option>
              </select>
            </div>
            <div class="form-group">
              <label>Progress %</label>
              <input type="number" min="0" max="100" data-progress="${t.id}" value="${Number(t.progress || 0)}">
            </div>
          </div>
          <div class="form-group">
            <label>Assign volunteers (same team preferred)</label>
            <div class="task-assignee-list" data-assignees="${t.id}">
              ${volunteerOptionsHtml(t.team, assignees)}
            </div>
          </div>
          <button type="button" class="btn btn--primary btn--sm" data-save-task="${t.id}">Save Assignment</button>
        </article>`;
      })
      .join("");

    wrap.querySelectorAll("[data-save-task]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await ensureFacultySession())) return;
        const taskId = btn.dataset.saveTask;
        const task = tasks.find((t) => t.id === taskId);
        if (!task) return;

        const status = wrap.querySelector(`[data-status="${taskId}"]`)?.value || "open";
        const progress = Math.min(100, Math.max(0, Number(wrap.querySelector(`[data-progress="${taskId}"]`)?.value || 0)));
        const assigneeUserIds = [...wrap.querySelectorAll(`[data-assignees="${taskId}"] input:checked`)]
          .map((el) => el.value);

        try {
          await updateDoc(doc(db, DEPT_TASKS_COLLECTION, taskId), withSession({
            department: task.department,
            team: task.team,
            title: task.title,
            description: task.description || "",
            dueDate: task.dueDate || "",
            parentTaskId: task.parentTaskId || "",
            taskType:
              task.taskType ||
              (/alumni\s*connect/i.test(task.title || "")
                ? TASK_TYPES.ALUMNI_CONNECT
                : /volunteer\s*cert/i.test(task.title || "")
                  ? TASK_TYPES.VOLUNTEER_CERTIFICATE
                  : TASK_TYPES.GENERAL),
            status,
            progress,
            assigneeUserIds,
            updatedAt: serverTimestamp(),
          }));
          showToast(toast, "Task assignment saved.", "success");
          await loadDeptTasks(session);
        } catch (err) {
          console.error(err);
          const msg = err.code === "permission-denied"
            ? "Permission denied. Republish firestore.rules in Firebase Console."
            : "Failed to save task assignment.";
          showToast(toast, msg, "error");
        }
      });
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Failed to load department tasks.</p>';
  }
}

async function loadDeptAlumniContacts(department) {
  const wrap = document.getElementById("deptAlumniContactsWrap");
  if (!wrap) return;
  try {
    const isFaculty = currentSession?.role === ROLES.FACULTY;
    if (!cachedRegistration) {
      cachedRegistration = await loadRegistrationSettings();
    }
    cachedDeptAlumniContacts = await loadContactsByDepartment(department, {
      includeInvalidated: isFaculty,
    });
    if (isFaculty) {
      renderFacultyAlumniDashboard();
    } else {
      renderStudentDeptAlumniDashboard();
    }
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Failed to load alumni contacts.</p>';
  }
}

function renderStudentDeptAlumniDashboard(preserveFilters = false) {
  const wrap = document.getElementById("deptAlumniContactsWrap");
  if (!wrap) return;

  const contacts = cachedDeptAlumniContacts || [];
  const prev = preserveFilters ? readAlumniFilters("facAc", { hasVolunteer: true }) : null;

  const volunteersMap = new Map();
  contacts.forEach((c) => {
    if (!c.createdByUserId) return;
    if (!volunteersMap.has(c.createdByUserId)) {
      volunteersMap.set(c.createdByUserId, {
        userId: c.createdByUserId,
        displayName: c.createdByName || c.createdByUserId,
      });
    }
  });
  const volunteers = [...volunteersMap.values()].sort((a, b) =>
    (a.displayName || "").localeCompare(b.displayName || "")
  );

  wrap.innerHTML = `
    <div class="ac-dashboard ac-dashboard--minimal">
      <div id="facAcStats"></div>
      ${alumniFiltersHtml("facAc", { volunteers, compact: true })}
      <div>
        <div class="ac-dashboard__toolbar" style="margin-bottom:0.5rem;">
          <h3 class="ac-dashboard__subtitle" style="margin:0;">Contacts</h3>
          <p class="ac-results-meta" id="facAcMeta" style="margin:0;"></p>
        </div>
        <div id="facAcTable"></div>
      </div>
    </div>`;

  if (prev) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el && val != null) el.value = val;
    };
    set("facAcSearch", prev.search);
    set("facAcWillingness", prev.willingness);
    set("facAcRegistration", prev.registrationStatus);
    set("facAcVolunteer", prev.volunteerUserId);
  }

  if (!facultyAlumniFilterBound) {
    facultyAlumniFilterBound = true;
    wrap.addEventListener("click", (e) => {
      if (currentSession?.role === ROLES.FACULTY) return;
      if (e.target.id === "facAcApplyFilters") {
        applyStudentDeptAlumniFilters();
      } else if (e.target.id === "facAcResetFilters") {
        ["facAcSearch", "facAcWillingness", "facAcRegistration", "facAcVolunteer"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
        applyStudentDeptAlumniFilters();
      }
    });
    wrap.addEventListener("keydown", (e) => {
      if (currentSession?.role === ROLES.FACULTY) return;
      if (e.key === "Enter" && e.target.closest("#facAcFilters")) {
        e.preventDefault();
        applyStudentDeptAlumniFilters();
      }
    });
  }

  applyStudentDeptAlumniFilters();
}

function applyStudentDeptAlumniFilters() {
  const filters = readAlumniFilters("facAc", { hasVolunteer: true });
  const filtered = filterAlumniContacts(cachedDeptAlumniContacts, filters);
  const stats = summarizeContacts(filtered);

  const statsEl = document.getElementById("facAcStats");
  const metaEl = document.getElementById("facAcMeta");
  const tableEl = document.getElementById("facAcTable");
  if (!statsEl || !tableEl) return;

  statsEl.innerHTML = compactAlumniStatsHtml(stats);
  if (metaEl) {
    metaEl.textContent = `${filtered.length} of ${cachedDeptAlumniContacts.length}`;
  }
  tableEl.innerHTML = contactsTableHtml(filtered, {
    showVolunteer: true,
    showMembers: true,
    minimal: true,
    feeSettings: cachedRegistration,
  });
}

function renderFacultyAlumniDashboard(preserveFilters = false) {
  const wrap = document.getElementById("deptAlumniContactsWrap");
  if (!wrap) return;

  const contacts = cachedDeptAlumniContacts || [];
  const prev = preserveFilters
    ? readAlumniFilters("facAc", { hasVolunteer: true, showValidity: true })
    : null;

  const volunteersMap = new Map();
  contacts.forEach((c) => {
    if (!c.createdByUserId) return;
    if (!volunteersMap.has(c.createdByUserId)) {
      volunteersMap.set(c.createdByUserId, {
        userId: c.createdByUserId,
        displayName: c.createdByName || c.createdByUserId,
      });
    }
  });
  const volunteers = [...volunteersMap.values()].sort((a, b) =>
    (a.displayName || "").localeCompare(b.displayName || "")
  );
  const batches = uniqueSortedValues(contacts, (c) => c.batch || c.passoutYear);
  const sectors = uniqueSortedValues(contacts, (c) => c.jobSector);
  const dupGroups = findDuplicateGroups(contacts);

  wrap.innerHTML = `
    <div class="ac-dashboard">
      <div id="facAcStats"></div>
      <div id="facAcInsights"></div>

      <div class="ac-dup-section">
        <div class="ac-dashboard__toolbar" style="margin-bottom:0.75rem;">
          <div>
            <h3 class="ac-dashboard__subtitle" style="margin:0;">Possible duplicates</h3>
            <p class="form-hint" style="margin:0.35rem 0 0;">
              Suggested matches from WhatsApp/mobile, email, or name + passout year in your department.
              Invalidate extras so stats and leaderboards stay accurate.
            </p>
          </div>
          <button type="button" class="btn btn--ghost btn--sm" id="facAcToggleDupFilter">
            ${facultyShowDuplicatesOnly ? "Show all contacts" : "Focus duplicate contacts"}
          </button>
        </div>
        <div id="facAcDupWrap">${duplicateSuggestionsHtml(dupGroups, { canManage: true })}</div>
      </div>

      ${alumniFiltersHtml("facAc", { batches, sectors, volunteers, showValidity: true })}
      <div>
        <h3 class="ac-dashboard__subtitle">Contact details</h3>
        <p class="form-hint" style="margin-top:0;">
          Full alumni fields (company, job sector, address, remarks, etc.). Expand a row for the complete record.
        </p>
        <p class="ac-results-meta" id="facAcMeta"></p>
        <div id="facAcTable"></div>
      </div>
    </div>`;

  if (prev) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el && val != null) el.value = val;
    };
    set("facAcSearch", prev.search);
    set("facAcWillingness", prev.willingness);
    set("facAcRegistration", prev.registrationStatus);
    set("facAcBatch", prev.batch);
    set("facAcSector", prev.jobSector);
    set("facAcVolunteer", prev.volunteerUserId);
    set("facAcValidity", prev.validity || "active");
  }

  if (!facultyAlumniFilterBound) {
    facultyAlumniFilterBound = true;
    wrap.addEventListener("click", async (e) => {
      if (currentSession?.role !== ROLES.FACULTY) return;

      if (e.target.id === "facAcApplyFilters") {
        applyFacultyAlumniFilters();
        return;
      }
      if (e.target.id === "facAcResetFilters") {
        [
          "facAcSearch",
          "facAcWillingness",
          "facAcRegistration",
          "facAcBatch",
          "facAcSector",
          "facAcVolunteer",
          "facAcValidity",
        ].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = id === "facAcValidity" ? "active" : "";
        });
        facultyShowDuplicatesOnly = false;
        applyFacultyAlumniFilters();
        return;
      }
      if (e.target.id === "facAcToggleDupFilter") {
        facultyShowDuplicatesOnly = !facultyShowDuplicatesOnly;
        renderFacultyAlumniDashboard(true);
        return;
      }

      const detailBtn = e.target.closest("[data-ac-toggle-detail]");
      if (detailBtn) {
        const id = detailBtn.dataset.acToggleDetail;
        facultyExpandedContactId = facultyExpandedContactId === id ? "" : id;
        applyFacultyAlumniFilters();
        const row = wrap.querySelector(`[data-ac-toggle-detail="${CSS.escape(id)}"]`);
        row?.closest("tr")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }

      const invalidateBtn = e.target.closest("[data-ac-invalidate]");
      if (invalidateBtn) {
        const id = invalidateBtn.dataset.acInvalidate;
        const contact = cachedDeptAlumniContacts.find((c) => c.id === id);
        if (!contact) return;
        const reason = prompt(
          `Invalidate “${contact.alumniName || "this entry"}”?\nOptional reason (e.g. duplicate of another record):`,
          "Duplicate entry"
        );
        if (reason === null) return;
        try {
          invalidateBtn.disabled = true;
          const payload = await setContactInvalidated(id, true, currentSession, reason);
          Object.assign(contact, payload);
          showToast(toast, "Entry marked invalid.", "success");
          renderFacultyAlumniDashboard(true);
        } catch (err) {
          console.error(err);
          showToast(
            toast,
            err.code === "permission-denied"
              ? "Permission denied. Republish firestore.rules if needed."
              : "Could not invalidate entry.",
            "error"
          );
        } finally {
          invalidateBtn.disabled = false;
        }
        return;
      }

      const restoreBtn = e.target.closest("[data-ac-restore]");
      if (restoreBtn) {
        const id = restoreBtn.dataset.acRestore;
        const contact = cachedDeptAlumniContacts.find((c) => c.id === id);
        if (!contact) return;
        if (!confirm(`Restore “${contact.alumniName || "this entry"}” as active?`)) return;
        try {
          restoreBtn.disabled = true;
          const payload = await setContactInvalidated(id, false, currentSession);
          Object.assign(contact, payload);
          showToast(toast, "Entry restored.", "success");
          renderFacultyAlumniDashboard(true);
        } catch (err) {
          console.error(err);
          showToast(toast, "Could not restore entry.", "error");
        } finally {
          restoreBtn.disabled = false;
        }
      }
    });
    wrap.addEventListener("keydown", (e) => {
      if (currentSession?.role !== ROLES.FACULTY) return;
      if (e.key === "Enter" && e.target.closest("#facAcFilters")) {
        e.preventDefault();
        applyFacultyAlumniFilters();
      }
    });
  }

  applyFacultyAlumniFilters();
}

function applyFacultyAlumniFilters() {
  const filters = readAlumniFilters("facAc", { hasVolunteer: true, showValidity: true });
  let filtered = filterAlumniContacts(cachedDeptAlumniContacts, filters);

  if (facultyShowDuplicatesOnly) {
    const dupIds = new Set(
      findDuplicateGroups(cachedDeptAlumniContacts)
        .flatMap((g) => g.contacts)
        .map((c) => c.id)
    );
    filtered = filtered.filter((c) => dupIds.has(c.id));
  }

  const activeForStats = filtered.filter((c) => !c.invalidated);
  const stats = summarizeContacts(activeForStats);

  const statsEl = document.getElementById("facAcStats");
  const insightsEl = document.getElementById("facAcInsights");
  const metaEl = document.getElementById("facAcMeta");
  const tableEl = document.getElementById("facAcTable");
  if (!statsEl || !tableEl) return;

  statsEl.innerHTML = statsCardsHtml(stats, { title: "Department summary (active records)" });
  if (insightsEl) {
    insightsEl.innerHTML = insightsHtml(stats, [
      {
        label: currentSession?.department || "Department",
        department: currentSession?.department,
        ...stats,
      },
    ]);
  }
  if (metaEl) {
    const invalidCount = filtered.filter((c) => c.invalidated).length;
    metaEl.textContent = `Showing ${filtered.length} of ${cachedDeptAlumniContacts.length} contacts${
      invalidCount ? ` · ${invalidCount} invalidated in view` : ""
    }${facultyShowDuplicatesOnly ? " · duplicates focus on" : ""}`;
  }
  tableEl.innerHTML = `
    <div class="status-legend" aria-label="Status color key">
      <span class="status-legend__item"><span class="status-legend__dot status-legend__dot--green"></span> Willing / Paid</span>
      <span class="status-legend__item"><span class="status-legend__dot status-legend__dot--orange"></span> Undecided / Payment pending</span>
      <span class="status-legend__item"><span class="status-legend__dot status-legend__dot--red"></span> Not willing / Invalidated</span>
      <span class="status-legend__item"><span class="status-legend__dot status-legend__dot--gray"></span> No response / Not registered</span>
    </div>
    ${facultyContactsDetailHtml(filtered, {
      showVolunteer: true,
      canManage: true,
      expandedId: facultyExpandedContactId,
    })}`;
}

function resolveUserId(session) {
  return normalizeUsername(session.username);
}

function inferTaskType(task) {
  if (task?.taskType) return task.taskType;
  if (/alumni\s*connect/i.test(task?.title || "")) return TASK_TYPES.ALUMNI_CONNECT;
  if (/volunteer\s*cert/i.test(task?.title || "")) return TASK_TYPES.VOLUNTEER_CERTIFICATE;
  return TASK_TYPES.GENERAL;
}

async function setupStudentTasks(session) {
  cachedTeams = await loadTeams();
  cachedRegistration = await loadRegistrationSettings();
  await loadMyTasks(session);
  setupAlumniContactForm(session);
}

async function loadMyTasks(session) {
  const wrap = document.getElementById("myTasksWrap");
  if (!wrap) return;

  const userId = resolveUserId(session);
  try {
    const snap = await getDocs(collection(db, DEPT_TASKS_COLLECTION));
    const tasks = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(
        (t) =>
          !t._deleted &&
          !isCertificateBatchRecord(t) &&
          Array.isArray(t.assigneeUserIds) &&
          t.assigneeUserIds.includes(userId)
      )
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    if (!tasks.length) {
      wrap.innerHTML =
        '<p class="empty-state">No tasks assigned to you yet. Ask your faculty coordinator to assign a task.</p>';
      document.getElementById("alumniConnectCard").hidden = true;
      await loadMyContacts(session, null);
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Task</th><th>Type</th><th>Team</th><th>Due</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${tasks
            .map((t) => {
              const type = inferTaskType(t);
              return `
            <tr>
              <td>
                <strong>${escapeHtml(t.title)}</strong>
                ${t.description ? `<br><small style="color:var(--slate-500)">${escapeHtml(t.description)}</small>` : ""}
              </td>
              <td><span class="badge badge--role">${escapeHtml(TASK_TYPE_LABELS[type] || type)}</span></td>
              <td>${escapeHtml(teamLabel(cachedTeams, t.team))}</td>
              <td>${escapeHtml(formatDateShort(t.dueDate) || "—")}</td>
              <td><span class="badge badge--role">${escapeHtml(t.status || "open")}</span></td>
              <td>
                ${
                  type === TASK_TYPES.ALUMNI_CONNECT
                    ? `<button class="btn btn--primary btn--sm" data-open-connect="${t.id}">Add Contact</button>`
                    : type === TASK_TYPES.VOLUNTEER_CERTIFICATE
                      ? `<span class="form-hint">Faculty generates certificates</span>`
                      : `<span class="form-hint">General task</span>`
                }
              </td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;

    wrap.querySelectorAll("[data-open-connect]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const taskId = btn.dataset.openConnect;
        const task = tasks.find((t) => t.id === taskId);
        openAlumniConnectForm(session, task);
      });
    });

    const firstConnect = tasks.find((t) => inferTaskType(t) === TASK_TYPES.ALUMNI_CONNECT);
    if (firstConnect) {
      openAlumniConnectForm(session, firstConnect);
    } else {
      document.getElementById("alumniConnectCard").hidden = true;
      await loadMyContacts(session, null);
    }
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Failed to load your tasks.</p>';
  }
}

function openAlumniConnectForm(session, task) {
  if (!task) return;
  selectedAlumniTaskId = task.id;
  const card = document.getElementById("alumniConnectCard");
  card.hidden = false;
  document.getElementById("acDeptTaskId").value = task.id;
  resetAlumniContactForm(session, task);
  loadMyContacts(session, task.id);
}

function resetAlumniContactForm(session, task) {
  editingContact = null;
  const feeLabel = formatFee(cachedRegistration);
  document.getElementById("acContactId").value = "";
  document.getElementById("alumniConnectTitle").textContent = "Record Alumni Contact";
  document.getElementById("alumniContactSubmitBtn").textContent = "Save Contact";
  document.getElementById("alumniContactCancelBtn").hidden = true;
  if (task) {
    document.getElementById("alumniConnectHint").innerHTML = `
      Task: <strong>${escapeHtml(task.title)}</strong>
      · Department: <strong>${escapeHtml(task.department || session.department || "")}</strong>
      · Fee (per person): <strong>${escapeHtml(feeLabel)}</strong>`;
  }
  document.getElementById("alumniContactFormFields").innerHTML =
    alumniContactFormHtml("ac", {}, feeLabel, { minimal: true });
  wireAlumniMembersControls();
}

function fillAlumniContactFormForEdit(contact) {
  editingContact = contact;
  const feeLabel = formatFee(cachedRegistration);
  document.getElementById("alumniConnectCard").hidden = false;
  document.getElementById("acContactId").value = contact.id;
  document.getElementById("acDeptTaskId").value = contact.deptTaskId || selectedAlumniTaskId || "";
  document.getElementById("alumniConnectTitle").textContent = "Update Alumni Contact";
  document.getElementById("alumniContactSubmitBtn").textContent = "Update Contact";
  document.getElementById("alumniContactCancelBtn").hidden = false;
  document.getElementById("alumniConnectHint").innerHTML = `
    Editing <strong>${escapeHtml(contact.alumniName)}</strong>.
    Update status or members, then click Update Contact.`;
  document.getElementById("alumniContactFormFields").innerHTML =
    alumniContactFormHtml("ac", contact, feeLabel, { minimal: true });
  wireAlumniMembersControls();
  document.getElementById("alumniConnectCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function wireAlumniMembersControls() {
  wireMembersFeeHint("ac", cachedRegistration);
  const fields = document.getElementById("alumniContactFormFields");
  if (!fields || fields.dataset.membersBound === "1") return;
  fields.dataset.membersBound = "1";
  fields.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-members-form-delta]");
    if (!btn) return;
    e.preventDefault();
    const input = document.getElementById("acMembers");
    if (!input) return;
    const delta = Number(btn.dataset.membersFormDelta) || 0;
    input.value = String(normalizeMembersAttending(Number(input.value) + delta));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setupAlumniContactForm(session) {
  const form = document.getElementById("alumniContactForm");
  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  document.getElementById("alumniContactCancelBtn")?.addEventListener("click", () => {
    const taskId = document.getElementById("acDeptTaskId").value || selectedAlumniTaskId;
    resetAlumniContactForm(currentSession || session, { title: "Alumni Connect", department: session.department, id: taskId });
    document.getElementById("acDeptTaskId").value = taskId || "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const result = await requireAuth([ROLES.STUDENT]);
    if (!result?.session) {
      showToast(toast, "Session expired. Please sign in again.", "error");
      window.location.href = "../login.html";
      return;
    }
    currentSession = result.session;

    const deptTaskId = document.getElementById("acDeptTaskId").value;
    const contactId = document.getElementById("acContactId").value;
    if (!deptTaskId && !contactId) {
      showToast(toast, "Select an Alumni Connect task first.", "error");
      return;
    }

    const { errors, data } = readAlumniContactForm("ac");
    if (errors.length) {
      showToast(toast, errors[0], "error");
      return;
    }

    const userId = resolveUserId(currentSession);
    try {
      if (contactId) {
        const existing = editingContact || cachedMyContacts.find((c) => c.id === contactId);
        if (!existing || existing.createdByUserId !== userId) {
          showToast(toast, "You can only edit contacts you recorded.", "error");
          return;
        }

        await updateAlumniContact(contactId, {
          ...data,
          department: existing.department || currentSession.department || "",
          team: existing.team || currentSession.team || "",
          deptTaskId: existing.deptTaskId || deptTaskId,
          parentTaskId: existing.parentTaskId || "",
          taskTitle: existing.taskTitle || "Alumni Connect",
          feeAmount: Number(existing.feeAmount ?? cachedRegistration?.feeAmount) || 0,
          feeCurrency: existing.feeCurrency || cachedRegistration?.feeCurrency || "INR",
          membersAttending: normalizeMembersAttending(data.membersAttending),
          createdByUserId: existing.createdByUserId,
          createdByName: existing.createdByName || currentSession.displayName || currentSession.username,
        });

        showToast(toast, "Alumni contact updated.", "success");
        const taskRef = {
          id: existing.deptTaskId || deptTaskId,
          title: existing.taskTitle || "Alumni Connect",
          department: existing.department || currentSession.department,
        };
        resetAlumniContactForm(currentSession, taskRef);
        document.getElementById("acDeptTaskId").value = taskRef.id || "";
        await loadMyContacts(currentSession, taskRef.id || null);
        return;
      }

      const taskSnap = await getDoc(doc(db, DEPT_TASKS_COLLECTION, deptTaskId));
      if (!taskSnap.exists()) {
        showToast(toast, "Task not found.", "error");
        return;
      }
      const task = taskSnap.data();
      if (!Array.isArray(task.assigneeUserIds) || !task.assigneeUserIds.includes(userId)) {
        showToast(toast, "You are not assigned to this task.", "error");
        return;
      }

      await saveAlumniContact({
        ...data,
        department: task.department || currentSession.department || "",
        team: task.team || currentSession.team || "",
        deptTaskId,
        parentTaskId: task.parentTaskId || "",
        taskTitle: task.title || "Alumni Connect",
        feeAmount: Number(cachedRegistration?.feeAmount) || 0,
        feeCurrency: cachedRegistration?.feeCurrency || "INR",
        membersAttending: normalizeMembersAttending(data.membersAttending),
        createdByUserId: userId,
        createdByName: currentSession.displayName || currentSession.username,
      });

      showToast(toast, "Alumni contact saved.", "success");
      resetAlumniContactForm(currentSession, { ...task, id: deptTaskId });
      document.getElementById("acDeptTaskId").value = deptTaskId;
      await loadMyContacts(currentSession, deptTaskId);
    } catch (err) {
      console.error(err);
      const msg =
        err.code === "permission-denied"
          ? "Permission denied. Republish firestore.rules in Firebase Console."
          : contactId
            ? "Failed to update contact."
            : "Failed to save contact.";
      showToast(toast, msg, "error");
    }
  });
}

async function loadMyContacts(session, deptTaskId) {
  const wrap = document.getElementById("myContactsWrap");
  if (!wrap) return;
  try {
    const contacts = await loadContactsByVolunteer(resolveUserId(session), deptTaskId);
    cachedMyContacts = contacts;
    wrap.innerHTML = contactsTableHtml(contacts, {
      editable: true,
      inlineStatus: true,
      showMembers: true,
      feeSettings: cachedRegistration,
      minimal: true,
    });

    wrap.querySelectorAll("[data-edit-contact]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const contact = cachedMyContacts.find((c) => c.id === btn.dataset.editContact);
        if (!contact) return;
        fillAlumniContactFormForEdit(contact);
      });
    });

    const refreshMembersUi = (contact) => {
      const cell = wrap.querySelector(`[data-members-cell="${contact.id}"]`);
      const input = wrap.querySelector(`[data-members-input][data-contact-id="${contact.id}"]`);
      const hint = wrap.querySelector(`[data-members-hint="${contact.id}"]`);
      const due = isRegistrationDue(contact.registrationStatus);
      if (cell) cell.classList.toggle("members-cell--muted", !due);
      if (input) {
        input.disabled = !due;
        input.value = String(contactMembersAttending(contact));
      }
      wrap.querySelectorAll(`[data-members-delta][data-contact-id="${contact.id}"]`).forEach((btn) => {
        btn.disabled = !due;
      });
      if (hint) {
        hint.textContent = due
          ? membersFeeHintText(contact, cachedRegistration)
          : "Set registration first";
      }
    };

    const persistContactPatch = async (contact, patch, { successMessage } = {}) => {
      const result = await requireAuth([ROLES.STUDENT]);
      if (!result?.session) {
        showToast(toast, "Session expired. Please sign in again.", "error");
        window.location.href = "../login.html";
        return false;
      }
      currentSession = result.session;
      const userId = resolveUserId(currentSession);
      if (contact.createdByUserId !== userId) {
        showToast(toast, "You can only update contacts you recorded.", "error");
        return false;
      }

      await updateAlumniContact(contact.id, {
        alumniName: contact.alumniName,
        email: contact.email || "",
        whatsapp: contact.whatsapp || "",
        mobile: contact.mobile || "",
        address: contact.address || "",
        company: contact.company || "",
        jobSector: contact.jobSector || "",
        batch: contact.batch || "",
        willingness: contact.willingness || "undecided",
        registrationStatus: contact.registrationStatus || "not_registered",
        membersAttending: contactMembersAttending(contact),
        notes: contact.notes || "",
        department: contact.department || currentSession.department || "",
        team: contact.team || currentSession.team || "",
        deptTaskId: contact.deptTaskId || "",
        parentTaskId: contact.parentTaskId || "",
        taskTitle: contact.taskTitle || "Alumni Connect",
        feeAmount: Number(contact.feeAmount ?? cachedRegistration?.feeAmount) || 0,
        feeCurrency: contact.feeCurrency || cachedRegistration?.feeCurrency || "INR",
        createdByUserId: contact.createdByUserId,
        createdByName: contact.createdByName || currentSession.displayName || currentSession.username,
        ...patch,
      });

      Object.assign(contact, patch);
      if (editingContact?.id === contact.id) {
        Object.assign(editingContact, patch);
        if (patch.willingness != null) {
          const el = document.getElementById("acWillingness");
          if (el) el.value = patch.willingness;
        }
        if (patch.registrationStatus != null) {
          const el = document.getElementById("acRegistration");
          if (el) el.value = patch.registrationStatus;
        }
        if (patch.membersAttending != null) {
          const el = document.getElementById("acMembers");
          if (el) {
            el.value = String(normalizeMembersAttending(patch.membersAttending));
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
      }
      if (successMessage) showToast(toast, successMessage, "success");
      return true;
    };

    wrap.querySelectorAll(".table-status-select").forEach((select) => {
      select.addEventListener("change", async () => {
        const contactId = select.dataset.contactId;
        const field = select.dataset.statusField;
        const value = select.value;
        const contact = cachedMyContacts.find((c) => c.id === contactId);
        if (!contact || !field) return;

        const previous = contact[field];
        select.disabled = true;
        try {
          const patch = { [field]: value };
          if (
            field === "registrationStatus" &&
            isRegistrationDue(value) &&
            !isRegistrationDue(previous)
          ) {
            patch.membersAttending = contactMembersAttending(contact);
          }
          const ok = await persistContactPatch(contact, patch, {
            successMessage:
              field === "willingness" ? "Willingness updated." : "Registration status updated.",
          });
          if (!ok) {
            select.value = previous;
            return;
          }
          const toneKind = field === "willingness" ? "willingness" : "registration";
          select.className = statusSelectClass(toneKind, value);
          if (field === "registrationStatus") refreshMembersUi(contact);
        } catch (err) {
          console.error(err);
          select.value = previous;
          showToast(toast, "Failed to update status.", "error");
        } finally {
          select.disabled = false;
        }
      });
    });

    const saveMembers = async (contact, rawValue, { quiet } = {}) => {
      if (!isRegistrationDue(contact.registrationStatus)) {
        refreshMembersUi(contact);
        showToast(toast, "Set registration to pending or paid first.", "error");
        return;
      }
      const membersAttending = normalizeMembersAttending(rawValue);
      if (membersAttending === contactMembersAttending(contact) && quiet) {
        refreshMembersUi(contact);
        return;
      }
      try {
        const ok = await persistContactPatch(
          contact,
          { membersAttending },
          { successMessage: quiet ? "" : "Members attending updated." }
        );
        if (!ok) {
          refreshMembersUi(contact);
          return;
        }
        refreshMembersUi(contact);
      } catch (err) {
        console.error(err);
        refreshMembersUi(contact);
        showToast(toast, "Failed to update members.", "error");
      }
    };

    wrap.querySelectorAll("[data-members-delta]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const contact = cachedMyContacts.find((c) => c.id === btn.dataset.contactId);
        if (!contact) return;
        const delta = Number(btn.dataset.membersDelta) || 0;
        const next = normalizeMembersAttending(contactMembersAttending(contact) + delta);
        btn.disabled = true;
        await saveMembers(contact, next);
        btn.disabled = !isRegistrationDue(contact.registrationStatus);
      });
    });

    wrap.querySelectorAll("[data-members-input]").forEach((input) => {
      input.addEventListener("change", async () => {
        const contact = cachedMyContacts.find((c) => c.id === input.dataset.contactId);
        if (!contact) return;
        input.disabled = true;
        await saveMembers(contact, input.value);
        input.disabled = !isRegistrationDue(contact.registrationStatus);
      });
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Failed to load contacts.</p>';
  }
}
