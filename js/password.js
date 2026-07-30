import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { hashPassword, verifyPassword } from "./crypto.js";
import { getSession, withSession } from "./auth.js";
import {
  USERS_COLLECTION,
  SESSIONS_COLLECTION,
  SESSION_KEY,
  normalizeUsername,
} from "./constants.js";

export async function changePassword(currentPassword, newPassword) {
  const session = getSession();
  if (!session) throw new Error("NO_SESSION");

  if (!newPassword || newPassword.length < 8) {
    throw new Error("WEAK_PASSWORD");
  }

  if (currentPassword === newPassword) {
    throw new Error("SAME_PASSWORD");
  }

  const userId = normalizeUsername(session.username);
  const userRef = doc(db, USERS_COLLECTION, userId);
  const snap = await getDoc(userRef);

  if (!snap.exists()) throw new Error("USER_NOT_FOUND");

  const user = snap.data();
  const valid = await verifyPassword(currentPassword, user.passwordHash, user.salt);
  if (!valid) throw new Error("WRONG_PASSWORD");

  const { passwordHash, salt } = await hashPassword(newPassword);

  await updateDoc(
    userRef,
    withSession({
      passwordHash,
      salt,
      mustChangePassword: false,
      passwordChangedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // Best-effort: clear the prompt flag on the active session document
  try {
    if (session.sessionId) {
      await updateDoc(doc(db, SESSIONS_COLLECTION, session.sessionId), {
        mustChangePassword: false,
      });
    }
  } catch {
    // Session docs are not updatable under current rules; local session is enough
  }

  const updated = {
    ...session,
    mustChangePassword: false,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated));
  return updated;
}

export function getPasswordErrorMessage(error) {
  const map = {
    WRONG_PASSWORD: "Current password is incorrect.",
    WEAK_PASSWORD: "New password must be at least 8 characters.",
    SAME_PASSWORD: "New password must be different from the current password.",
    NO_SESSION: "Your session expired. Please sign in again.",
    USER_NOT_FOUND: "Account not found. Please contact the administrator.",
  };
  if (error?.code === "permission-denied") {
    return "Permission denied. Republish firestore.rules, then sign out and sign in again.";
  }
  return map[error?.message] || "Failed to change password. Please try again.";
}

export function setupPasswordPanel({ formId, toast, onSuccess }) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPassword = form.currentPassword.value;
    const newPassword = form.newPassword.value;
    const confirmPassword = form.confirmPassword.value;
    const submitBtn = form.querySelector('[type="submit"]');

    if (newPassword !== confirmPassword) {
      showLocalToast(toast, "New passwords do not match.", "error");
      return;
    }

    submitBtn.disabled = true;
    try {
      const session = await changePassword(currentPassword, newPassword);
      form.reset();
      showLocalToast(toast, "Password updated successfully.", "success");
      onSuccess?.(session);
    } catch (err) {
      console.error(err);
      showLocalToast(toast, getPasswordErrorMessage(err), "error");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function showLocalToast(toast, message, type) {
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast toast--visible${type ? ` toast--${type}` : ""}`;
  clearTimeout(showLocalToast._timer);
  showLocalToast._timer = setTimeout(() => {
    toast.classList.remove("toast--visible");
  }, 4000);
}

export function renderPasswordPrompt(container, mustChange) {
  if (!container) return;
  if (!mustChange) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }

  container.hidden = false;
  container.innerHTML = `
    <div class="password-prompt">
      <strong>Change your default password</strong>
      <p>For security, please update your temporary/default password from the Account section before continuing regular use.</p>
      <button type="button" class="btn btn--primary btn--sm" data-goto-password>Change Password Now</button>
    </div>`;
}

export function passwordFormHtml(prefix = "") {
  const id = (name) => `${prefix}${name}`;
  return `
    <div class="portal-card">
      <h2 class="portal-card__title">Change Password</h2>
      <p class="form-hint" style="margin-bottom:1.25rem;">
        Choose a strong password (at least 8 characters). Do not reuse the temporary password given by the administrator.
      </p>
      <form id="${id("passwordForm")}">
        <div class="form-group">
          <label for="${id("currentPassword")}">Current Password</label>
          <input type="password" id="${id("currentPassword")}" name="currentPassword" required autocomplete="current-password">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="${id("newPassword")}">New Password</label>
            <input type="password" id="${id("newPassword")}" name="newPassword" required minlength="8" autocomplete="new-password">
          </div>
          <div class="form-group">
            <label for="${id("confirmPassword")}">Confirm New Password</label>
            <input type="password" id="${id("confirmPassword")}" name="confirmPassword" required minlength="8" autocomplete="new-password">
          </div>
        </div>
        <button type="submit" class="btn btn--primary">Update Password</button>
      </form>
    </div>`;
}
