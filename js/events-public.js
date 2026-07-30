import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { formatDate, formatDateShort, escapeHtml, DEFAULT_MEETUP, MEETUP_NAME, MEETUP_TAGLINE } from "./constants.js";

export async function loadPublicMeetup() {
  const section = document.getElementById("meetupSection");
  const banner = document.getElementById("legeciBanner");
  if (!section) return;

  let m = { ...DEFAULT_MEETUP };

  try {
    const snap = await getDoc(doc(db, "settings", "meetup"));
    if (snap.exists()) {
      if (snap.data().published === false) {
        section.hidden = true;
        if (banner) banner.hidden = true;
        return;
      }
      m = { ...DEFAULT_MEETUP, ...snap.data() };
    }
  } catch {
    // Use default meetup details when settings are unavailable
  }

  const eventName = m.title || MEETUP_NAME;
  const tagline = m.tagline || MEETUP_TAGLINE;
  const meetupDate = m.date || DEFAULT_MEETUP.date;

  const eventNameEl = document.getElementById("meetupEventName");
  const taglineEl = document.getElementById("meetupTagline");
  const bannerImg = document.getElementById("meetupBannerImg");

  if (eventNameEl) eventNameEl.textContent = eventName;
  if (taglineEl) taglineEl.textContent = tagline;
  if (bannerImg) bannerImg.alt = `${eventName} — ${tagline}`;

  document.getElementById("meetupDate").textContent = formatDate(meetupDate);
  document.getElementById("meetupVenue").textContent = m.venue || DEFAULT_MEETUP.venue;
  document.getElementById("meetupDesc").textContent = m.description || DEFAULT_MEETUP.description;

  const preEventsDesc = document.getElementById("preEventsDesc");
  if (preEventsDesc) {
    preEventsDesc.textContent = `Events leading up to ${eventName} on ${formatDateShort(meetupDate)}.`;
  }

  if (banner) banner.hidden = false;
  section.hidden = false;
}

export async function loadPublicEvents() {
  const container = document.getElementById("eventsList");
  if (!container) return;

  try {
    const q = query(collection(db, "pre_events"), orderBy("date", "asc"));
    const snap = await getDocs(q);

    const published = snap.docs.filter(
      (d) => d.data().published === true && !d.data()._deleted
    );

    if (published.length === 0) {
      container.innerHTML = '<p class="events-empty">Pre-event schedule will be announced soon. Stay tuned!</p>';
      return;
    }

    container.innerHTML = published
      .map((d) => {
        const e = d.data();
        const date = new Date(e.date + "T00:00:00");
        const day = date.getDate();
        const month = date.toLocaleDateString("en-IN", { month: "short" });
        const photos = (e.photos || [])
          .map(
            (p) =>
              `<img class="event-card__photo" src="${escapeHtml(p.url)}" alt="${escapeHtml(e.title)}" data-lightbox="${escapeHtml(p.url)}" data-caption="${escapeHtml(e.title)}">`
          )
          .join("");

        return `
          <article class="event-card">
            <div class="event-card__date">
              <span class="event-card__day">${day}</span>
              <span class="event-card__month">${month}</span>
            </div>
            <div>
              <h3 class="event-card__title">${escapeHtml(e.title)}</h3>
              <p class="event-card__meta">${escapeHtml(formatDateShort(e.date))}${e.time ? ` · ${escapeHtml(e.time)}` : ""}${e.venue ? ` · ${escapeHtml(e.venue)}` : ""}</p>
              ${e.description ? `<p class="event-card__desc">${escapeHtml(e.description)}</p>` : ""}
              ${photos ? `<div class="event-card__photos">${photos}</div>` : ""}
            </div>
          </article>`;
      })
      .join("");

    bindLightboxTriggers(container);
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="events-empty">Pre-event schedule coming soon.</p>';
  }
}

function bindLightboxTriggers(container) {
  container.querySelectorAll("[data-lightbox]").forEach((el) => {
    el.addEventListener("click", () => {
      openLightbox(el.dataset.lightbox, el.dataset.caption || "");
    });
  });
}

export function setupLightbox() {
  const lightbox = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  const caption = document.getElementById("lightboxCaption");
  const closeBtn = document.getElementById("lightboxClose");

  if (!lightbox) return;

  const close = () => {
    lightbox.hidden = true;
    img.src = "";
  };

  closeBtn?.addEventListener("click", close);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.hidden) close();
  });
}

function openLightbox(src, text) {
  const lightbox = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  const caption = document.getElementById("lightboxCaption");
  if (!lightbox || !img) return;

  img.src = src;
  caption.textContent = text || "";
  lightbox.hidden = false;
}
