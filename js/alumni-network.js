import { db } from "./firebase-config.js";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { withSession } from "./auth.js";
import {
  ALUMNI_NETWORK_COLLECTION,
  ALUMNI_PROGRAMS_COLLECTION,
  DEPARTMENTS,
  JOB_SECTORS,
  NETWORK_ACTIVITY_FIELDS,
  NETWORK_ACTIVITY_WILLINGNESS,
  NETWORK_CONNECT_STATUS,
  NETWORK_ORIGIN_KINDS,
  PROGRAM_KINDS,
  PROGRAM_STATUS,
  escapeHtml,
  formatDateShort,
} from "./constants.js?v=er35";
import {
  alumniFiltersHtml,
  filterAlumniContacts,
  jobSectorOptionsHtml,
  loadAllAlumniContacts,
  normalizePhoneDigits,
  optionsHtml,
  passoutYearSearchFieldHtml,
  readAlumniFilters,
  uniqueSortedValues,
} from "./alumni-connect.js?v=er30";
import {
  loadEventRegistrations,
  registeredAlumniReportData,
} from "./event-registration.js?v=er31";

function omitUndefined(obj) {
  return Object.fromEntries(Object.entries(obj || {}).filter(([, value]) => value !== undefined));
}

function deptLabel(code) {
  return DEPARTMENTS.find((d) => d.value === code)?.label || code || "—";
}

function optionLabel(options, value, fallback = "—") {
  return options.find((o) => o.value === value)?.label || value || fallback;
}

function originLabel(value) {
  return optionLabel(NETWORK_ORIGIN_KINDS, value, "—");
}

function connectTone(value) {
  switch (value) {
    case "responded":
      return "green";
    case "contacted":
    case "follow_up":
      return "orange";
    case "declined":
      return "red";
    case "not_contacted":
    case "no_response":
    default:
      return "gray";
  }
}

function activityTone(value) {
  switch (value) {
    case "willing":
      return "green";
    case "undecided":
      return "orange";
    case "not_willing":
      return "red";
    case "no_response":
    default:
      return "gray";
  }
}

function programTone(value) {
  switch (value) {
    case "completed":
      return "green";
    case "confirmed":
      return "blue";
    case "planned":
      return "orange";
    case "cancelled":
      return "red";
    default:
      return "gray";
  }
}

function badgeHtml(tone, label) {
  return `<span class="badge badge--status badge--status-${tone}">${escapeHtml(label)}</span>`;
}

function statusSelectHtml({ field, value, options, toneFn, dataset = "" }) {
  const tone = toneFn(value);
  return `<select class="table-status-select table-status-select--${tone}" data-an-field="${escapeHtml(field)}" ${dataset}>
    ${optionsHtml(options, value || options[0]?.value || "")}
  </select>`;
}

function phoneKey(value) {
  return normalizePhoneDigits(value || "");
}

function actorName(session) {
  return session?.displayName || session?.username || session?.userId || "";
}

const REMARK_MAX_LENGTH = 1000;

function remarkMillis(remark) {
  return remark?.at?.toMillis?.() ?? (remark?.at ? new Date(remark.at).getTime() : 0);
}

/** Remarks for one alumni, newest first. */
function remarksOf(person) {
  return (Array.isArray(person?.remarks) ? [...person.remarks] : []).sort(
    (a, b) => remarkMillis(b) - remarkMillis(a)
  );
}

function remarkWhen(remark) {
  const ms = remarkMillis(remark);
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function remarksPanelHtml(person) {
  const list = remarksOf(person);
  return `
    <div class="an-remarks" data-an-remarks-panel="${escapeHtml(person.id)}">
      <div class="an-remarks__add">
        <label for="anRemarkText" class="an-remarks__label">Add a remark for ${escapeHtml(person.alumniName || "this alumni")}</label>
        <textarea id="anRemarkText" rows="2" maxlength="${REMARK_MAX_LENGTH}" placeholder="e.g. Called on 19 Nov — will confirm the talk date after Diwali."></textarea>
        <div class="an-remarks__actions">
          <span class="form-hint">Ctrl + Enter to save</span>
          <button type="button" class="btn btn--ghost btn--sm" data-an-remarks-close="1">Close</button>
          <button type="button" class="btn btn--primary btn--sm" data-an-remark-add="${escapeHtml(person.id)}">Save remark</button>
        </div>
      </div>
      ${
        list.length
          ? `<ul class="an-remarks__list">
              ${list
                .map(
                  (r) => `
                <li class="an-remarks__item">
                  <p class="an-remarks__text">${escapeHtml(r.text || "")}</p>
                  <div class="an-remarks__meta">
                    <span>${escapeHtml([remarkWhen(r), r.byName].filter(Boolean).join(" · "))}</span>
                    <button type="button" class="an-remarks__delete" data-an-remark-delete="${escapeHtml(r.id || "")}" data-an-remark-person="${escapeHtml(person.id)}" aria-label="Delete this remark">Delete</button>
                  </div>
                </li>`
                )
                .join("")}
            </ul>`
          : `<p class="form-hint an-remarks__empty">No remarks yet.</p>`
      }
      ${
        person.notes
          ? `<p class="form-hint an-remarks__legacy"><strong>Notes (from Edit):</strong> ${escapeHtml(person.notes)}</p>`
          : ""
      }
    </div>`;
}

function emptyPerson() {
  return {
    alumniName: "",
    department: "",
    batch: "",
    whatsapp: "",
    mobile: "",
    email: "",
    company: "",
    jobRole: "",
    jobSector: "",
    address: "",
    notes: "",
    originKind: "manual",
    originContactId: "",
    referredById: "",
    referredByName: "",
    referredByPhone: "",
    referredBySource: "",
    connectStatus: "not_contacted",
    ...Object.fromEntries(NETWORK_ACTIVITY_FIELDS.map((f) => [f.key, "no_response"])),
  };
}

function personFromSource(source, originKind) {
  const phone = source.whatsapp || source.mobile || source.phone || "";
  return {
    ...emptyPerson(),
    alumniName: source.alumniName || source.name || "",
    department: source.department || "",
    batch: String(source.batch || "").replace("—", "").trim(),
    whatsapp: phone,
    mobile: source.mobile || phone,
    email: source.email || "",
    company: source.company || "",
    jobRole: source.jobRole || "",
    jobSector: source.jobSector || "",
    address: source.address || "",
    originKind,
    originContactId: source.id || "",
    connectStatus: originKind === "event_desk" ? "responded" : "not_contacted",
  };
}

function emptyProgram() {
  return {
    kind: "technical_talk",
    title: "",
    date: "",
    venue: "",
    department: "",
    status: "planned",
    alumniId: "",
    alumniName: "",
    amount: "",
    notes: "",
  };
}

function matchNetworkPerson(people, hint = {}) {
  const originId = String(hint.originContactId || hint.id || "").trim();
  const phone = phoneKey(hint.phone || hint.whatsapp || hint.mobile);
  return (people || []).find((p) => {
    if (p._deleted) return false;
    if (originId && String(p.originContactId || "") === originId) return true;
    if (phone.length >= 10 && phoneKey(p.whatsapp || p.mobile) === phone) return true;
    return false;
  });
}

function haystack(parts) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function filterByQuery(rows, q, fieldsFn) {
  const query = (q || "").trim().toLowerCase();
  if (!query) return rows;
  return rows.filter((row) => haystack(fieldsFn(row)).includes(query));
}

export async function loadNetworkPeople() {
  const snap = await getDocs(collection(db, ALUMNI_NETWORK_COLLECTION));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => !p._deleted)
    .sort((a, b) => String(a.alumniName || "").localeCompare(String(b.alumniName || "")));
}

export async function loadAlumniPrograms() {
  const snap = await getDocs(collection(db, ALUMNI_PROGRAMS_COLLECTION));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => !p._deleted)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.title || "").localeCompare(String(b.title || "")));
}

function personPayload(form, session, existing = {}) {
  const name = String(form.alumniName || "").trim();
  const whatsapp = phoneKey(form.whatsapp || form.mobile);
  if (!name) throw new Error("Enter the alumni name.");
  if (whatsapp && whatsapp.length < 10) throw new Error("Enter a valid WhatsApp / mobile number.");
  return omitUndefined({
    alumniName: name,
    department: form.department || "",
    batch: String(form.batch || "").trim(),
    whatsapp,
    mobile: phoneKey(form.mobile) || whatsapp,
    email: String(form.email || "").trim(),
    company: String(form.company || "").trim(),
    jobRole: String(form.jobRole || "").trim(),
    jobSector: form.jobSector || "",
    address: String(form.address || "").trim(),
    notes: String(form.notes || "").trim(),
    originKind: form.originKind || existing.originKind || "manual",
    originContactId: form.originContactId || existing.originContactId || "",
    referredById: form.referredById || "",
    referredByName: String(form.referredByName || "").trim(),
    referredByPhone: phoneKey(form.referredByPhone),
    referredBySource: form.referredBySource || "",
    connectStatus: form.connectStatus || "not_contacted",
    ...Object.fromEntries(NETWORK_ACTIVITY_FIELDS.map((f) => [f.key, form[f.key] || "no_response"])),
    createdByUserId: existing.createdByUserId || session?.userId || "",
    createdByName: existing.createdByName || actorName(session),
    updatedAt: serverTimestamp(),
  });
}

function programPayload(form, session, existing = {}) {
  const title = String(form.title || "").trim();
  if (!title) throw new Error("Enter a programme title.");
  const kind = form.kind || "technical_talk";
  const amountRaw = String(form.amount || "").replace(/,/g, "").trim();
  const amount = amountRaw === "" ? 0 : Number(amountRaw);
  if (Number.isNaN(amount) || amount < 0) throw new Error("Enter a valid amount.");
  return omitUndefined({
    kind,
    title,
    date: form.date || "",
    venue: String(form.venue || "").trim(),
    department: form.department || "",
    status: form.status || "planned",
    alumniId: form.alumniId || "",
    alumniName: String(form.alumniName || "").trim(),
    amount: kind === "funding" || kind === "sponsorship" ? amount : 0,
    notes: String(form.notes || "").trim(),
    createdByUserId: existing.createdByUserId || session?.userId || "",
    createdByName: existing.createdByName || actorName(session),
    updatedAt: serverTimestamp(),
  });
}

function summarizeNetwork(people, programs) {
  const list = people || [];
  const willing = (key) => list.filter((p) => p[key] === "willing").length;
  return {
    total: list.length,
    responded: list.filter((p) => p.connectStatus === "responded").length,
    followUp: list.filter((p) => p.connectStatus === "follow_up" || p.connectStatus === "contacted").length,
    noResponse: list.filter((p) => p.connectStatus === "no_response" || p.connectStatus === "not_contacted").length,
    declined: list.filter((p) => p.connectStatus === "declined").length,
    talks: willing("talkWillingness"),
    sharing: willing("shareWillingness"),
    funding: willing("fundingWillingness"),
    sponsor: willing("sponsorWillingness"),
    internship: willing("internshipWillingness"),
    placement: willing("placementWillingness"),
    programs: (programs || []).length,
    openPrograms: (programs || []).filter((p) => p.status === "planned" || p.status === "confirmed").length,
  };
}

function filterNetworkPeople(people, filters = {}) {
  return filterByQuery(
    (people || []).filter((p) => {
      if (filters.department && (p.department || "") !== filters.department) return false;
      if (filters.batch && String(p.batch || "") !== String(filters.batch)) return false;
      if (filters.jobSector && (p.jobSector || "") !== filters.jobSector) return false;
      if (filters.connectStatus && (p.connectStatus || "") !== filters.connectStatus) return false;
      if (filters.originKind && (p.originKind || "") !== filters.originKind) return false;
      if (filters.activityKey && filters.activityValue && (p[filters.activityKey] || "") !== filters.activityValue) {
        return false;
      }
      return true;
    }),
    filters.search,
    (p) => [
      p.alumniName,
      p.whatsapp,
      p.mobile,
      p.email,
      p.company,
      p.jobRole,
      p.jobSector,
      p.referredByName,
      p.notes,
      ...remarksOf(p).map((r) => r.text),
      deptLabel(p.department),
      p.batch,
    ]
  );
}

function filterPrograms(programs, filters = {}) {
  return filterByQuery(
    (programs || []).filter((p) => {
      if (filters.kind && (p.kind || "") !== filters.kind) return false;
      if (filters.status && (p.status || "") !== filters.status) return false;
      if (filters.department && (p.department || "") !== filters.department) return false;
      return true;
    }),
    filters.search,
    (p) => [p.title, p.alumniName, p.venue, p.notes, optionLabel(PROGRAM_KINDS, p.kind), deptLabel(p.department)]
  );
}

function filterDeskSeed(alumni, filters = {}) {
  return filterByQuery(
    (alumni || []).filter((row) => {
      if (filters.department && (row.department || "") !== filters.department) return false;
      if (filters.batch && String(row.batch || "").replace("—", "") !== String(filters.batch)) return false;
      return true;
    }),
    filters.search,
    (row) => [row.name, row.phone, row.email, row.company, row.departmentLabel, row.batch]
  );
}

function referrerHits(query, { desk, connect, people }) {
  const q = (query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const hits = [];
  (desk || []).forEach((row) => {
    const text = haystack([row.name, row.phone, row.departmentLabel, row.batch, row.company]);
    if (!text.includes(q)) return;
    hits.push({
      id: row.id,
      name: row.name,
      phone: row.phone,
      source: "event_desk",
      meta: `${row.departmentLabel || row.department || ""} · ${row.batch || ""}`.trim(),
    });
  });
  (people || []).forEach((p) => {
    const text = haystack([p.alumniName, p.whatsapp, p.mobile, p.company, p.batch]);
    if (!text.includes(q)) return;
    hits.push({
      id: p.id,
      name: p.alumniName,
      phone: p.whatsapp || p.mobile,
      source: "network",
      meta: `${deptLabel(p.department)} · ${p.batch || ""}`.trim(),
    });
  });
  (connect || []).forEach((c) => {
    const text = haystack([c.alumniName, c.whatsapp, c.mobile, c.company, c.batch]);
    if (!text.includes(q)) return;
    hits.push({
      id: c.id,
      name: c.alumniName,
      phone: c.whatsapp || c.mobile,
      source: "alumni_connect",
      meta: `${deptLabel(c.department)} · ${c.batch || ""}`.trim(),
    });
  });
  const seen = new Set();
  return hits.filter((hit) => {
    const key = `${hit.source}:${hit.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function legendHtml() {
  return `
    <div class="an-legend">
      <div>
        <strong>Response</strong>
        ${badgeHtml("green", "Responded")}
        ${badgeHtml("orange", "Contacted / follow up")}
        ${badgeHtml("red", "Declined")}
        ${badgeHtml("gray", "Not contacted / no reply")}
      </div>
      <div>
        <strong>Activities</strong>
        ${badgeHtml("green", "Willing")}
        ${badgeHtml("orange", "Maybe")}
        ${badgeHtml("red", "Not willing")}
        ${badgeHtml("gray", "No reply")}
      </div>
    </div>`;
}

function statsHtml(stats) {
  const cards = [
    { label: "In network", value: stats.total, tone: "neutral" },
    { label: "Responded", value: stats.responded, tone: "good" },
    { label: "Follow up", value: stats.followUp, tone: "warn" },
    { label: "Willing for talks", value: stats.talks, tone: "good" },
    { label: "Willing to share", value: stats.sharing, tone: "good" },
    { label: "Funding", value: stats.funding, tone: "good" },
    { label: "Sponsorship", value: stats.sponsor, tone: "good" },
    { label: "Internship support", value: stats.internship, tone: "good" },
    { label: "Placement support", value: stats.placement, tone: "good" },
    { label: "Open programmes", value: stats.openPrograms, tone: "neutral" },
  ];
  return `
    <div class="ac-stat-grid an-stat-grid">
      ${cards
        .map(
          (card) => `
        <div class="ac-stat-card ac-stat-card--${card.tone}">
          <div class="ac-stat-card__value">${escapeHtml(String(card.value))}</div>
          <div class="ac-stat-card__label">${escapeHtml(card.label)}</div>
        </div>`
        )
        .join("")}
    </div>`;
}

function tabsHtml(tab) {
  const items = [
    { id: "desk", label: "Event Desk seed" },
    { id: "connect", label: "Alumni Connect" },
    { id: "directory", label: "Network directory" },
    { id: "programs", label: "Programmes" },
    { id: "reports", label: "Reports" },
  ];
  return `
    <div class="an-tabs" role="tablist">
      ${items
        .map(
          (item) => `
        <button type="button" class="an-tabs__btn${tab === item.id ? " an-tabs__btn--active" : ""}" data-an-tab="${item.id}">
          ${escapeHtml(item.label)}
        </button>`
        )
        .join("")}
    </div>`;
}

function seedStatusHtml(existing) {
  if (!existing) return badgeHtml("gray", "Not in network");
  return badgeHtml(connectTone(existing.connectStatus), optionLabel(NETWORK_CONNECT_STATUS, existing.connectStatus));
}

function deptFilterOptions(selected = "") {
  return (
    '<option value="">All departments</option>' +
    DEPARTMENTS.map(
      (d) =>
        `<option value="${escapeHtml(d.value)}" ${d.value === selected ? "selected" : ""}>${escapeHtml(d.label)}</option>`
    ).join("")
  );
}

function simpleFiltersHtml(prefix, filters, extra = "", { showBatch = true } = {}) {
  return `
    <div class="ac-filters ac-filters--compact an-filters">
      <div class="form-row">
        <div class="form-group">
          <label for="${prefix}Search">Search</label>
          <input type="search" id="${prefix}Search" value="${escapeHtml(filters.search || "")}" placeholder="Name, phone, company…">
        </div>
        <div class="form-group">
          <label for="${prefix}Department">Department</label>
          <select id="${prefix}Department">${deptFilterOptions(filters.department || "")}</select>
        </div>
        ${
          showBatch
            ? `<div class="form-group">
          <label for="${prefix}Batch">Passout year</label>
          <input type="search" id="${prefix}Batch" value="${escapeHtml(filters.batch || "")}" placeholder="e.g. 2018" inputmode="numeric">
        </div>`
            : ""
        }
        ${extra}
      </div>
    </div>`;
}

function actionBtns(rowId, existing, source) {
  if (existing) {
    return `
      <button type="button" class="btn btn--ghost btn--sm" data-an-edit="${escapeHtml(existing.id)}">Open</button>
      <button type="button" class="btn btn--ghost btn--sm" data-an-via="${escapeHtml(source)}:${escapeHtml(rowId)}">Connect via</button>
      <button type="button" class="btn btn--ghost btn--sm" data-an-program-for="${escapeHtml(existing.id)}">Programme</button>`;
  }
  return `
    <button type="button" class="btn btn--primary btn--sm" data-an-add="${escapeHtml(source)}:${escapeHtml(rowId)}">Add to network</button>
    <button type="button" class="btn btn--ghost btn--sm" data-an-via="${escapeHtml(source)}:${escapeHtml(rowId)}">Connect via</button>`;
}

function deskTabHtml(state) {
  const rows = filterDeskSeed(state.deskAlumni, state.deskFilters);
  return `
    <p class="form-hint">
      Unique LEGECI26 Event Desk alumni after duplicate removal. Add them to the network, or use a person as the link who helped you reach someone new.
    </p>
    ${simpleFiltersHtml("anDesk", state.deskFilters)}
    <p class="ac-results-meta">${rows.length} of ${state.deskAlumni.length} Event Desk alumni</p>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Alumni</th>
            <th>Branch / year</th>
            <th>Contact</th>
            <th>Company</th>
            <th>Network</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map((row) => {
                    const existing = matchNetworkPerson(state.people, row);
                    return `
            <tr>
              <td><strong>${escapeHtml(row.name || "—")}</strong></td>
              <td>${escapeHtml(row.departmentLabel || deptLabel(row.department))}<br><span class="form-hint">${escapeHtml(String(row.batch || "—"))}</span></td>
              <td>${escapeHtml(row.phone || "—")}${row.email ? `<br><span class="form-hint">${escapeHtml(row.email)}</span>` : ""}</td>
              <td>${escapeHtml(row.company || "—")}</td>
              <td>${seedStatusHtml(existing)}</td>
              <td class="an-row-actions">${actionBtns(row.id, existing, "desk")}</td>
            </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="6" class="empty-state">No Event Desk alumni match these filters.</td></tr>`
          }
        </tbody>
      </table>
    </div>`;
}

function connectTabHtml(state) {
  const filtered = filterAlumniContacts(state.connectContacts, state.connectFilters);
  const batches = uniqueSortedValues(state.connectContacts, (c) => c.batch || c.passoutYear);
  const sectors = uniqueSortedValues(state.connectContacts, (c) => c.jobSector);
  return `
    <p class="form-hint">
      Pick people already in Alumni Connect. Filter by department, batch, sector, or search, then add them to the network or record a new contact through them.
    </p>
    ${alumniFiltersHtml("anAc", {
      showDepartment: true,
      compact: false,
      departments: DEPARTMENTS,
      batches,
      sectors,
    })}
    <p class="ac-results-meta">${filtered.length} of ${state.connectContacts.length} Alumni Connect records</p>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Alumni</th>
            <th>Branch / year</th>
            <th>Contact</th>
            <th>Job</th>
            <th>Network</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${
            filtered.length
              ? filtered
                  .slice(0, 200)
                  .map((c) => {
                    const existing = matchNetworkPerson(state.people, c);
                    return `
            <tr>
              <td><strong>${escapeHtml(c.alumniName || "—")}</strong></td>
              <td>${escapeHtml(deptLabel(c.department))}<br><span class="form-hint">${escapeHtml(String(c.batch || c.passoutYear || "—"))}</span></td>
              <td>${escapeHtml(c.whatsapp || c.mobile || "—")}${c.email ? `<br><span class="form-hint">${escapeHtml(c.email)}</span>` : ""}</td>
              <td>${escapeHtml(c.company || "—")}${c.jobSector ? `<br><span class="form-hint">${escapeHtml(c.jobSector)}</span>` : ""}</td>
              <td>${seedStatusHtml(existing)}</td>
              <td class="an-row-actions">${actionBtns(c.id, existing, "connect")}</td>
            </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="6" class="empty-state">No Alumni Connect records match these filters.</td></tr>`
          }
        </tbody>
      </table>
    </div>
    ${filtered.length > 200 ? `<p class="form-hint">Showing first 200. Narrow the filters to see the rest.</p>` : ""}`;
}

function directoryTabHtml(state) {
  const rows = filterNetworkPeople(state.people, state.dirFilters);
  const extra = `
        <div class="form-group">
          <label for="anDirStatus">Response</label>
          <select id="anDirStatus">
            <option value="">All</option>
            ${optionsHtml(NETWORK_CONNECT_STATUS, state.dirFilters.connectStatus || "")}
          </select>
        </div>
        <div class="form-group">
          <label for="anDirOrigin">Source</label>
          <select id="anDirOrigin">
            <option value="">All sources</option>
            ${optionsHtml(NETWORK_ORIGIN_KINDS, state.dirFilters.originKind || "")}
          </select>
        </div>
        <div class="form-group">
          <label for="anDirSector">Job sector</label>
          <select id="anDirSector">
            <option value="">All sectors</option>
            ${JOB_SECTORS.map((s) => `<option value="${escapeHtml(s)}" ${state.dirFilters.jobSector === s ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="anDirActivity">Activity</label>
          <select id="anDirActivity">
            <option value="">Any activity</option>
            ${NETWORK_ACTIVITY_FIELDS.map((f) => `<option value="${escapeHtml(f.key)}" ${state.dirFilters.activityKey === f.key ? "selected" : ""}>${escapeHtml(f.label)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="anDirWilling">Willingness</label>
          <select id="anDirWilling">
            <option value="">All</option>
            ${optionsHtml(NETWORK_ACTIVITY_WILLINGNESS, state.dirFilters.activityValue || "")}
          </select>
        </div>`;
  return `
    <div class="an-dir-toolbar">
      <p class="form-hint" style="margin:0;">
        People you are actively connecting after LEGECI. Colours show response and willingness for talks, sharing, funding, and sponsorship.
      </p>
      <button type="button" class="btn btn--primary btn--sm" data-an-add="manual">Add alumni</button>
    </div>
    ${simpleFiltersHtml("anDir", state.dirFilters, extra)}
    <p class="ac-results-meta">${rows.length} of ${state.people.length} in the network</p>
    <div class="table-scroll">
      <table class="data-table an-dir-table">
        <thead>
          <tr>
            <th>Alumni</th>
            <th>Job</th>
            <th>Connected via</th>
            <th>Response</th>
            ${NETWORK_ACTIVITY_FIELDS.map((f) => `<th>${escapeHtml(f.short)}</th>`).join("")}
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map((p) => {
                    const remarks = remarksOf(p);
                    const latest = remarks[0];
                    const open = state.remarksOpenId === p.id;
                    return `
            <tr class="${open ? "an-row--remarks-open" : ""}">
              <td>
                <strong>${escapeHtml(p.alumniName || "—")}</strong>
                <div class="form-hint">${escapeHtml(deptLabel(p.department))} · ${escapeHtml(String(p.batch || "—"))}</div>
                <div class="form-hint">${escapeHtml(p.whatsapp || p.mobile || "—")}</div>
                ${
                  latest
                    ? `<div class="an-remark-latest" title="${escapeHtml(latest.text || "")}">${escapeHtml(latest.text || "")}</div>`
                    : ""
                }
              </td>
              <td>
                ${escapeHtml(p.jobRole || p.company || "—")}
                <div class="form-hint">${escapeHtml(p.company && p.jobRole ? p.company : p.jobSector || "")}</div>
              </td>
              <td>
                ${p.referredByName ? escapeHtml(p.referredByName) : '<span class="form-hint">—</span>'}
                <div class="form-hint">${escapeHtml(originLabel(p.originKind))}</div>
              </td>
              <td>${statusSelectHtml({
                field: "connectStatus",
                value: p.connectStatus || "not_contacted",
                options: NETWORK_CONNECT_STATUS,
                toneFn: connectTone,
                dataset: `data-an-patch="${escapeHtml(p.id)}"`,
              })}</td>
              ${NETWORK_ACTIVITY_FIELDS.map(
                (f) => `<td>${statusSelectHtml({
                  field: f.key,
                  value: p[f.key] || "no_response",
                  options: NETWORK_ACTIVITY_WILLINGNESS,
                  toneFn: activityTone,
                  dataset: `data-an-patch="${escapeHtml(p.id)}"`,
                })}</td>`
              ).join("")}
              <td class="an-row-actions">
                <button type="button" class="btn btn--ghost btn--sm" data-an-edit="${escapeHtml(p.id)}">Edit</button>
                <button type="button" class="btn btn--ghost btn--sm" data-an-via="network:${escapeHtml(p.id)}">Connect via</button>
                <button type="button" class="btn btn--ghost btn--sm" data-an-program-for="${escapeHtml(p.id)}">Programme</button>
                <button type="button" class="btn btn--ghost btn--sm${open ? " an-remarks-btn--open" : ""}" data-an-remarks="${escapeHtml(p.id)}" aria-expanded="${open}">Remarks${remarks.length ? ` (${remarks.length})` : ""}</button>
              </td>
            </tr>
            ${open ? `<tr class="an-remarks-row"><td colspan="${5 + NETWORK_ACTIVITY_FIELDS.length}">${remarksPanelHtml(p)}</td></tr>` : ""}`;
                  })
                  .join("")
              : `<tr><td colspan="${5 + NETWORK_ACTIVITY_FIELDS.length}" class="empty-state">No network alumni yet. Start from Event Desk registered students.</td></tr>`
          }
        </tbody>
      </table>
    </div>`;
}

function programsTabHtml(state) {
  const rows = filterPrograms(state.programs, state.progFilters);
  const extra = `
        <div class="form-group">
          <label for="anProgKind">Type</label>
          <select id="anProgKind">
            <option value="">All types</option>
            ${optionsHtml(PROGRAM_KINDS, state.progFilters.kind || "")}
          </select>
        </div>
        <div class="form-group">
          <label for="anProgStatus">Status</label>
          <select id="anProgStatus">
            <option value="">All</option>
            ${optionsHtml(PROGRAM_STATUS, state.progFilters.status || "")}
          </select>
        </div>`;
  return `
    <div class="an-dir-toolbar">
      <p class="form-hint" style="margin:0;">
        Record technical talks, experience sharing, funding, and sponsorship. Pick the alumni from the network, then track status and generate reports.
      </p>
      <button type="button" class="btn btn--primary btn--sm" data-an-program-new="1">Add programme</button>
    </div>
    ${simpleFiltersHtml("anProg", state.progFilters, extra, { showBatch: false })}
    <p class="ac-results-meta">${rows.length} of ${state.programs.length} programmes</p>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Programme</th>
            <th>Type</th>
            <th>Alumni</th>
            <th>Date</th>
            <th>Amount</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (p) => `
            <tr>
              <td>
                <strong>${escapeHtml(p.title || "—")}</strong>
                <div class="form-hint">${escapeHtml(p.venue || deptLabel(p.department))}</div>
              </td>
              <td>${badgeHtml("gray", optionLabel(PROGRAM_KINDS, p.kind))}</td>
              <td>${escapeHtml(p.alumniName || "—")}</td>
              <td>${escapeHtml(p.date ? formatDateShort(p.date) : "—")}</td>
              <td>${p.amount ? `₹${Number(p.amount).toLocaleString("en-IN")}` : "—"}</td>
              <td>${statusSelectHtml({
                field: "status",
                value: p.status || "planned",
                options: PROGRAM_STATUS,
                toneFn: programTone,
                dataset: `data-an-prog-patch="${escapeHtml(p.id)}"`,
              })}</td>
              <td class="an-row-actions">
                <button type="button" class="btn btn--ghost btn--sm" data-an-program-edit="${escapeHtml(p.id)}">Edit</button>
              </td>
            </tr>`
                  )
                  .join("")
              : `<tr><td colspan="7" class="empty-state">No programmes yet. Add a talk, sharing session, funding, sponsorship, internship or placement support.</td></tr>`
          }
        </tbody>
      </table>
    </div>`;
}

function reportsTabHtml(state) {
  const stats = summarizeNetwork(state.people, state.programs);
  return `
    <div class="er-report">
      <div>
        <h3 class="portal-card__title" style="margin-bottom:0.35rem;">Network &amp; programme reports</h3>
        <p class="form-hint" style="margin:0;">
          ${stats.total} alumni in the network · ${stats.programs} programmes · ${stats.openPrograms} open.
          PDF and Excel include response colours, activity willingness, and who established each connection.
        </p>
      </div>
      <div class="er-report__actions">
        <button type="button" class="btn btn--primary btn--sm" data-an-report="network-pdf">Network PDF</button>
        <button type="button" class="btn btn--ghost btn--sm" data-an-report="network-xlsx">Network Excel</button>
        <button type="button" class="btn btn--primary btn--sm" data-an-report="programs-pdf">Programmes PDF</button>
        <button type="button" class="btn btn--ghost btn--sm" data-an-report="programs-xlsx">Programmes Excel</button>
      </div>
    </div>
    <div class="an-report-preview table-scroll" style="margin-top:1rem;">
      <table class="data-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Planned</th>
            <th>Confirmed</th>
            <th>Completed</th>
            <th>Cancelled</th>
            <th>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${PROGRAM_KINDS.map((kind) => {
            const rows = state.programs.filter((p) => p.kind === kind.value);
            const count = (status) => rows.filter((p) => p.status === status).length;
            const amount = rows.reduce((n, p) => n + (Number(p.amount) || 0), 0);
            return `<tr>
              <td>${escapeHtml(kind.label)}</td>
              <td>${count("planned")}</td>
              <td>${count("confirmed")}</td>
              <td>${count("completed")}</td>
              <td>${count("cancelled")}</td>
              <td>${amount ? amount.toLocaleString("en-IN") : "—"}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function personFormHtml(draft, state) {
  const p = draft || emptyPerson();
  const hits = referrerHits(state.referrerQuery, state);
  return `
    <form class="an-form" id="anPersonForm">
      <div class="an-dir-toolbar">
        <div>
          <h3 class="portal-card__title" style="margin-bottom:0.25rem;">${p.id ? "Edit alumni" : "Add alumni to the network"}</h3>
          <p class="form-hint" style="margin:0;">
            Source: ${escapeHtml(originLabel(p.originKind))}.
            Record who helped establish this connection, then colour-code their response and activity interest.
          </p>
        </div>
        <button type="button" class="btn btn--ghost btn--sm" data-an-cancel="person">Back</button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="anName">Alumni name <span class="required">*</span></label>
          <input type="text" id="anName" required value="${escapeHtml(p.alumniName || "")}" placeholder="Full name">
        </div>
        <div class="form-group">
          <label for="anWhatsapp">WhatsApp / mobile</label>
          <input type="tel" id="anWhatsapp" value="${escapeHtml(p.whatsapp || p.mobile || "")}" placeholder="10–15 digits">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="anDepartment">Department</label>
          <select id="anDepartment">
            <option value="">Select department</option>
            ${DEPARTMENTS.map((d) => `<option value="${escapeHtml(d.value)}" ${p.department === d.value ? "selected" : ""}>${escapeHtml(d.label)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="anBatch">Passout year</label>
          ${passoutYearSearchFieldHtml("an", p.batch || "")}
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="anEmail">Email</label>
          <input type="email" id="anEmail" value="${escapeHtml(p.email || "")}" placeholder="alumni@email.com">
        </div>
        <div class="form-group">
          <label for="anCompany">Company / institution</label>
          <input type="text" id="anCompany" value="${escapeHtml(p.company || "")}" placeholder="Where they work">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="anJobRole">Job / role</label>
          <input type="text" id="anJobRole" value="${escapeHtml(p.jobRole || "")}" placeholder="Role or designation">
        </div>
        <div class="form-group">
          <label for="anJobSector">Job sector</label>
          <select id="anJobSector">${jobSectorOptionsHtml(p.jobSector || "")}</select>
        </div>
      </div>
      <div class="form-group">
        <label for="anAddress">Address / location</label>
        <input type="text" id="anAddress" value="${escapeHtml(p.address || "")}" placeholder="City or address">
      </div>
      <div class="an-referrer">
        <label for="anReferrerSearch">Connected through (who established this contact)</label>
        <input type="search" id="anReferrerSearch" value="${escapeHtml(state.referrerQuery || p.referredByName || "")}" placeholder="Search Event Desk, network, or Alumni Connect…">
        ${
          p.referredByName
            ? `<p class="an-referrer__picked">
                Linked via <strong>${escapeHtml(p.referredByName)}</strong>
                ${p.referredByPhone ? ` · ${escapeHtml(p.referredByPhone)}` : ""}
                <button type="button" class="btn btn--ghost btn--sm" data-an-clear-referrer="1">Clear</button>
              </p>`
            : `<p class="form-hint">Type at least 2 letters to pick the alumni who introduced this person.</p>`
        }
        ${
          hits.length
            ? `<div class="an-picker">${hits
                .map(
                  (hit) => `
              <button type="button" class="an-picker__item" data-an-pick-referrer="${escapeHtml(hit.source)}:${escapeHtml(hit.id)}">
                <strong>${escapeHtml(hit.name)}</strong>
                <span>${escapeHtml(hit.meta || "")} · ${escapeHtml(optionLabel([...NETWORK_ORIGIN_KINDS, { value: "network", label: "Network" }], hit.source))}</span>
              </button>`
                )
                .join("")}</div>`
            : ""
        }
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="anConnectStatus">Response</label>
          <select id="anConnectStatus">${optionsHtml(NETWORK_CONNECT_STATUS, p.connectStatus || "not_contacted")}</select>
        </div>
        <div class="form-group">
          <label for="anNotes">Notes</label>
          <input type="text" id="anNotes" value="${escapeHtml(p.notes || "")}" placeholder="Follow-up notes">
        </div>
      </div>
      <div class="an-activity-grid">
        ${NETWORK_ACTIVITY_FIELDS.map(
          (f) => `
          <div class="form-group">
            <label for="an_${f.key}">${escapeHtml(f.label)}</label>
            <select id="an_${f.key}" class="table-status-select table-status-select--${activityTone(p[f.key] || "no_response")}">
              ${optionsHtml(NETWORK_ACTIVITY_WILLINGNESS, p[f.key] || "no_response")}
            </select>
          </div>`
        ).join("")}
      </div>
      <div class="an-form__actions">
        <button type="submit" class="btn btn--primary">Save to network</button>
        <button type="button" class="btn btn--ghost" data-an-cancel="person">Cancel</button>
      </div>
    </form>`;
}

function programFormHtml(draft, people) {
  const p = draft || emptyProgram();
  const needsAmount = p.kind === "funding" || p.kind === "sponsorship";
  return `
    <form class="an-form" id="anProgramForm">
      <div class="an-dir-toolbar">
        <div>
          <h3 class="portal-card__title" style="margin-bottom:0.25rem;">${p.id ? "Edit programme" : "Add programme"}</h3>
          <p class="form-hint" style="margin:0;">Link a network alumni, then track talks, sharing, funding, or sponsorship through to completion.</p>
        </div>
        <button type="button" class="btn btn--ghost btn--sm" data-an-cancel="program">Back</button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="anProgType">Type</label>
          <select id="anProgType">${optionsHtml(PROGRAM_KINDS, p.kind || "technical_talk")}</select>
        </div>
        <div class="form-group">
          <label for="anProgTitle">Title <span class="required">*</span></label>
          <input type="text" id="anProgTitle" required value="${escapeHtml(p.title || "")}" placeholder="e.g. Industry talk on embedded systems">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="anProgDate">Date</label>
          <input type="date" id="anProgDate" value="${escapeHtml(p.date || "")}">
        </div>
        <div class="form-group">
          <label for="anProgStatus2">Status</label>
          <select id="anProgStatus2">${optionsHtml(PROGRAM_STATUS, p.status || "planned")}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="anProgAlumni">Alumni from network</label>
          <select id="anProgAlumni">
            <option value="">Select alumni</option>
            ${(people || [])
              .map(
                (a) =>
                  `<option value="${escapeHtml(a.id)}" ${p.alumniId === a.id ? "selected" : ""}>${escapeHtml(a.alumniName || "—")} · ${escapeHtml(String(a.batch || ""))}</option>`
              )
              .join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="anProgDept">Department</label>
          <select id="anProgDept">
            <option value="">College-wide</option>
            ${DEPARTMENTS.map((d) => `<option value="${escapeHtml(d.value)}" ${p.department === d.value ? "selected" : ""}>${escapeHtml(d.label)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="anProgVenue">Venue / mode</label>
          <input type="text" id="anProgVenue" value="${escapeHtml(p.venue || "")}" placeholder="Hall, online, or campus">
        </div>
        <div class="form-group"${needsAmount ? "" : " hidden"} id="anProgAmountWrap">
          <label for="anProgAmount">Amount (₹)</label>
          <input type="number" id="anProgAmount" min="0" step="1" value="${escapeHtml(p.amount ? String(p.amount) : "")}" placeholder="For funding or sponsorship">
        </div>
      </div>
      <div class="form-group">
        <label for="anProgNotes">Notes</label>
        <textarea id="anProgNotes" rows="2">${escapeHtml(p.notes || "")}</textarea>
      </div>
      <div class="an-form__actions">
        <button type="submit" class="btn btn--primary">Save programme</button>
        <button type="button" class="btn btn--ghost" data-an-cancel="program">Cancel</button>
      </div>
    </form>`;
}

function restoreFocus(activeId, cursor) {
  if (!activeId) return;
  const el = document.getElementById(activeId);
  if (!el) return;
  el.focus();
  if (cursor != null && "selectionStart" in el) {
    try {
      el.selectionStart = el.selectionEnd = cursor;
    } catch {
      /* ignore */
    }
  }
}

function applyConnectFiltersFromDom(state) {
  state.connectFilters = readAlumniFilters("anAc", { showDepartment: true });
}

function sourceRecord(state, source, id) {
  if (source === "desk" || source === "event_desk") {
    return state.deskAlumni.find((r) => r.id === id) || null;
  }
  if (source === "connect" || source === "alumni_connect") {
    return state.connectContacts.find((c) => c.id === id) || null;
  }
  if (source === "network") return state.people.find((p) => p.id === id) || null;
  return null;
}

function applyReferrer(draft, hit) {
  draft.referredById = hit.id;
  draft.referredByName = hit.name || "";
  draft.referredByPhone = hit.phone || "";
  draft.referredBySource = hit.source || "";
}

export async function mountAdminAlumniNetwork(wrap, { session, notify } = {}) {
  const toast = (message, type) => notify?.(message, type);
  if (!wrap) return;

  const state = {
    tab: "desk",
    view: "list",
    deskAlumni: [],
    connectContacts: [],
    people: [],
    programs: [],
    deskFilters: { search: "", department: "", batch: "" },
    connectFilters: { validity: "active" },
    dirFilters: { search: "", department: "", batch: "", connectStatus: "", jobSector: "", originKind: "", activityKey: "", activityValue: "" },
    progFilters: { search: "", department: "", batch: "", kind: "", status: "" },
    personDraft: null,
    programDraft: null,
    referrerQuery: "",
    remarksOpenId: "",
    loaded: false,
  };

  async function refresh() {
    const loadSafe = async (fn) => {
      try {
        return await fn();
      } catch (err) {
        console.error(err);
        return [];
      }
    };
    const [enrollments, contacts, people, programs] = await Promise.all([
      loadEventRegistrations(""),
      loadAllAlumniContacts(),
      loadSafe(loadNetworkPeople),
      loadSafe(loadAlumniPrograms),
    ]);
    state.deskAlumni = registeredAlumniReportData(enrollments).alumni || [];
    state.connectContacts = contacts || [];
    state.people = people || [];
    state.programs = programs || [];
    state.loaded = true;
  }

  function readDeskFilters() {
    state.deskFilters = {
      search: document.getElementById("anDeskSearch")?.value || "",
      department: document.getElementById("anDeskDepartment")?.value || "",
      batch: (document.getElementById("anDeskBatch")?.value || "").trim(),
    };
  }

  function readDirFilters() {
    state.dirFilters = {
      search: document.getElementById("anDirSearch")?.value || "",
      department: document.getElementById("anDirDepartment")?.value || "",
      batch: (document.getElementById("anDirBatch")?.value || "").trim(),
      connectStatus: document.getElementById("anDirStatus")?.value || "",
      jobSector: document.getElementById("anDirSector")?.value || "",
      originKind: document.getElementById("anDirOrigin")?.value || "",
      activityKey: document.getElementById("anDirActivity")?.value || "",
      activityValue: document.getElementById("anDirWilling")?.value || "",
    };
  }

  function readProgFilters() {
    state.progFilters = {
      search: document.getElementById("anProgSearch")?.value || "",
      department: document.getElementById("anProgDepartment")?.value || "",
      batch: (document.getElementById("anProgBatch")?.value || "").trim(),
      kind: document.getElementById("anProgKind")?.value || "",
      status: document.getElementById("anProgStatus")?.value || "",
    };
  }

  function readPersonForm() {
    const draft = state.personDraft || emptyPerson();
    return {
      ...draft,
      alumniName: document.getElementById("anName")?.value || "",
      whatsapp: document.getElementById("anWhatsapp")?.value || "",
      department: document.getElementById("anDepartment")?.value || "",
      batch: document.getElementById("anBatch")?.value || "",
      email: document.getElementById("anEmail")?.value || "",
      company: document.getElementById("anCompany")?.value || "",
      jobRole: document.getElementById("anJobRole")?.value || "",
      jobSector: document.getElementById("anJobSector")?.value || "",
      address: document.getElementById("anAddress")?.value || "",
      notes: document.getElementById("anNotes")?.value || "",
      connectStatus: document.getElementById("anConnectStatus")?.value || "not_contacted",
      ...Object.fromEntries(
        NETWORK_ACTIVITY_FIELDS.map((f) => [f.key, document.getElementById(`an_${f.key}`)?.value || "no_response"])
      ),
    };
  }

  function readProgramForm() {
    const alumniId = document.getElementById("anProgAlumni")?.value || "";
    const alumni = state.people.find((p) => p.id === alumniId);
    return {
      ...(state.programDraft || emptyProgram()),
      kind: document.getElementById("anProgType")?.value || "technical_talk",
      title: document.getElementById("anProgTitle")?.value || "",
      date: document.getElementById("anProgDate")?.value || "",
      status: document.getElementById("anProgStatus2")?.value || "planned",
      alumniId,
      alumniName: alumni?.alumniName || document.getElementById("anProgAlumni")?.selectedOptions?.[0]?.text?.split(" · ")[0] || "",
      department: document.getElementById("anProgDept")?.value || alumni?.department || "",
      venue: document.getElementById("anProgVenue")?.value || "",
      amount: document.getElementById("anProgAmount")?.value || "",
      notes: document.getElementById("anProgNotes")?.value || "",
    };
  }

  function openPerson(draft, { referrerQuery = "" } = {}) {
    state.view = "person";
    state.personDraft = { ...emptyPerson(), ...draft };
    state.referrerQuery = referrerQuery || draft.referredByName || "";
    render();
  }

  function openProgram(draft) {
    state.view = "program";
    state.programDraft = { ...emptyProgram(), ...draft };
    render();
  }

  function startAdd(source, id, { via = false } = {}) {
    if (source === "manual") {
      openPerson(emptyPerson());
      return;
    }
    const record = sourceRecord(state, source, id);
    if (!record) return;
    const originKind = source === "desk" ? "event_desk" : source === "connect" ? "alumni_connect" : "network";
    if (via) {
      const draft = emptyPerson();
      applyReferrer(draft, {
        id: record.id,
        name: record.alumniName || record.name,
        phone: record.whatsapp || record.mobile || record.phone,
        source: originKind === "network" ? "network" : originKind,
      });
      openPerson(draft, { referrerQuery: draft.referredByName });
      return;
    }
    const existing = matchNetworkPerson(state.people, record);
    if (existing) {
      openPerson(existing);
      toast("Already in the network — you can update details.", "");
      return;
    }
    openPerson(personFromSource(record, originKind === "network" ? "manual" : originKind));
  }

  async function savePerson(event) {
    event.preventDefault();
    try {
      const form = readPersonForm();
      const existing = form.id ? state.people.find((p) => p.id === form.id) || form : {};
      const payload = personPayload(form, session, existing);
      if (!form.id) payload.createdAt = serverTimestamp();
      if (form.id) {
        await updateDoc(doc(db, ALUMNI_NETWORK_COLLECTION, form.id), withSession(payload));
      } else {
        await addDoc(collection(db, ALUMNI_NETWORK_COLLECTION), withSession(payload));
      }
      toast("Alumni saved to the network.", "success");
      state.view = "list";
      state.tab = "directory";
      state.personDraft = null;
      await refresh();
      render();
    } catch (err) {
      console.error(err);
      toast(err.message || "Could not save alumni.", "error");
    }
  }

  async function saveProgram(event) {
    event.preventDefault();
    try {
      const form = readProgramForm();
      const existing = form.id ? state.programs.find((p) => p.id === form.id) || form : {};
      const payload = programPayload(form, session, existing);
      if (!form.id) payload.createdAt = serverTimestamp();
      if (form.id) {
        await updateDoc(doc(db, ALUMNI_PROGRAMS_COLLECTION, form.id), withSession(payload));
      } else {
        await addDoc(collection(db, ALUMNI_PROGRAMS_COLLECTION), withSession(payload));
      }
      toast("Programme saved.", "success");
      state.view = "list";
      state.tab = "programs";
      state.programDraft = null;
      await refresh();
      render();
    } catch (err) {
      console.error(err);
      toast(err.message || "Could not save programme.", "error");
    }
  }

  async function addRemark(personId) {
    const person = state.people.find((p) => p.id === personId);
    const box = document.getElementById("anRemarkText");
    const text = String(box?.value || "").trim().slice(0, REMARK_MAX_LENGTH);
    if (!person) return;
    if (!text) {
      toast("Type a remark first.", "error");
      box?.focus();
      return;
    }
    const remark = {
      id: crypto.randomUUID(),
      text,
      byName: actorName(session),
      byUserId: session?.userId || "",
      at: Timestamp.now(),
    };
    const btn = wrap.querySelector("[data-an-remark-add]");
    if (btn) btn.disabled = true;
    try {
      await updateDoc(
        doc(db, ALUMNI_NETWORK_COLLECTION, personId),
        withSession({ remarks: arrayUnion(remark), updatedAt: serverTimestamp() })
      );
      person.remarks = [...(person.remarks || []), remark];
      toast("Remark saved.", "success");
      render();
      document.getElementById("anRemarkText")?.focus();
    } catch (err) {
      console.error(err);
      toast("Could not save the remark.", "error");
      if (btn) btn.disabled = false;
    }
  }

  async function deleteRemark(personId, remarkId) {
    const person = state.people.find((p) => p.id === personId);
    const remark = (person?.remarks || []).find((r) => r.id === remarkId);
    if (!person || !remark) return;
    if (!window.confirm(`Delete this remark?\n\n"${remark.text}"`)) return;
    try {
      await updateDoc(
        doc(db, ALUMNI_NETWORK_COLLECTION, personId),
        withSession({ remarks: arrayRemove(remark), updatedAt: serverTimestamp() })
      );
      person.remarks = person.remarks.filter((r) => r !== remark);
      toast("Remark deleted.", "success");
      render();
    } catch (err) {
      console.error(err);
      toast("Could not delete the remark.", "error");
    }
  }

  async function patchPerson(id, field, value) {
    const person = state.people.find((p) => p.id === id);
    if (!person) return;
    person[field] = value;
    try {
      await updateDoc(
        doc(db, ALUMNI_NETWORK_COLLECTION, id),
        withSession({ [field]: value, updatedAt: serverTimestamp() })
      );
    } catch (err) {
      console.error(err);
      toast("Could not update status.", "error");
      await refresh();
      render();
    }
  }

  async function patchProgram(id, field, value) {
    const program = state.programs.find((p) => p.id === id);
    if (!program) return;
    program[field] = value;
    try {
      await updateDoc(
        doc(db, ALUMNI_PROGRAMS_COLLECTION, id),
        withSession({ [field]: value, updatedAt: serverTimestamp() })
      );
    } catch (err) {
      console.error(err);
      toast("Could not update programme.", "error");
      await refresh();
      render();
    }
  }

  async function runReport(kind) {
    try {
      const mod = await import("./alumni-network-report.js?v=er35");
      const generatedBy = actorName(session);
      if (kind === "network-pdf") await mod.downloadNetworkPdf({ people: state.people, generatedBy });
      if (kind === "network-xlsx") await mod.downloadNetworkExcel({ people: state.people, generatedBy });
      if (kind === "programs-pdf") await mod.downloadProgramsPdf({ programs: state.programs, generatedBy });
      if (kind === "programs-xlsx") await mod.downloadProgramsExcel({ programs: state.programs, generatedBy });
    } catch (err) {
      console.error(err);
      toast("Could not generate the report.", "error");
    }
  }

  function bind() {
    wrap.querySelectorAll("[data-an-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.tab = btn.dataset.anTab;
        state.view = "list";
        render();
      });
    });

    ["anDeskSearch", "anDeskDepartment", "anDeskBatch"].forEach((id) => {
      const el = document.getElementById(id);
      el?.addEventListener("input", () => {
        readDeskFilters();
        render();
      });
      el?.addEventListener("change", () => {
        readDeskFilters();
        render();
      });
    });

    document.getElementById("anAcApplyFilters")?.addEventListener("click", () => {
      applyConnectFiltersFromDom(state);
      render();
    });
    document.getElementById("anAcResetFilters")?.addEventListener("click", () => {
      state.connectFilters = { validity: "active" };
      render();
    });
    ["anAcSearch", "anAcDepartment", "anAcWillingness", "anAcRegistration", "anAcBatch", "anAcSector"].forEach((id) => {
      const el = document.getElementById(id);
      el?.addEventListener("input", () => {
        applyConnectFiltersFromDom(state);
        render();
      });
      el?.addEventListener("change", () => {
        applyConnectFiltersFromDom(state);
        render();
      });
    });

    ["anDirSearch", "anDirDepartment", "anDirBatch", "anDirStatus", "anDirOrigin", "anDirSector", "anDirActivity", "anDirWilling"].forEach((id) => {
      const el = document.getElementById(id);
      el?.addEventListener("input", () => {
        readDirFilters();
        render();
      });
      el?.addEventListener("change", () => {
        readDirFilters();
        render();
      });
    });

    ["anProgSearch", "anProgDepartment", "anProgBatch", "anProgKind", "anProgStatus"].forEach((id) => {
      const el = document.getElementById(id);
      el?.addEventListener("input", () => {
        readProgFilters();
        render();
      });
      el?.addEventListener("change", () => {
        readProgFilters();
        render();
      });
    });

    wrap.querySelectorAll("[data-an-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [source, id] = String(btn.dataset.anAdd).split(":");
        startAdd(source, id);
      });
    });
    wrap.querySelectorAll("[data-an-via]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [source, id] = String(btn.dataset.anVia).split(":");
        startAdd(source, id, { via: true });
      });
    });
    wrap.querySelectorAll("[data-an-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const person = state.people.find((p) => p.id === btn.dataset.anEdit);
        if (person) openPerson(person);
      });
    });
    wrap.querySelectorAll("[data-an-program-for]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const person = state.people.find((p) => p.id === btn.dataset.anProgramFor);
        if (!person) return;
        openProgram({
          ...emptyProgram(),
          alumniId: person.id,
          alumniName: person.alumniName,
          department: person.department || "",
        });
      });
    });
    wrap.querySelectorAll("[data-an-program-new]").forEach((btn) => {
      btn.addEventListener("click", () => openProgram(emptyProgram()));
    });
    wrap.querySelectorAll("[data-an-program-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const program = state.programs.find((p) => p.id === btn.dataset.anProgramEdit);
        if (program) openProgram(program);
      });
    });
    wrap.querySelectorAll("[data-an-cancel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.view = "list";
        state.personDraft = null;
        state.programDraft = null;
        if (btn.dataset.anCancel === "program") state.tab = "programs";
        render();
      });
    });
    wrap.querySelectorAll("[data-an-remarks]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.anRemarks;
        state.remarksOpenId = state.remarksOpenId === id ? "" : id;
        render();
        if (state.remarksOpenId) document.getElementById("anRemarkText")?.focus();
      });
    });
    wrap.querySelectorAll("[data-an-remarks-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.remarksOpenId = "";
        render();
      });
    });
    wrap.querySelectorAll("[data-an-remark-add]").forEach((btn) => {
      btn.addEventListener("click", () => addRemark(btn.dataset.anRemarkAdd));
    });
    document.getElementById("anRemarkText")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        addRemark(state.remarksOpenId);
      }
      if (e.key === "Escape") {
        state.remarksOpenId = "";
        render();
      }
    });
    wrap.querySelectorAll("[data-an-remark-delete]").forEach((btn) => {
      btn.addEventListener("click", () =>
        deleteRemark(btn.dataset.anRemarkPerson, btn.dataset.anRemarkDelete)
      );
    });
    wrap.querySelectorAll("[data-an-patch]").forEach((el) => {
      el.addEventListener("change", async () => {
        const toneFn = el.dataset.anField === "connectStatus" ? connectTone : activityTone;
        el.className = `table-status-select table-status-select--${toneFn(el.value)}`;
        await patchPerson(el.dataset.anPatch, el.dataset.anField, el.value);
      });
    });
    wrap.querySelectorAll("[data-an-prog-patch]").forEach((el) => {
      el.addEventListener("change", async () => {
        el.className = `table-status-select table-status-select--${programTone(el.value)}`;
        await patchProgram(el.dataset.anProgPatch, el.dataset.anField, el.value);
      });
    });
    wrap.querySelectorAll("[data-an-report]").forEach((btn) => {
      btn.addEventListener("click", () => runReport(btn.dataset.anReport));
    });

    document.getElementById("anPersonForm")?.addEventListener("submit", savePerson);
    document.getElementById("anProgramForm")?.addEventListener("submit", saveProgram);
    document.getElementById("anReferrerSearch")?.addEventListener("input", (e) => {
      state.personDraft = readPersonForm();
      state.referrerQuery = e.target.value;
      render();
    });
    wrap.querySelectorAll("[data-an-pick-referrer]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [source, id] = String(btn.dataset.anPickReferrer).split(":");
        const record = sourceRecord(state, source === "event_desk" ? "desk" : source === "alumni_connect" ? "connect" : "network", id);
        state.personDraft = readPersonForm();
        if (record) {
          applyReferrer(state.personDraft, {
            id: record.id,
            name: record.alumniName || record.name,
            phone: record.whatsapp || record.mobile || record.phone,
            source,
          });
          state.referrerQuery = state.personDraft.referredByName;
        }
        render();
      });
    });
    wrap.querySelector("[data-an-clear-referrer]")?.addEventListener("click", () => {
      state.personDraft = readPersonForm();
      state.personDraft.referredById = "";
      state.personDraft.referredByName = "";
      state.personDraft.referredByPhone = "";
      state.personDraft.referredBySource = "";
      state.referrerQuery = "";
      render();
    });
    document.getElementById("anProgType")?.addEventListener("change", () => {
      state.programDraft = readProgramForm();
      render();
    });
    document.getElementById("anProgAlumni")?.addEventListener("change", () => {
      const alumniId = document.getElementById("anProgAlumni")?.value || "";
      const alumni = state.people.find((p) => p.id === alumniId);
      const dept = document.getElementById("anProgDept");
      if (alumni && dept && !dept.value) dept.value = alumni.department || "";
    });
  }

  function render() {
    const activeId = document.activeElement?.id;
    const cursor =
      document.activeElement && "selectionStart" in document.activeElement
        ? document.activeElement.selectionStart
        : null;
    const stats = summarizeNetwork(state.people, state.programs);
    const body =
      state.view === "person"
        ? personFormHtml(state.personDraft, state)
        : state.view === "program"
          ? programFormHtml(state.programDraft, state.people)
          : state.tab === "desk"
            ? deskTabHtml(state)
            : state.tab === "connect"
              ? connectTabHtml(state)
              : state.tab === "directory"
                ? directoryTabHtml(state)
                : state.tab === "programs"
                  ? programsTabHtml(state)
                  : reportsTabHtml(state);

    wrap.innerHTML = `
      <div class="an-admin">
        ${statsHtml(stats)}
        ${legendHtml()}
        ${state.view === "list" ? tabsHtml(state.tab) : ""}
        ${body}
      </div>`;

    if (state.tab === "connect" && state.view === "list") {
      const filters = state.connectFilters || {};
      const setVal = (id, value) => {
        const el = document.getElementById(id);
        if (el && value) el.value = value;
      };
      setVal("anAcSearch", filters.search);
      setVal("anAcDepartment", filters.department);
      setVal("anAcWillingness", filters.willingness);
      setVal("anAcRegistration", filters.registrationStatus);
      setVal("anAcBatch", filters.batch);
      setVal("anAcSector", filters.jobSector);
    }
    bind();
    fitRemarksPanel();
    restoreFocus(activeId, cursor);
  }

  /** Keep the remarks panel as wide as the visible part of the table, not the whole scrolling table. */
  function fitRemarksPanel() {
    const panel = wrap.querySelector(".an-remarks");
    const scroller = panel?.closest(".table-scroll");
    if (!panel || !scroller) return;
    const cell = panel.parentElement;
    const pad = cell ? parseFloat(getComputedStyle(cell).paddingLeft) + parseFloat(getComputedStyle(cell).paddingRight) : 0;
    panel.style.width = `${Math.max(280, scroller.clientWidth - pad)}px`;
  }
  window.addEventListener("resize", fitRemarksPanel);

  wrap.innerHTML = '<p class="empty-state">Loading alumni network…</p>';
  try {
    await refresh();
    render();
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="empty-state">Could not load the alumni network.</p>';
  }
}
