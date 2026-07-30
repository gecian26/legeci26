import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const COLLECTION = "alumni";

const header = document.getElementById("header");
const navToggle = document.getElementById("navToggle");
const navMenu = document.getElementById("navMenu");
const registerForm = document.getElementById("registerForm");
const submitBtn = document.getElementById("submitBtn");
const batchSelect = document.getElementById("batch");
const toast = document.getElementById("toast");

import { loadPublicMeetup, loadPublicEvents, setupLightbox } from "./events-public.js";

document.addEventListener("DOMContentLoaded", () => {
  populateBatchYears();
  setupNavigation();
  setupForm();
  setupLightbox();
  loadPublicMeetup();
  loadPublicEvents();
});

function populateBatchYears() {
  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= 2000; year--) {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    batchSelect.appendChild(option);
  }
}

function setupNavigation() {
  window.addEventListener("scroll", () => {
    header.classList.toggle("header--scrolled", window.scrollY > 20);
  });

  navToggle.addEventListener("click", () => {
    const isOpen = navMenu.classList.toggle("nav__menu--open");
    navToggle.setAttribute("aria-expanded", isOpen);
  });

  navMenu.querySelectorAll(".nav__link").forEach((link) => {
    link.addEventListener("click", () => {
      navMenu.classList.remove("nav__menu--open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });
}

function setupForm() {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!validateForm()) return;

    setLoading(true);

    const data = {
      fullName: registerForm.fullName.value.trim(),
      email: registerForm.email.value.trim().toLowerCase(),
      phone: registerForm.phone.value.trim(),
      batch: registerForm.batch.value,
      department: registerForm.department.value,
      currentRole: registerForm.currentRole.value.trim(),
      company: registerForm.company.value.trim(),
      location: registerForm.location.value.trim(),
      linkedin: registerForm.linkedin.value.trim(),
      createdAt: serverTimestamp(),
    };

    try {
      await addDoc(collection(db, COLLECTION), data);
      showToast("Registration successful! Welcome to the GECIAN Alumni Network.", "success");
      registerForm.reset();
    } catch (err) {
      console.error("Registration error:", err);
      showToast("Registration failed. Please check your connection and try again.", "error");
    } finally {
      setLoading(false);
    }
  });
}

function validateForm() {
  let valid = true;
  const required = ["fullName", "email", "batch", "department"];

  required.forEach((field) => {
    const input = registerForm[field];
    const isEmpty = !input.value.trim();
    input.classList.toggle("error", isEmpty);
    if (isEmpty) valid = false;
  });

  const emailInput = registerForm.email;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value.trim());
  emailInput.classList.toggle("error", !emailValid);
  if (!emailValid) valid = false;

  if (!valid) {
    showToast("Please fill in all required fields correctly.", "error");
  }

  return valid;
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.querySelector(".btn__text").hidden = loading;
  submitBtn.querySelector(".btn__loader").hidden = !loading;
}

function showToast(message, type = "") {
  toast.textContent = message;
  toast.className = `toast toast--visible${type ? ` toast--${type}` : ""}`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.remove("toast--visible");
  }, 4000);
}
