import { db } from "../js/firebase-config.js";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { initAuthGuard, logout } from "../js/auth.js";
import {
  ROLES,
  ROLE_LABELS,
  DEPARTMENTS,
  formatDate,
  formatDateShort,
  escapeHtml,
} from "../js/constants.js";
import {
  setupPasswordPanel,
  passwordFormHtml,
  renderPasswordPrompt,
} from "../js/password.js";

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

initAuthGuard(INSTITUTIONAL_ROLES, (session) => {
  initPortal(session);
});

function initPortal(session) {
  const deptLabel = session.department
    ? DEPARTMENTS.find((d) => d.value === session.department)?.label
    : null;

  document.getElementById("sidebarRole").textContent = ROLE_LABELS[session.role] || "Coordinator";
  document.getElementById("userName").textContent = session.displayName || session.username;
  document.getElementById("welcomeName").textContent = session.displayName || session.username;
  document.getElementById("roleLabel").textContent = ROLE_LABELS[session.role] || session.role;
  document.getElementById("deptLabel").textContent = deptLabel ? ` · ${deptLabel}` : "";

  setupNavigation();
  setupAccount(session);

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await logout();
    window.location.href = "../login.html";
  });

  loadMeetup();
  loadEvents();
}

function setupNavigation() {
  const titles = {
    dashboard: "Coordinator Dashboard",
    account: "Account",
  };

  document.querySelectorAll(".portal-nav__link[data-panel]").forEach((link) => {
    link.addEventListener("click", () => {
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

async function loadMeetup() {
  const el = document.getElementById("meetupInfo");
  try {
    const snap = await getDoc(doc(db, "settings", "meetup"));
    if (!snap.exists()) {
      el.innerHTML = '<p class="empty-state">Meetup details not configured yet.</p>';
      return;
    }
    const m = snap.data();
    el.innerHTML = `
      <h3 style="font-size:1.2rem;margin-bottom:0.5rem;color:var(--navy);">${escapeHtml(m.title)}</h3>
      <p style="color:var(--purple-700);font-weight:600;margin-bottom:0.5rem;">${escapeHtml(formatDate(m.date))}</p>
      <p style="color:var(--slate-500);margin-bottom:0.75rem;">📍 ${escapeHtml(m.venue || "TBA")}</p>
      <p style="color:var(--slate-700);line-height:1.7;">${escapeHtml(m.description || "")}</p>`;
  } catch {
    el.innerHTML = '<p class="empty-state">Unable to load meetup details.</p>';
  }
}

async function loadEvents() {
  const el = document.getElementById("eventsInfo");
  try {
    const q = query(collection(db, "pre_events"), orderBy("date", "asc"));
    const snap = await getDocs(q);

    if (snap.empty) {
      el.innerHTML = '<p class="empty-state">No pre-events scheduled yet.</p>';
      return;
    }

    el.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Event</th><th>Date</th><th>Time</th><th>Venue</th><th>Status</th></tr></thead>
        <tbody>
          ${snap.docs
            .filter((d) => !d.data()._deleted)
            .map((d) => {
              const e = d.data();
              return `<tr>
                <td><strong>${escapeHtml(e.title)}</strong></td>
                <td>${escapeHtml(formatDateShort(e.date))}</td>
                <td>${escapeHtml(e.time || "—")}</td>
                <td>${escapeHtml(e.venue || "—")}</td>
                <td><span class="badge ${e.published ? "badge--published" : "badge--draft"}">${e.published ? "Published" : "Draft"}</span></td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;
  } catch {
    el.innerHTML = '<p class="empty-state">Unable to load pre-events.</p>';
  }
}
