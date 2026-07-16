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
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { hashPassword } from "../js/crypto.js";
import { uploadImages, deleteImage } from "../js/storage.js";
import {
  requireAuth,
  logout,
  initAuthGuard,
  withSession,
} from "../js/auth.js";
import {
  ROLES,
  ROLE_LABELS,
  DEPARTMENTS,
  DEFAULT_MEETUP,
  DEFAULT_TEAMS,
  USERS_COLLECTION,
  REGISTRY_DOC,
  MAIN_TASKS_COLLECTION,
  TEAMS_DOC,
  normalizeUsername,
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
import {
  loadTeams,
  saveTeams,
  teamLabel,
  slugifyTeamId,
  validateVolunteerRow,
} from "../js/teams.js";
import {
  downloadVolunteerTemplate,
  parseVolunteerExcel,
} from "../js/volunteers-excel.js";

const toast = document.getElementById("toast");
let editingEventId = null;
let eventPhotos = [];
let cachedTeams = [];

initAuthGuard([ROLES.ADMIN], (session) => {
  initPortal(session);
});

function initPortal(session) {
  document.getElementById("adminName").textContent = session.displayName || "Administrator";
  setupNavigation();
  loadDashboard();
  setupMeetup();
  setupEvents();
  setupUsers();
  setupTeams();
  setupVolunteers();
  setupMainTasks();
  setupAccount(session);
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await logout();
    window.location.href = "../login.html";
  });
}

function setupAccount(session) {
  document.getElementById("accountPasswordCard").innerHTML = passwordFormHtml("admin");
  renderPasswordPrompt(document.getElementById("passwordPrompt"), session.mustChangePassword);
  document.getElementById("passwordPrompt")?.addEventListener("click", (e) => {
    if (e.target.matches("[data-goto-password]")) {
      document.querySelector('[data-panel="account"]')?.click();
    }
  });
  setupPasswordPanel({
    formId: "adminpasswordForm",
    toast,
    onSuccess: (updated) => {
      renderPasswordPrompt(document.getElementById("passwordPrompt"), updated.mustChangePassword);
    },
  });
}

function setupNavigation() {
  const titles = {
    dashboard: "Dashboard",
    meetup: "LEGECI",
    events: "Pre-Events",
    users: "Coordinators",
    volunteers: "Volunteers",
    teams: "Teams",
    tasks: "Tasks",
    account: "Account",
  };

  document.querySelectorAll(".portal-nav__link[data-panel]").forEach((link) => {
    link.addEventListener("click", () => {
      const panel = link.dataset.panel;
      document.querySelectorAll(".portal-nav__link[data-panel]").forEach((l) => l.classList.remove("portal-nav__link--active"));
      link.classList.add("portal-nav__link--active");
      document.querySelectorAll(".portal-panel").forEach((p) => p.classList.remove("portal-panel--active"));
      document.getElementById(`panel-${panel}`).classList.add("portal-panel--active");
      document.getElementById("pageTitle").textContent = titles[panel];
      document.getElementById("sidebar").classList.remove("portal-sidebar--open");
    });
  });

  document.getElementById("mobileToggle")?.addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("portal-sidebar--open");
  });

  document.getElementById("userRole").addEventListener("change", (e) => {
    const role = e.target.value;
    const needsDept = role === ROLES.FACULTY || role === ROLES.STUDENT;
    const needsTeam = role === ROLES.STUDENT;
    document.getElementById("userDepartment").required = needsDept;
    document.getElementById("teamGroup").hidden = !needsTeam;
    document.getElementById("userTeam").required = needsTeam;
  });
}

async function ensureAdminSession() {
  const session = await requireAuth([ROLES.ADMIN]);
  if (!session) {
    window.location.href = "../login.html";
    return null;
  }
  return session;
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

// ── Meetup ────────────────────────────────────────────
async function setupMeetup() {
  const form = document.getElementById("meetupForm");

  try {
    const snap = await getDoc(doc(db, "settings", "meetup"));
    if (snap.exists()) {
      const data = snap.data();
      document.getElementById("meetupTitle").value = data.title || "";
      document.getElementById("meetupTagline").value = data.tagline || "";
      document.getElementById("meetupDate").value = data.date || "";
      document.getElementById("meetupVenue").value = data.venue || "";
      document.getElementById("meetupDesc").value = data.description || "";
      document.getElementById("meetupPublished").checked = data.published !== false;
    } else {
      document.getElementById("meetupTitle").value = DEFAULT_MEETUP.title;
      document.getElementById("meetupTagline").value = DEFAULT_MEETUP.tagline;
      document.getElementById("meetupDate").value = DEFAULT_MEETUP.date;
      document.getElementById("meetupVenue").value = DEFAULT_MEETUP.venue;
      document.getElementById("meetupDesc").value = DEFAULT_MEETUP.description;
      document.getElementById("meetupPublished").checked = DEFAULT_MEETUP.published;
    }
  } catch (err) {
    console.error(err);
    document.getElementById("meetupTitle").value = DEFAULT_MEETUP.title;
    document.getElementById("meetupTagline").value = DEFAULT_MEETUP.tagline;
    document.getElementById("meetupDate").value = DEFAULT_MEETUP.date;
    document.getElementById("meetupVenue").value = DEFAULT_MEETUP.venue;
    document.getElementById("meetupDesc").value = DEFAULT_MEETUP.description;
    document.getElementById("meetupPublished").checked = DEFAULT_MEETUP.published;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!(await ensureAdminSession())) return;

    try {
      await setDoc(doc(db, "settings", "meetup"), withSession({
        title: document.getElementById("meetupTitle").value.trim(),
        tagline: document.getElementById("meetupTagline").value.trim(),
        date: document.getElementById("meetupDate").value,
        venue: document.getElementById("meetupVenue").value.trim(),
        description: document.getElementById("meetupDesc").value.trim(),
        published: document.getElementById("meetupPublished").checked,
        updatedAt: serverTimestamp(),
      }));
      showToast(toast, "LEGECI details saved.", "success");
      loadDashboard();
    } catch (err) {
      console.error(err);
      const msg = err.code === "permission-denied"
        ? "Permission denied. Republish firestore.rules in Firebase Console, then sign out and sign in again."
        : "Failed to save LEGECI details.";
      showToast(toast, msg, "error");
    }
  });
}

// ── Pre-Events ────────────────────────────────────────
function setupEvents() {
  loadEventsTable();
  renderEventPhotoPreview();

  document.getElementById("eventPhotos").addEventListener("change", () => {
    renderEventPhotoPreview();
  });

  document.getElementById("eventForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!(await ensureAdminSession())) return;

    const submitBtn = document.getElementById("eventSubmitBtn");
    submitBtn.disabled = true;

    try {
      const newFiles = [...document.getElementById("eventPhotos").files];
      let eventId = editingEventId || doc(collection(db, "pre_events")).id;

      let photos = [...eventPhotos];
      if (newFiles.length) {
        const uploaded = await uploadImages(`pre_events/${eventId}`, newFiles);
        photos = photos.concat(uploaded.map((u) => ({ url: u.url, path: u.path })));
      }

      const data = withSession({
        title: document.getElementById("eventTitle").value.trim(),
        date: document.getElementById("eventDate").value,
        time: document.getElementById("eventTime").value.trim(),
        venue: document.getElementById("eventVenue").value.trim(),
        description: document.getElementById("eventDesc").value.trim(),
        photos,
        published: document.getElementById("eventPublished").checked,
        updatedAt: serverTimestamp(),
      });

      if (editingEventId) {
        await updateDoc(doc(db, "pre_events", editingEventId), data);
        showToast(toast, "Pre-event updated.", "success");
        resetEventForm();
      } else {
        data.createdAt = serverTimestamp();
        await setDoc(doc(db, "pre_events", eventId), data);
        showToast(toast, "Pre-event added.", "success");
        e.target.reset();
        document.getElementById("eventPublished").checked = true;
        eventPhotos = [];
        renderEventPhotoPreview();
      }
      loadEventsTable();
      loadDashboard();
    } catch (err) {
      console.error(err);
      const msg = err.code === "permission-denied" || err.message === "NO_SESSION"
        ? "Upload failed — check Storage rules and sign in again."
        : err.message || "Failed to save pre-event.";
      showToast(toast, msg, "error");
    } finally {
      submitBtn.disabled = false;
    }
  });

  document.getElementById("eventCancelBtn").addEventListener("click", resetEventForm);
}

function renderEventPhotoPreview() {
  const wrap = document.getElementById("eventPhotoPreview");
  const fileInput = document.getElementById("eventPhotos");
  let html = "";

  eventPhotos.forEach((photo, i) => {
    html += `
      <div class="photo-preview__item">
        <img src="${escapeHtml(photo.url)}" alt="Event photo">
        <button type="button" class="photo-preview__remove" data-existing="${i}">&times;</button>
      </div>`;
  });

  [...fileInput.files].forEach((file, i) => {
    const url = URL.createObjectURL(file);
    html += `
      <div class="photo-preview__item">
        <img src="${url}" alt="New upload">
        <button type="button" class="photo-preview__remove" data-new="${i}">&times;</button>
      </div>`;
  });

  wrap.innerHTML = html;

  wrap.querySelectorAll("[data-existing]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.existing);
      const photo = eventPhotos[idx];
      if (photo?.path) await deleteImage(photo.path);
      eventPhotos.splice(idx, 1);
      renderEventPhotoPreview();
    });
  });

  wrap.querySelectorAll("[data-new]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dt = new DataTransfer();
      const files = [...fileInput.files];
      files.splice(Number(btn.dataset.new), 1);
      files.forEach((f) => dt.items.add(f));
      fileInput.files = dt.files;
      renderEventPhotoPreview();
    });
  });
}

function resetEventForm() {
  editingEventId = null;
  eventPhotos = [];
  document.getElementById("eventForm").reset();
  document.getElementById("eventPublished").checked = true;
  document.getElementById("eventSubmitBtn").textContent = "Add Pre-Event";
  document.getElementById("eventCancelBtn").hidden = true;
  renderEventPhotoPreview();
}

async function loadEventsTable() {
  const wrap = document.getElementById("eventsTableWrap");
  try {
    const q = query(collection(db, "pre_events"), orderBy("date", "asc"));
    const snap = await getDocs(q);

    const events = snap.docs.filter((d) => !d.data()._deleted);

    if (events.length === 0) {
      wrap.innerHTML = '<p class="empty-state">No pre-events yet. Add one above.</p>';
      return;
    }

    const rows = events
      .map((d) => {
        const e = d.data();
        return `
          <tr>
            <td><strong>${escapeHtml(e.title)}</strong></td>
            <td>${escapeHtml(formatDateShort(e.date))}</td>
            <td>${escapeHtml(e.time || "—")}</td>
            <td>${escapeHtml(e.venue || "—")}</td>
            <td>${(e.photos || []).length} photo(s)</td>
            <td><span class="badge ${e.published ? "badge--published" : "badge--draft"}">${e.published ? "Published" : "Draft"}</span></td>
            <td class="table-actions">
              <button class="btn btn--ghost btn--sm" data-edit="${d.id}">Edit</button>
              <button class="btn btn--danger btn--sm" data-delete="${d.id}">Delete</button>
            </td>
          </tr>`;
      })
      .join("");

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Title</th><th>Date</th><th>Time</th><th>Venue</th><th>Photos</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    wrap.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => editEvent(btn.dataset.edit, events));
    });
    wrap.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteEvent(btn.dataset.delete));
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Failed to load pre-events.</p>';
  }
}

function editEvent(id, docs) {
  const docSnap = docs.find((d) => d.id === id);
  if (!docSnap) return;
  const e = docSnap.data();
  editingEventId = id;
  document.getElementById("eventTitle").value = e.title || "";
  document.getElementById("eventDate").value = e.date || "";
  document.getElementById("eventTime").value = e.time || "";
  document.getElementById("eventVenue").value = e.venue || "";
  document.getElementById("eventDesc").value = e.description || "";
  document.getElementById("eventPublished").checked = e.published !== false;
  eventPhotos = e.photos || [];
  renderEventPhotoPreview();
  document.getElementById("eventSubmitBtn").textContent = "Update Pre-Event";
  document.getElementById("eventCancelBtn").hidden = false;
  document.querySelector('[data-panel="events"]').click();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteEvent(id) {
  if (!confirm("Delete this pre-event?")) return;
  if (!(await ensureAdminSession())) return;

  try {
    await updateDoc(doc(db, "pre_events", id), withSession({
      _deleted: true,
      updatedAt: serverTimestamp(),
    }));
    showToast(toast, "Pre-event deleted.", "success");
    loadEventsTable();
    loadDashboard();
  } catch (err) {
    showToast(toast, "Failed to delete.", "error");
  }
}

// ── Users ─────────────────────────────────────────────
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

function setupUsers() {
  loadUsersTable();

  document.getElementById("userForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!(await ensureAdminSession())) return;

    const displayName = document.getElementById("userName").value.trim();
    const username = document.getElementById("userUsername").value.trim().toLowerCase();
    const role = document.getElementById("userRole").value;
    const department = document.getElementById("userDepartment").value;
    const team = document.getElementById("userTeam").value;
    const password = document.getElementById("userPassword").value;
    const userId = normalizeUsername(username);

    if ((role === ROLES.FACULTY || role === ROLES.STUDENT) && !department) {
      showToast(toast, "Department is required for this role.", "error");
      return;
    }

    if (role === ROLES.STUDENT && !team) {
      showToast(toast, "Team is required for student volunteers.", "error");
      return;
    }

    if (password.length < 8) {
      showToast(toast, "Password must be at least 8 characters.", "error");
      return;
    }

    const existing = await getDoc(doc(db, USERS_COLLECTION, userId));
    if (existing.exists()) {
      showToast(toast, "Username already exists.", "error");
      return;
    }

    try {
      const { passwordHash, salt } = await hashPassword(password);
      const deptValue =
        role === ROLES.FACULTY || role === ROLES.STUDENT ? department : "";
      const teamValue = role === ROLES.STUDENT ? team : "";

      await setDoc(doc(db, USERS_COLLECTION, userId), withSession({
        username,
        displayName,
        role,
        department: deptValue,
        team: teamValue,
        passwordHash,
        salt,
        active: true,
        mustChangePassword: true,
        createdAt: serverTimestamp(),
      }));

      const registry = await getRegistry();
      registry.push({
        userId,
        username,
        displayName,
        role,
        department: deptValue,
        team: teamValue,
        active: true,
      });
      await saveRegistry(registry);

      showToast(toast, `Account created for ${displayName}. Ask them to change the temporary password after login.`, "success");
      e.target.reset();
      document.getElementById("teamGroup").hidden = true;
      loadUsersTable();
      loadVolunteersTable();
    } catch (err) {
      console.error(err);
      showToast(toast, "Failed to create account.", "error");
    }
  });
}

async function loadUsersTable() {
  const wrap = document.getElementById("usersTableWrap");
  try {
    const roleOrder = [
      ROLES.PRINCIPAL,
      ROLES.DEAN,
      ROLES.SECRETARY,
      ROLES.JOINT_SECRETARY,
      ROLES.TREASURER,
      ROLES.FACULTY,
      ROLES.STUDENT,
    ];
    const deptOrder = DEPARTMENTS.map((d) => d.value);

    const users = (await getRegistry())
      .filter((u) => u.role !== ROLES.ADMIN && u.role !== ROLES.STUDENT)
      .sort((a, b) => {
        const roleA = roleOrder.indexOf(a.role);
        const roleB = roleOrder.indexOf(b.role);
        const roleCmp = (roleA === -1 ? 99 : roleA) - (roleB === -1 ? 99 : roleB);
        if (roleCmp !== 0) return roleCmp;

        const deptA = a.department ? deptOrder.indexOf(a.department) : 99;
        const deptB = b.department ? deptOrder.indexOf(b.department) : 99;
        const deptCmp = (deptA === -1 ? 99 : deptA) - (deptB === -1 ? 99 : deptB);
        if (deptCmp !== 0) return deptCmp;

        return (a.displayName || "").localeCompare(b.displayName || "");
      });

    if (users.length === 0) {
      wrap.innerHTML = '<p class="empty-state">No coordinator accounts yet.</p>';
      return;
    }

    const rows = users
      .map(
        (u) => `
        <tr>
          <td><strong>${escapeHtml(u.displayName)}</strong><br><small style="color:var(--slate-500)">${escapeHtml(u.username)}</small></td>
          <td><span class="badge badge--role">${escapeHtml(ROLE_LABELS[u.role] || u.role)}</span></td>
          <td>${escapeHtml(u.department || "—")}</td>
          <td><span class="badge ${u.active !== false ? "badge--published" : "badge--inactive"}">${u.active !== false ? "Active" : "Inactive"}</span></td>
          <td class="table-actions">
            <button class="btn btn--ghost btn--sm" data-toggle="${u.userId}" data-active="${u.active !== false}">
              ${u.active !== false ? "Deactivate" : "Activate"}
            </button>
          </td>
        </tr>`
      )
      .join("");

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Name / Username</th><th>Role</th><th>Department</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    wrap.querySelectorAll("[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await ensureAdminSession())) return;
        const active = btn.dataset.active === "true";
        const userId = btn.dataset.toggle;

        await updateDoc(doc(db, USERS_COLLECTION, userId), withSession({ active: !active }));

        const registry = await getRegistry();
        const idx = registry.findIndex((u) => u.userId === userId);
        if (idx >= 0) {
          registry[idx].active = !active;
          await saveRegistry(registry);
        }

        showToast(toast, active ? "Account deactivated." : "Account activated.", "success");
        loadUsersTable();
        loadVolunteersTable();
      });
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Failed to load users.</p>';
  }
}

// ── Teams ─────────────────────────────────────────────
async function refreshTeamSelects() {
  cachedTeams = await loadTeams();
  const select = document.getElementById("userTeam");
  if (select) {
    const current = select.value;
    select.innerHTML = '<option value="">Select team</option>' +
      cachedTeams
        .filter((t) => t.active !== false)
        .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)
        .join("");
    select.value = current;
  }
  renderTaskTeamCheckboxes();
}

function renderTaskTeamCheckboxes() {
  const wrap = document.getElementById("taskTeamsWrap");
  if (!wrap) return;

  const activeTeams = cachedTeams.filter((t) => t.active !== false);
  if (!activeTeams.length) {
    wrap.innerHTML = '<p class="form-hint">No teams configured. Add teams under Teams first.</p>';
    return;
  }

  wrap.innerHTML = activeTeams
    .map(
      (t) => `
      <label class="checkbox-label">
        <input type="checkbox" name="taskTeam" value="${escapeHtml(t.id)}">
        ${escapeHtml(t.name)}
      </label>`
    )
    .join("");
}

function getSelectedTaskTeams() {
  return [...document.querySelectorAll('input[name="taskTeam"]:checked')].map((el) => el.value);
}

function formatTaskTeamList(teams, teamIds) {
  if (!teamIds?.length) return "All teams";
  return teamIds.map((id) => teamLabel(teams, id)).join(", ");
}

function setupTeams() {
  refreshTeamSelects().then(loadTeamsTable);

  // Ensure defaults exist in Firestore once
  loadTeams().then(async (teams) => {
    const snap = await getDoc(doc(db, "settings", TEAMS_DOC));
    if (!snap.exists()) {
      try {
        await saveTeams(DEFAULT_TEAMS.map((t) => ({ ...t })));
        cachedTeams = DEFAULT_TEAMS.map((t) => ({ ...t }));
        loadTeamsTable();
      } catch (err) {
        console.error(err);
      }
    }
  });

  document.getElementById("teamForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!(await ensureAdminSession())) return;

    const name = document.getElementById("teamName").value.trim();
    let id = document.getElementById("teamId").value.trim().toLowerCase() || slugifyTeamId(name);
    id = slugifyTeamId(id);

    if (!name || !id) {
      showToast(toast, "Team name is required.", "error");
      return;
    }

    const teams = await loadTeams();
    if (teams.some((t) => t.id === id)) {
      showToast(toast, "Team ID already exists.", "error");
      return;
    }

    teams.push({ id, name, active: true });
    try {
      await saveTeams(teams);
      showToast(toast, `Team "${name}" added.`, "success");
      e.target.reset();
      await refreshTeamSelects();
      loadTeamsTable();
    } catch (err) {
      console.error(err);
      showToast(toast, "Failed to save team.", "error");
    }
  });
}

async function loadTeamsTable() {
  const wrap = document.getElementById("teamsTableWrap");
  try {
    const teams = await loadTeams();
    cachedTeams = teams;
    if (!teams.length) {
      wrap.innerHTML = '<p class="empty-state">No teams configured.</p>';
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Team</th><th>ID (for Excel)</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${teams
            .map(
              (t) => `
            <tr>
              <td><strong>${escapeHtml(t.name)}</strong></td>
              <td><code>${escapeHtml(t.id)}</code></td>
              <td><span class="badge ${t.active !== false ? "badge--published" : "badge--inactive"}">${t.active !== false ? "Active" : "Inactive"}</span></td>
              <td class="table-actions">
                <button class="btn btn--ghost btn--sm" data-toggle-team="${escapeHtml(t.id)}" data-active="${t.active !== false}">
                  ${t.active !== false ? "Deactivate" : "Activate"}
                </button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`;

    wrap.querySelectorAll("[data-toggle-team]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await ensureAdminSession())) return;
        const id = btn.dataset.toggleTeam;
        const teams = await loadTeams();
        const idx = teams.findIndex((t) => t.id === id);
        if (idx < 0) return;
        teams[idx].active = !(teams[idx].active !== false);
        await saveTeams(teams);
        await refreshTeamSelects();
        loadTeamsTable();
        showToast(toast, "Team updated.", "success");
      });
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Failed to load teams.</p>';
  }
}

// ── Volunteers Excel ────────────────────────────────────
function setupVolunteers() {
  loadVolunteersTable();

  document.getElementById("downloadVolunteerTemplateBtn").addEventListener("click", async () => {
    try {
      const teams = await loadTeams();
      await downloadVolunteerTemplate(teams);
      showToast(toast, "Excel template downloaded.", "success");
    } catch (err) {
      console.error("Volunteer template download failed:", err);
      showToast(toast, err?.message || "Could not generate template. Try again.", "error");
    }
  });

  document.getElementById("uploadVolunteersBtn").addEventListener("click", async () => {
    if (!(await ensureAdminSession())) return;

    const file = document.getElementById("volunteerExcel").files[0];
    const resultEl = document.getElementById("volunteerUploadResult");
    if (!file) {
      showToast(toast, "Please choose an Excel file.", "error");
      return;
    }

    let rows;
    try {
      rows = await parseVolunteerExcel(file);
    } catch (err) {
      console.error(err);
      showToast(toast, "Could not read Excel file.", "error");
      return;
    }

    if (!rows.length) {
      showToast(toast, "Excel has no data rows.", "error");
      return;
    }

    const teams = await loadTeams();
    const registry = await getRegistry();
    let created = 0;
    let skipped = 0;
    const messages = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowLabel = `Row ${i + 2}`;
      const { errors, data } = validateVolunteerRow(row, teams);
      if (errors.length) {
        skipped++;
        messages.push(`${rowLabel} (${data.mobile || data.fullName || "unknown"}): ${errors.join("; ")}`);
        continue;
      }

      const userId = normalizeUsername(data.username);
      const existing = await getDoc(doc(db, USERS_COLLECTION, userId));
      if (existing.exists() || registry.some((u) => u.userId === userId || u.username === data.username)) {
        skipped++;
        messages.push(`${rowLabel} ${data.mobile}: already exists`);
        continue;
      }

      try {
        const { passwordHash, salt } = await hashPassword(data.password);
        await setDoc(doc(db, USERS_COLLECTION, userId), withSession({
          username: data.username,
          displayName: data.fullName,
          role: ROLES.STUDENT,
          department: data.department,
          team: data.team,
          mobile: data.mobile,
          passwordHash,
          salt,
          active: true,
          mustChangePassword: true,
          createdAt: serverTimestamp(),
        }));

        registry.push({
          userId,
          username: data.username,
          displayName: data.fullName,
          role: ROLES.STUDENT,
          department: data.department,
          team: data.team,
          mobile: data.mobile,
          active: true,
        });
        created++;
      } catch (err) {
        skipped++;
        messages.push(`${rowLabel} ${data.mobile}: ${err.message || "failed"}`);
      }
    }

    await saveRegistry(registry);
    loadVolunteersTable();
    loadUsersTable();

    resultEl.innerHTML = `
      <p><strong>Created:</strong> ${created} &nbsp;|&nbsp; <strong>Skipped:</strong> ${skipped}</p>
      ${messages.length ? `<ul style="margin-top:0.75rem;color:var(--slate-500);font-size:0.85rem;">${messages.slice(0, 20).map((m) => `<li>${escapeHtml(m)}</li>`).join("")}${messages.length > 20 ? "<li>…</li>" : ""}</ul>` : ""}`;

    showToast(toast, `Volunteer upload finished. Created ${created}.`, created ? "success" : "error");
  });
}

async function loadVolunteersTable() {
  const wrap = document.getElementById("volunteersTableWrap");
  try {
    const teams = await loadTeams();
    const deptOrder = DEPARTMENTS.map((d) => d.value);
    const volunteers = (await getRegistry())
      .filter((u) => u.role === ROLES.STUDENT)
      .sort((a, b) => {
        const deptCmp =
          (a.department ? deptOrder.indexOf(a.department) : 99) -
          (b.department ? deptOrder.indexOf(b.department) : 99);
        if (deptCmp !== 0) return deptCmp;
        const teamCmp = (a.team || "").localeCompare(b.team || "");
        if (teamCmp !== 0) return teamCmp;
        return (a.displayName || "").localeCompare(b.displayName || "");
      });

    if (!volunteers.length) {
      wrap.innerHTML = '<p class="empty-state">No student volunteers yet. Upload an Excel file or create one under Coordinators.</p>';
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Name / Mobile</th><th>Department</th><th>Team</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${volunteers
            .map(
              (u) => `
            <tr>
              <td><strong>${escapeHtml(u.displayName)}</strong><br><small style="color:var(--slate-500)">${escapeHtml(u.mobile || u.username)}</small></td>
              <td>${escapeHtml(u.department || "—")}</td>
              <td><span class="badge badge--role">${escapeHtml(teamLabel(teams, u.team))}</span></td>
              <td><span class="badge ${u.active !== false ? "badge--published" : "badge--inactive"}">${u.active !== false ? "Active" : "Inactive"}</span></td>
              <td class="table-actions">
                <button class="btn btn--ghost btn--sm" data-toggle-vol="${u.userId}" data-active="${u.active !== false}">
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
        if (!(await ensureAdminSession())) return;
        const active = btn.dataset.active === "true";
        const userId = btn.dataset.toggleVol;
        await updateDoc(doc(db, USERS_COLLECTION, userId), withSession({ active: !active }));
        const registry = await getRegistry();
        const idx = registry.findIndex((u) => u.userId === userId);
        if (idx >= 0) {
          registry[idx].active = !active;
          await saveRegistry(registry);
        }
        loadVolunteersTable();
        showToast(toast, active ? "Volunteer deactivated." : "Volunteer activated.", "success");
      });
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Failed to load volunteers.</p>';
  }
}

// ── Main Tasks ────────────────────────────────────────
function setupMainTasks() {
  refreshTeamSelects();
  loadMainTasksTable();

  document.getElementById("mainTaskForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!(await ensureAdminSession())) return;

    const title = document.getElementById("taskTitle").value.trim();
    const description = document.getElementById("taskDescription").value.trim();
    const dueDate = document.getElementById("taskDueDate").value;
    const status = document.getElementById("taskStatus").value;
    const teams = getSelectedTaskTeams();

    try {
      await addDoc(collection(db, MAIN_TASKS_COLLECTION), withSession({
        title,
        description,
        dueDate,
        status,
        teams,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
      showToast(toast, "Main task created.", "success");
      e.target.reset();
      renderTaskTeamCheckboxes();
      loadMainTasksTable();
    } catch (err) {
      console.error(err);
      showToast(toast, "Failed to create task.", "error");
    }
  });
}

async function loadMainTasksTable() {
  const wrap = document.getElementById("mainTasksTableWrap");
  try {
    const teams = await loadTeams();
    cachedTeams = teams;
    const q = query(collection(db, MAIN_TASKS_COLLECTION), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    const tasks = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => !t._deleted);

    if (!tasks.length) {
      wrap.innerHTML = '<p class="empty-state">No main tasks yet.</p>';
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Title</th><th>Teams</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${tasks
            .map(
              (t) => `
            <tr>
              <td>
                <strong>${escapeHtml(t.title)}</strong>
                ${t.description ? `<br><small style="color:var(--slate-500)">${escapeHtml(t.description)}</small>` : ""}
              </td>
              <td>${escapeHtml(formatTaskTeamList(teams, t.teams))}</td>
              <td>${escapeHtml(formatDateShort(t.dueDate) || "—")}</td>
              <td><span class="badge badge--role">${escapeHtml(t.status || "open")}</span></td>
              <td class="table-actions">
                <button class="btn btn--danger btn--sm" data-delete-task="${t.id}">Delete</button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`;

    wrap.querySelectorAll("[data-delete-task]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this main task?")) return;
        if (!(await ensureAdminSession())) return;
        await updateDoc(doc(db, MAIN_TASKS_COLLECTION, btn.dataset.deleteTask), withSession({
          _deleted: true,
          updatedAt: serverTimestamp(),
        }));
        loadMainTasksTable();
        showToast(toast, "Task deleted.", "success");
      });
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Failed to load tasks.</p>';
  }
}
