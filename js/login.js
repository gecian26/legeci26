import { login, checkExistingSession, getPortalPath, getAuthErrorMessage } from "./auth.js";

const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");

checkExistingSession();

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.remove("login-error--visible");

  const username = loginForm.username.value.trim();
  const password = loginForm.password.value;

  if (!username || !password) {
    loginError.textContent = "Please enter username and password.";
    loginError.classList.add("login-error--visible");
    return;
  }

  setLoading(true);

  try {
    const session = await login(username, password);
    window.location.href = getPortalPath(session.role);
  } catch (err) {
    console.error(err);
    loginError.textContent = getAuthErrorMessage(err);
    loginError.classList.add("login-error--visible");
  } finally {
    setLoading(false);
  }
});

function setLoading(loading) {
  loginBtn.disabled = loading;
  loginBtn.querySelector(".btn__text").hidden = loading;
  loginBtn.querySelector(".btn__loader").hidden = !loading;
}
