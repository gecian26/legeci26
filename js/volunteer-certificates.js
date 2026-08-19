import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { withSession } from "./auth.js";
import {
  TASK_TYPES,
  DEPT_TASKS_COLLECTION,
  CERTIFICATE_TEMPLATES,
  CERTIFICATE_PERIOD,
  CERTIFICATE_ISSUER,
  CERTIFICATE_INSTITUTION,
  CERTIFICATE_SIGNATORIES,
  DEPARTMENTS,
  escapeHtml,
  escapeHtmlWithOrdinals,
  formatDateShort,
  normalizeUsername,
} from "./constants.js";
import {
  downloadCertificateVolunteerTemplate,
  parseCertificateVolunteerExcel,
} from "./volunteer-certificates-excel.js";
import {
  downloadVolunteerCertificatesPdf,
  downloadSampleCertificatePdf,
  certificateTemplateLabel,
  normalizeCertificateTemplate,
} from "./volunteer-certificates-pdf.js";

export function isVolunteerCertificateTask(task) {
  return task?.taskType === TASK_TYPES.VOLUNTEER_CERTIFICATE;
}

/** Certificate PDF batches are stored on dept_tasks so current Firestore rules allow faculty writes. */
export const CERTIFICATE_BATCH_KIND = "certificate_batch";

export function isCertificateBatchRecord(doc) {
  return doc?.kind === CERTIFICATE_BATCH_KIND;
}

function deptLabel(code) {
  return DEPARTMENTS.find((d) => d.value === code)?.label || code || "—";
}

export async function saveCertificateBatch(payload) {
  const volunteers = (payload.volunteers || []).map((v) => ({
    fullName: String(v.fullName || "").trim(),
    affiliation: String(v.affiliation || "").trim(),
    semester: String(v.semester || "").trim(),
    department: String(v.department || payload.department || "").trim(),
  }));
  return addDoc(
    collection(db, DEPT_TASKS_COLLECTION),
    withSession({
      kind: CERTIFICATE_BATCH_KIND,
      title: "Volunteer certificates",
      description: "Internship certificate batch",
      department: payload.department || "",
      team: payload.team || "",
      taskType: TASK_TYPES.VOLUNTEER_CERTIFICATE,
      status: "done",
      progress: 100,
      assigneeUserIds: [],
      templateId: normalizeCertificateTemplate(payload.templateId),
      volunteers,
      count: volunteers.length,
      uploadedByUserId: payload.uploadedByUserId || "",
      uploadedByName: payload.uploadedByName || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
}

export async function loadCertificateBatches(department = null) {
  const snap = await getDocs(collection(db, DEPT_TASKS_COLLECTION));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(
      (b) =>
        isCertificateBatchRecord(b) &&
        !b._deleted &&
        (!department || b.department === department)
    )
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() || Date.parse(a.createdAt) || 0;
      const tb = b.createdAt?.toMillis?.() || Date.parse(b.createdAt) || 0;
      return tb - ta;
    });
}

function templateCardsHtml(selected = "classic") {
  return `
    <div class="vc-templates" role="listbox" aria-label="Certificate templates">
      ${CERTIFICATE_TEMPLATES.map((t) => {
        const active = t.id === selected;
        return `
        <button type="button" class="vc-template-card ${active ? "vc-template-card--active" : ""}" data-vc-template="${escapeHtml(t.id)}" aria-pressed="${active}">
          <span class="vc-template-card__preview vc-template-card__preview--${escapeHtml(t.id)}" aria-hidden="true">
            <span class="vc-template-card__logo">LEGECI</span>
            <span class="vc-template-card__title">Certificate</span>
            <span class="vc-template-card__line"></span>
            <span class="vc-template-card__sigs"></span>
          </span>
          <strong>${escapeHtml(t.name)}</strong>
          <span>${escapeHtml(t.description)}</span>
        </button>`;
      }).join("")}
    </div>`;
}

function volunteersTableHtml(volunteers) {
  if (!volunteers.length) {
    return '<p class="empty-state">Upload the Excel template to load volunteers.</p>';
  }
  return `
    <div class="table-scroll">
      <table class="data-table data-table--dense">
        <thead>
          <tr>
            <th>
              <input type="checkbox" id="vcSelectAll" checked aria-label="Select all volunteers">
            </th>
            <th>Name</th>
            <th>Of (affiliation)</th>
            <th>Semester</th>
            <th>Department</th>
          </tr>
        </thead>
        <tbody>
          ${volunteers
            .map(
              (v, i) => `
            <tr>
              <td>
                <input type="checkbox" data-vc-row="${i}" checked aria-label="Include ${escapeHtml(v.fullName)}">
              </td>
              <td><strong>${escapeHtml(v.fullName)}</strong></td>
              <td>${escapeHtml(v.affiliation)}</td>
              <td>${escapeHtml(v.semester || "—")}</td>
              <td>${escapeHtml(v.department || "—")}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function batchesHtml(batches) {
  if (!batches.length) {
    return '<p class="empty-state">No saved certificate batches yet. Generate certificates to keep a copy here.</p>';
  }
  return `
    <div class="table-scroll">
      <table class="data-table data-table--dense">
        <thead>
          <tr>
            <th>Uploaded</th>
            <th>Volunteers</th>
            <th>Template</th>
            <th>By</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${batches
            .map((b) => {
              const when = b.createdAt?.toDate
                ? formatDateShort(b.createdAt.toDate().toISOString().slice(0, 10))
                : "—";
              return `
            <tr>
              <td>${escapeHtml(when)}</td>
              <td><strong>${Number(b.count) || (b.volunteers || []).length}</strong></td>
              <td>${escapeHtml(certificateTemplateLabel(b.templateId))}</td>
              <td>${escapeHtml(b.uploadedByName || "—")}</td>
              <td class="table-actions">
                <button type="button" class="btn btn--ghost btn--sm" data-vc-reload="${escapeHtml(b.id)}">Load list</button>
                <button type="button" class="btn btn--primary btn--sm" data-vc-regen="${escapeHtml(b.id)}">Generate PDF</button>
              </td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function selectedVolunteers(state) {
  const wrap = document.getElementById("vcTableWrap");
  if (!wrap) return [...state.volunteers];
  const checked = [...wrap.querySelectorAll("[data-vc-row]:checked")].map((el) =>
    Number(el.dataset.vcRow)
  );
  if (!checked.length) return [];
  return state.volunteers.filter((_, i) => checked.includes(i));
}

export async function mountVolunteerCertificates(wrap, { session, notify } = {}) {
  const toast = (message, type) => notify?.(message, type);
  if (!wrap) return;

  const state = {
    volunteers: [],
    templateId: "classic",
    batches: [],
    parseErrors: [],
  };

  const signatoryLine = CERTIFICATE_SIGNATORIES.map((s) => `${s.name}, ${s.title}`).join(" · ");

  wrap.innerHTML = `
    <div class="vc-dashboard">
      <div class="vc-copy">
        <p>
          This is to certify that <em>…………………………..</em> of <em>……………………</em>
          (<em>Semester</em>) has successfully
          completed the internship towards <strong>various initiatives</strong>
          of <strong>${escapeHtml(CERTIFICATE_ISSUER)}</strong>,
          <strong>${escapeHtml(CERTIFICATE_INSTITUTION)}</strong>
          during <strong>${escapeHtmlWithOrdinals(CERTIFICATE_PERIOD)}</strong>.
        </p>
        <p class="form-hint" style="margin:0.5rem 0 0;">
          Signatories: ${escapeHtml(signatoryLine)}. Each PDF page includes the LEGECI logo.
        </p>
      </div>

      <div class="vc-actions">
        <button type="button" class="btn btn--ghost" id="vcDownloadTemplate">Download Excel template</button>
        <label class="btn btn--ghost vc-file-btn">
          Upload volunteer list
          <input type="file" id="vcExcel" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
        </label>
      </div>
      <p class="form-hint" style="margin:0;">
        Columns: <code>fullName</code>, <code>affiliation</code> (the “of …” text), <code>semester</code> (S1–S8), <code>department</code>.
        Download a fresh template if your file is missing semester.
      </p>
      <div id="vcUploadResult"></div>

      <div>
        <div class="ac-dashboard__toolbar" style="margin-bottom:0.65rem;">
          <h3 class="ac-dashboard__subtitle" style="margin:0;">Volunteer list</h3>
          <p class="ac-results-meta" id="vcMeta" style="margin:0;"></p>
        </div>
        <div id="vcTableWrap">${volunteersTableHtml([])}</div>
      </div>

      <div>
        <h3 class="ac-dashboard__subtitle">Choose certificate template</h3>
        ${templateCardsHtml(state.templateId)}
        <div class="vc-actions" style="margin-top:1rem;">
          <button type="button" class="btn btn--ghost" id="vcPreviewSample">Preview sample PDF</button>
          <button type="button" class="btn btn--primary" id="vcGenerate">Generate certificates PDF</button>
        </div>
      </div>

      <div>
        <h3 class="ac-dashboard__subtitle">Saved batches — ${escapeHtml(deptLabel(session?.department))}</h3>
        <p class="form-hint" style="margin-top:0;">Previously generated lists for your department. Load to edit the working list, or generate again.</p>
        <div id="vcBatchesWrap"><p class="empty-state">Loading…</p></div>
      </div>
    </div>`;

  const setMeta = () => {
    const el = document.getElementById("vcMeta");
    if (el) el.textContent = state.volunteers.length
      ? `${state.volunteers.length} volunteer${state.volunteers.length === 1 ? "" : "s"} loaded`
      : "No volunteers loaded";
  };

  const renderTable = () => {
    const tableEl = document.getElementById("vcTableWrap");
    if (tableEl) tableEl.innerHTML = volunteersTableHtml(state.volunteers);
    setMeta();
  };

  const renderBatches = () => {
    const el = document.getElementById("vcBatchesWrap");
    if (el) el.innerHTML = batchesHtml(state.batches);
  };

  const selectTemplate = (id) => {
    state.templateId = normalizeCertificateTemplate(id);
    wrap.querySelectorAll("[data-vc-template]").forEach((btn) => {
      const active = btn.dataset.vcTemplate === state.templateId;
      btn.classList.toggle("vc-template-card--active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  };

  const loadBatches = async () => {
    try {
      state.batches = await loadCertificateBatches(session?.department || null);
      renderBatches();
    } catch (err) {
      const el = document.getElementById("vcBatchesWrap");
      if (el) {
        el.innerHTML =
          '<p class="empty-state">No saved batches yet. Generate certificates to keep a copy here.</p>';
      }
    }
  };

  const generateFor = async (volunteers, btn, { saveBatch = false } = {}) => {
    if (!volunteers.length) {
      toast && toast("Select at least one volunteer.", "error");
      return;
    }
    const original = btn?.textContent;
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = `Generating ${volunteers.length}…`;
      }
      await downloadVolunteerCertificatesPdf({
        volunteers,
        templateId: state.templateId,
      });
      if (saveBatch && session) {
        try {
          await saveCertificateBatch({
            department: session.department || "",
            team: session.team || "",
            templateId: state.templateId,
            volunteers,
            uploadedByUserId: session.username ? normalizeUsername(session.username) : "",
            uploadedByName: session.displayName || session.username || "",
          });
          await loadBatches();
        } catch (saveErr) {
          console.warn("Certificate batch was generated but not saved.", saveErr);
          toast && toast("PDF downloaded. Saved history is unavailable right now.", "success");
          return;
        }
      }
      toast && toast("Certificates PDF downloaded.", "success");
    } catch (err) {
      console.error(err);
      toast && toast(err.message || "Could not generate certificates.", "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = original || "Generate certificates PDF";
      }
    }
  };

  wrap.addEventListener("click", async (e) => {
    const templateBtn = e.target.closest("[data-vc-template]");
    if (templateBtn) {
      selectTemplate(templateBtn.dataset.vcTemplate);
      return;
    }

    if (e.target.id === "vcSelectAll") {
      const on = e.target.checked;
      wrap.querySelectorAll("[data-vc-row]").forEach((el) => {
        el.checked = on;
      });
      return;
    }

    if (e.target.id === "vcDownloadTemplate") {
      try {
        await downloadCertificateVolunteerTemplate();
        toast && toast("Excel template downloaded.", "success");
      } catch (err) {
        console.error(err);
        toast && toast(err?.message || "Could not generate template.", "error");
      }
      return;
    }

    if (e.target.id === "vcPreviewSample") {
      const btn = e.target;
      const original = btn.textContent;
      try {
        btn.disabled = true;
        btn.textContent = "Preparing…";
        await downloadSampleCertificatePdf(state.templateId);
        toast && toast("Sample certificate downloaded.", "success");
      } catch (err) {
        console.error(err);
        toast && toast("Could not generate sample PDF.", "error");
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
      return;
    }

    if (e.target.id === "vcGenerate") {
      await generateFor(selectedVolunteers(state), e.target, { saveBatch: true });
      return;
    }

    const reloadBtn = e.target.closest("[data-vc-reload]");
    if (reloadBtn) {
      const batch = state.batches.find((b) => b.id === reloadBtn.dataset.vcReload);
      if (!batch) return;
      state.volunteers = [...(batch.volunteers || [])];
      selectTemplate(batch.templateId);
      renderTable();
      toast && toast(`Loaded ${state.volunteers.length} volunteers.`, "success");
      return;
    }

    const regenBtn = e.target.closest("[data-vc-regen]");
    if (regenBtn) {
      const batch = state.batches.find((b) => b.id === regenBtn.dataset.vcRegen);
      if (!batch) return;
      state.templateId = normalizeCertificateTemplate(batch.templateId);
      selectTemplate(state.templateId);
      await generateFor(batch.volunteers || [], regenBtn, { saveBatch: false });
    }
  });

  wrap.querySelector("#vcExcel")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    const resultEl = document.getElementById("vcUploadResult");
    if (!file) return;
    try {
      const { volunteers, errors } = await parseCertificateVolunteerExcel(file);
      state.volunteers = volunteers;
      state.parseErrors = errors;
      renderTable();
      if (resultEl) {
        resultEl.innerHTML = `
          <p><strong>Loaded:</strong> ${volunteers.length}
            ${errors.length ? `&nbsp;|&nbsp; <strong>Skipped:</strong> ${errors.length}` : ""}</p>
          ${
            errors.length
              ? `<ul class="vc-errors">${errors
                  .slice(0, 15)
                  .map((m) => `<li>${escapeHtml(m)}</li>`)
                  .join("")}${errors.length > 15 ? "<li>…</li>" : ""}</ul>`
              : ""
          }`;
      }
      toast &&
        toast(
          volunteers.length
            ? `Loaded ${volunteers.length} volunteer${volunteers.length === 1 ? "" : "s"}.`
            : "No valid volunteer rows found.",
          volunteers.length ? "success" : "error"
        );
    } catch (err) {
      console.error(err);
      toast && toast("Could not read Excel file.", "error");
    } finally {
      e.target.value = "";
    }
  });

  setMeta();
  await loadBatches();
}
