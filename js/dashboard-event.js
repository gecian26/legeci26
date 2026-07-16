import { formatDate, formatDateShort, escapeHtml, DEFAULT_MEETUP } from "./constants.js";

function logoBase() {
  const path = window.location.pathname;
  return path.includes("/admin/") || path.includes("/portal/") ? "../assets/" : "assets/";
}

export function renderMeetupOverview(container, data) {
  if (!container) return;

  const m = data || DEFAULT_MEETUP;
  const published = m.published !== false;
  const assets = logoBase();

  container.innerHTML = `
    <section class="dash-event">
      <div class="dash-event__glow"></div>
      <div class="dash-event__inner">
        <div class="dash-event__logos">
          <img src="${assets}geci-logo.png" alt="GECI" class="dash-event__logo dash-event__logo--geci">
          <img src="${assets}silver-jubilee-logo.png" alt="Silver Jubilee" class="dash-event__logo dash-event__logo--jubilee">
        </div>
        <div class="dash-event__header">
          <span class="dash-event__tag">Mega Event</span>
          <h2 class="dash-event__heading">Alumni Meetup 2026</h2>
          ${!published ? '<p class="dash-event__draft">Draft — not yet published on the public site</p>' : ""}
        </div>
        <article class="dash-event__card">
          <p class="dash-event__date">${escapeHtml(formatDate(m.date || DEFAULT_MEETUP.date))}</p>
          <h3 class="dash-event__title">${escapeHtml(m.title || DEFAULT_MEETUP.title)}</h3>
          <p class="dash-event__venue">${escapeHtml(m.venue || DEFAULT_MEETUP.venue)}</p>
          <p class="dash-event__desc">${escapeHtml(m.description || DEFAULT_MEETUP.description)}</p>
        </article>
      </div>
    </section>`;
}

export function renderPreEventsOverview(container, events) {
  if (!container) return;

  const list = (events || []).filter((e) => !e._deleted);

  container.innerHTML = `
    <section class="dash-programme">
      <div class="dash-programme__inner">
        <div class="dash-event__header">
          <span class="dash-event__tag">Programme</span>
          <h2 class="dash-event__heading">Pre-Events</h2>
          <p class="dash-event__sub">Events leading up to the Mega Alumni Meetup on 22 August 2026.</p>
        </div>
        ${
          list.length === 0
            ? `<p class="dash-event__empty">Pre-event schedule will appear here once configured.</p>`
            : `<div class="dash-programme__list">
                ${list
                  .map((e, i) => {
                    const date = new Date((e.date || "") + "T00:00:00");
                    const day = Number.isNaN(date.getTime()) ? "—" : date.getDate();
                    const month = Number.isNaN(date.getTime())
                      ? ""
                      : date.toLocaleDateString("en-IN", { month: "short" });
                    return `
                      <article class="dash-event-card" style="animation-delay:${i * 0.06}s">
                        <div class="dash-event-card__date">
                          <span class="dash-event-card__day">${day}</span>
                          <span class="dash-event-card__month">${month}</span>
                        </div>
                        <div class="dash-event-card__body">
                          <h3 class="dash-event-card__title">${escapeHtml(e.title || "")}</h3>
                          <p class="dash-event-card__meta">
                            ${escapeHtml(formatDateShort(e.date))}
                            ${e.time ? ` · ${escapeHtml(e.time)}` : ""}
                            ${e.venue ? ` · ${escapeHtml(e.venue)}` : ""}
                          </p>
                          ${e.description ? `<p class="dash-event-card__desc">${escapeHtml(e.description)}</p>` : ""}
                          ${e.published === false ? '<span class="badge badge--draft">Draft</span>' : ""}
                        </div>
                      </article>`;
                  })
                  .join("")}
              </div>`
        }
      </div>
    </section>`;
}
