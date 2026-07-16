import { db } from "../js/firebase-config.js";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  addDoc,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { initAuthGuard, logout, withSession } from "../js/auth.js";
import {
  ROLES,
  ROLE_LABELS,
  DEPARTMENTS,
  DEFAULT_MEETUP,
  USERS_COLLECTION,
  REGISTRY_DOC,
  MAIN_TASKS_COLLECTION,
  DEPT_TASKS_COLLECTION,
  formatDateShort,
  escapeHtml,
  showToast,
} from "../js/constants.js";
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

const INSTITUTIONAL_ROLES = [
  ROLES.FACULTY,
  ROLES.STUDENT,
  ROLES.SECRETARY,
  ROLES.JOINT_SECRETARY,
  ROLES.PRINCIPAL,
  ROLES.DEAN,
  ROLES.TREASURER,
];

const toast = document.getElementById("toast");
let currentSession = null;
let cachedTeams = [];

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
    document.getElementById("deptNameLabel").textContent = session.department;
    setupDepartmentPanel(session);
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
    });
  });

  document.getElementById("mobileToggle")?.addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("portal-sidebar--open");
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
}

async function getRegistry() {
  const snap = await getDoc(doc(db, USERS_COLLECTION, REGISTRY_DOC));
  return snap.exists() ? snap.data().users || [] : [];
}

async function setupDepartmentPanel(session) {
  cachedTeams = await loadTeams();
  loadDeptVolunteers(session.department);
  loadDeptMainTasks(session);
  loadDeptTasks(session.department);
}

async function loadDeptVolunteers(department) {
  const wrap = document.getElementById("deptVolunteersWrap");
  try {
    const volunteers = (await getRegistry())
      .filter(
        (u) =>
          u.role === ROLES.STUDENT &&
          u.department === department &&
          u.active !== false
      )
      .sort((a, b) => (a.team || "").localeCompare(b.team || "") || (a.displayName || "").localeCompare(b.displayName || ""));

    if (!volunteers.length) {
      wrap.innerHTML = '<p class="empty-state">No volunteers assigned to your department yet.</p>';
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Name</th><th>Username</th><th>Team</th></tr></thead>
        <tbody>
          ${volunteers
            .map(
              (u) => `
            <tr>
              <td><strong>${escapeHtml(u.displayName)}</strong></td>
              <td>${escapeHtml(u.username)}</td>
              <td><span class="badge badge--role">${escapeHtml(teamLabel(cachedTeams, u.team))}</span></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`;
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
        <thead><tr><th>Task</th><th>Teams</th><th>Due</th><th>Assign to team</th><th></th></tr></thead>
        <tbody>
          ${tasks
            .map(
              (t) => {
                const options = teamOptionsForTask(t);
                return `
            <tr>
              <td>
                <strong>${escapeHtml(t.title)}</strong>
                ${t.description ? `<br><small style="color:var(--slate-500)">${escapeHtml(t.description)}</small>` : ""}
              </td>
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
              }
            )
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
          await addDoc(collection(db, DEPT_TASKS_COLLECTION), withSession({
            parentTaskId: taskId,
            title: task.title,
            description: task.description || "",
            dueDate: task.dueDate || "",
            department: session.department,
            team,
            status: "open",
            progress: 0,
            assigneeUserIds: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }));
          showToast(toast, "Task replicated for your department.", "success");
          loadDeptTasks(session.department);
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

async function loadDeptTasks(department) {
  const wrap = document.getElementById("deptTasksWrap");
  try {
    const snap = await getDocs(collection(db, DEPT_TASKS_COLLECTION));
    const tasks = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => !t._deleted && t.department === department)
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    if (!tasks.length) {
      wrap.innerHTML = '<p class="empty-state">No department tasks yet. Replicate a main task above.</p>';
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Task</th><th>Team</th><th>Status</th><th>Progress</th></tr></thead>
        <tbody>
          ${tasks
            .map(
              (t) => `
            <tr>
              <td><strong>${escapeHtml(t.title)}</strong></td>
              <td>${escapeHtml(teamLabel(cachedTeams, t.team))}</td>
              <td><span class="badge badge--role">${escapeHtml(t.status || "open")}</span></td>
              <td>${Number(t.progress || 0)}%</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <p class="form-hint" style="margin-top:0.75rem;">Detailed assignment and progress updates will be added in upcoming prompts.</p>`;
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Failed to load department tasks.</p>';
  }
}
