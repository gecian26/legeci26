import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { hashPassword, verifyPassword } from "./crypto.js";
import {
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  ROLES,
  SESSION_KEY,
  USERS_COLLECTION,
  SESSIONS_COLLECTION,
  normalizeUsername,
} from "./constants.js";

const SESSION_HOURS = 8;

export function getSession() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw);
    if (new Date(session.expiresAt) <= new Date()) {
      clearLocalSession();
      return null;
    }
    return session;
  } catch {
    clearLocalSession();
    return null;
  }
}

function clearLocalSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export async function login(username, password) {
  const trimmedUsername = username.trim().toLowerCase();
  const userId = normalizeUsername(trimmedUsername);
  const userRef = doc(db, USERS_COLLECTION, userId);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    if (trimmedUsername === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      const { passwordHash, salt } = await hashPassword(password);
      const adminUser = {
        username: ADMIN_USERNAME,
        displayName: "Administrator",
        role: ROLES.ADMIN,
        department: "",
        passwordHash,
        salt,
        active: true,
        mustChangePassword: true,
        createdAt: serverTimestamp(),
      };
      await setDoc(userRef, adminUser);
      return createSession(adminUser);
    }
    throw new Error("INVALID_CREDENTIALS");
  }

  const user = snap.data();
  if (user.active === false) throw new Error("INACTIVE");

  const valid = await verifyPassword(password, user.passwordHash, user.salt);
  if (!valid) throw new Error("INVALID_CREDENTIALS");

  return createSession(user);
}

async function createSession(user) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  const userId = normalizeUsername(user.username);

  const mustChangePassword =
    user.mustChangePassword === true || !user.passwordChangedAt;

  await setDoc(doc(db, SESSIONS_COLLECTION, sessionId), {
    userId,
    username: user.username,
    role: user.role,
    displayName: user.displayName || user.username,
    department: user.department || "",
    team: user.team || "",
    mustChangePassword,
    expiresAt: Timestamp.fromDate(expiresAt),
    createdAt: serverTimestamp(),
  });

  const session = {
    sessionId,
    username: user.username,
    role: user.role,
    displayName: user.displayName || user.username,
    department: user.department || "",
    team: user.team || "",
    mustChangePassword,
    expiresAt: expiresAt.toISOString(),
  };

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export async function logout() {
  const session = getSession();
  if (session?.sessionId) {
    try {
      await deleteDoc(doc(db, SESSIONS_COLLECTION, session.sessionId));
    } catch {
      // Session may already be expired or removed
    }
  }
  clearLocalSession();
}

export async function validateSession() {
  const session = getSession();
  if (!session) return null;

  try {
    const snap = await getDoc(doc(db, SESSIONS_COLLECTION, session.sessionId));
    if (!snap.exists()) {
      await logout();
      return null;
    }

    const data = snap.data();
    const expiresAt = data.expiresAt?.toDate?.() || new Date(data.expiresAt);
    if (expiresAt <= new Date() || data.active === false) {
      await logout();
      return null;
    }

    let mustChangePassword =
      session.mustChangePassword === true || data.mustChangePassword === true;

    try {
      const userSnap = await getDoc(
        doc(db, USERS_COLLECTION, normalizeUsername(session.username))
      );
      if (userSnap.exists()) {
        const user = userSnap.data();
        mustChangePassword =
          user.mustChangePassword === true || !user.passwordChangedAt;
      }
    } catch {
      // Keep session-derived flag if user lookup fails
    }

    return {
      ...session,
      role: data.role,
      displayName: data.displayName,
      department: data.department,
      mustChangePassword,
    };
  } catch {
    return session;
  }
}

export async function requireAuth(allowedRoles = null) {
  const session = await validateSession();
  if (!session) return null;

  if (allowedRoles && !allowedRoles.includes(session.role)) {
    return null;
  }

  return { session, profile: session };
}

export function withSession(data) {
  const session = getSession();
  if (!session) throw new Error("NO_SESSION");
  return { ...data, _sessionId: session.sessionId };
}

export function initAuthGuard(allowedRoles, onSuccess) {
  validateSession().then((session) => {
    if (!session) {
      window.location.href = resolveLoginPath();
      return;
    }
    if (allowedRoles && !allowedRoles.includes(session.role)) {
      window.location.href = resolveLoginPath();
      return;
    }
    onSuccess(session);
  });
}

export function checkExistingSession() {
  const session = getSession();
  if (session) {
    window.location.href = getPortalPath(session.role);
  }
}

function resolveLoginPath() {
  const path = window.location.pathname;
  if (path.includes("/admin/") || path.includes("/portal/")) {
    return "../login.html";
  }
  return "login.html";
}

export function getPortalPath(role) {
  if (role === ROLES.ADMIN) return "admin/";
  return "portal/";
}

export function getAuthErrorMessage(error) {
  if (error?.message === "INVALID_CREDENTIALS") {
    return "Invalid username or password.";
  }
  if (error?.message === "INACTIVE") {
    return "Your account is inactive. Contact the administrator.";
  }
  if (error?.code === "permission-denied") {
    return "Database permission denied. Open Firebase Console → Firestore → Rules, paste the contents of firestore.rules, and click Publish.";
  }
  return "Login failed. Please try again.";
}
