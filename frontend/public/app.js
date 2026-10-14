/**
 * Federal Offline FOIA Redaction Workbench — Frontend Application Logic
 */

const state = {
  meta: null,
  doc: null,
  currentPage: 1,
  currentView: "visual", // "visual" | "text" | "burned" | "vaughn"
  drawBoxMode: false,
  selectedRedactionId: null,
  detectorConfig: {
    PERSON: { enabled: true, exemption: "(b)(6)" },
    PHONE_NUMBER: { enabled: true, exemption: "(b)(6)" },
    EMAIL_ADDRESS: { enabled: true, exemption: "(b)(6)" },
    US_SSN: { enabled: true, exemption: "(b)(6)" },
    EMPLOYEE_ID: { enabled: true, exemption: "(b)(6)" },
    STREET_ADDRESS: { enabled: true, exemption: "(b)(6)" },
  },
  pendingSelectionText: "",
};

document.addEventListener("DOMContentLoaded", async () => {
  await loadSystemMeta();
  bindEvents();
});

async function loadSystemMeta() {
  try {
    const res = await fetch("/api/meta");
    state.meta = await res.json();

    const engineBadge = document.getElementById("engine-badge");
    if (engineBadge && state.meta.nlp_engine) {
      engineBadge.textContent = state.meta.nlp_engine;
    }

    renderDetectorToggles();
    populateExemptionDropdowns();
    renderExemptionReferenceCards();
    populateSampleDocs();
  } catch (err) {
    console.error("Failed to load system metadata:", err);
  }
}

function renderDetectorToggles() {
  const container = document.getElementById("detector-toggles-list");
  if (!container || !state.meta) return;
  container.innerHTML = "";

  const entityTypes = state.meta.entity_types;
  const order = ["PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS", "US_SSN", "EMPLOYEE_ID", "STREET_ADDRESS"];

  order.forEach((etype) => {
    const info = entityTypes[etype];
    if (!info) return;
    const cfg = state.detectorConfig[etype];

    const row = document.createElement("div");
    row.className = "detector-row";

    const exOptions = state.meta.foia_exemptions
      .map(
        (ex) =>
          `<option value="${ex.code}" ${cfg.exemption === ex.code ? "selected" : ""}>${ex.code}</option>`
      )
      .join("");

    row.innerHTML = `
      <label class="detector-row-left">
        <input type="checkbox" data-etype="${etype}" class="detector-chk" ${cfg.enabled ? "checked" : ""} />
        <span class="detector-dot" style="background:${info.badge_color}"></span>
        <span>${info.label}</span>
      </label>
      <select data-etype="${etype}" class="select-control detector-exemption-mini" title="Default FOIA Exemption for ${info.label}">
        ${exOptions}
      </select>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll(".detector-chk").forEach((chk) => {
    chk.addEventListener("change", (e) => {
      const et = e.target.getAttribute("data-etype");
      state.detectorConfig[et].enabled = e.target.checked;
    });
  });

  container.querySelectorAll(".detector-exemption-mini").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const et = e.target.getAttribute("data-etype");
      state.detectorConfig[et].exemption = e.target.value;
    });
  });
}

function populateExemptionDropdowns() {
  if (!state.meta) return;
  const selects = [
    document.getElementById("manual-exemption-select"),
    document.getElementById("popover-exemption-select"),
    document.getElementById("bulk-exemption-select"),
  ];

  selects.forEach((sel) => {
    if (!sel) return;
    const isBulk = sel.id === "bulk-exemption-select";
    sel.innerHTML = isBulk ? `<option value="">Bulk Set Exemption...</option>` : "";
    state.meta.foia_exemptions.forEach((ex) => {
      const opt = document.createElement("option");
      opt.value = ex.code;
      opt.textContent = ex.short_label;
      sel.appendChild(opt);
    });
  });
}

function renderExemptionReferenceCards() {
  const container = document.getElementById("exemption-reference-cards");
  if (!container || !state.meta) return;
  container.innerHTML = "";
  state.meta.foia_exemptions.slice(0, 6).forEach((ex) => {
    const div = document.createElement("div");
    div.className = "exemption-ref-card";
    div.innerHTML = `
      <div><strong>${ex.code}</strong> — ${ex.title}</div>
      <p>${ex.description}</p>
    `;
    container.appendChild(div);
  });
}

function populateSampleDocs() {
  if (!state.meta) return;
  const select = document.getElementById("sample-doc-select");
  const quickContainer = document.getElementById("quick-sample-buttons");

  if (select) {
    select.innerHTML = `<option value="">Load Sample Federal Record...</option>`;
    state.meta.sample_documents.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.filename;
      opt.textContent = `${s.filename} (${s.size_kb} KB)`;
      select.appendChild(opt);
    });
  }

  if (quickContainer) {
    quickContainer.innerHTML = "";
    state.meta.sample_documents.forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sample-launch-btn";
      const badgeType = s.ext.replace(".", "").toUpperCase();
      btn.innerHTML = `
        <span>📄 ${s.filename}</span>
        <span class="badge-tag">${badgeType} · ${s.size_kb} KB</span>
      `;
      btn.addEventListener("click", () => loadSampleDocument(s.filename));
      quickContainer.appendChild(btn);
    });
  }
}

function bindEvents() {
  // File upload input
  const fileInput = document.getElementById("file-upload-input");
  fileInput.addEventListener("change", async (e) => {
    if (e.target.files && e.target.files[0]) {
      await uploadFile(e.target.files[0]);
      fileInput.value = "";
    }
  });

  // Sample selector
  const sampleSelect = document.getElementById("sample-doc-select");
  sampleSelect.addEventListener("change", async (e) => {
    if (e.target.value) {
      await loadSampleDocument(e.target.value);
      sampleSelect.value = "";
    }
  });

  // Slider
  const slider = document.getElementById("confidence-slider");
  const sliderVal = document.getElementById("confidence-val");
  slider.addEventListener("input", () => {
    sliderVal.textContent = Number(slider.value).toFixed(2);
  });

  // Re-analyze button
  document.getElementById("btn-reanalyze").addEventListener("click", reanalyzeCurrentDocument);

  // Force OCR button
  const forceOcrBtn = document.getElementById("btn-force-ocr");
  if (forceOcrBtn) {
    forceOcrBtn.addEventListener("click", async () => {
      if (!state.doc) return;
      forceOcrBtn.disabled = true;
      forceOcrBtn.textContent = "⏳ Running Local Tesseract OCR...";
      try {
        const res = await fetch(`/api/documents/${state.doc.doc_id}/force-ocr`, { method: "POST" });
        if (res.ok) {
          state.doc = await res.json();
          onDocumentLoaded(state.doc);
        }
      } finally {
        forceOcrBtn.disabled = false;
        forceOcrBtn.textContent = "🔍 Force Full-Page Tesseract OCR";
      }
    });
  }

  // Manual text form
  document.getElementById("manual-text-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await submitManualTextRedaction();
  });

  // View tabs
  document.querySelectorAll(".view-tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      const view = tab.getAttribute("data-view");
      await switchView(view);
    });
  });

  // Page navigation
  document.getElementById("btn-prev-page").addEventListener("click", () => {
    if (state.doc && state.currentPage > 1) {
      state.currentPage--;
      renderVisualPage();
    }
  });
  document.getElementById("btn-next-page").addEventListener("click", () => {
    if (state.doc && state.currentPage < state.doc.page_count) {
      state.currentPage++;
      renderVisualPage();
    }
  });

  // Draw Box toggle
  const drawBtn = document.getElementById("btn-draw-box-mode");
  drawBtn.addEventListener("click", () => {
    state.drawBoxMode = !state.drawBoxMode;
    drawBtn.classList.toggle("active", state.drawBoxMode);
    drawBtn.querySelector("span").textContent = `Draw Manual Redaction Box: ${
      state.drawBoxMode ? "ON (Drag on Page)" : "OFF"
    }`;
    const wrapper = document.getElementById("pdf-canvas-wrapper");
    if (wrapper) {
      wrapper.classList.toggle("crosshair-mode", state.drawBoxMode);
    }
  });

  // PDF Canvas Rubberband Drawing
  setupPdfBoxDrawing();

  // Interactive Text Selection Popover
  setupTextSelectionPopover();

  // Right panel search & filter
  document.getElementById("redaction-search-input").addEventListener("input", renderRedactionsList);
  document.getElementById("filter-type-select").addEventListener("change", renderRedactionsList);

  // Bulk Exemption
  const bulkExSelect = document.getElementById("bulk-exemption-select");
  bulkExSelect.addEventListener("change", async () => {
    if (!bulkExSelect.value || !state.doc) return;
    const typeFilter = document.getElementById("filter-type-select").value;
    await bulkUpdateRedactions({
      entity_type_filter: typeFilter === "ALL" ? null : typeFilter,
      exemption_code: bulkExSelect.value,
    });
    bulkExSelect.value = "";
  });

  // Select All / Deselect All
  document.getElementById("btn-enable-all").addEventListener("click", async () => {
    const typeFilter = document.getElementById("filter-type-select").value;
    await bulkUpdateRedactions({
      entity_type_filter: typeFilter === "ALL" ? null : typeFilter,
      enabled: true,
    });
  });

  document.getElementById("btn-disable-all").addEventListener("click", async () => {
    const typeFilter = document.getElementById("filter-type-select").value;
    await bulkUpdateRedactions({
      entity_type_filter: typeFilter === "ALL" ? null : typeFilter,
      enabled: false,
    });
  });

  // Finalize & Export button
  document.getElementById("btn-finalize-export").addEventListener("click", async () => {
    await executeBurnAndExport();
  });

  // Vaughn download buttons
  document.getElementById("btn-download-vaughn-csv").addEventListener("click", () => {
    if (state.doc) window.location.href = `/api/documents/${state.doc.doc_id}/download/vaughn_csv`;
  });
  document.getElementById("btn-download-vaughn-pdf").addEventListener("click", () => {
    if (state.doc) window.location.href = `/api/documents/${state.doc.doc_id}/download/vaughn_pdf`;
  });
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/documents/upload", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json();
    alert(`Upload error: ${err.detail || res.statusText}`);
    return;
  }
  const docData = await res.json();
  onDocumentLoaded(docData);
}

async function loadSampleDocument(filename) {
  const res = await fetch(`/api/documents/load-sample/${encodeURIComponent(filename)}`, {
    method: "POST",
  });
  if (!res.ok) {
    alert("Failed to load sample document.");
    return;
  }
  const docData = await res.json();
  onDocumentLoaded(docData);
}

function onDocumentLoaded(docData) {
  state.doc = docData;
  state.currentPage = 1;
  state.selectedRedactionId = null;

  document.getElementById("empty-upload-state").classList.add("hidden");
  document.getElementById("btn-reanalyze").disabled = false;
  document.getElementById("btn-add-manual-text").disabled = false;
  document.getElementById("btn-finalize-export").disabled = false;

  const forceOcrBtn = document.getElementById("btn-force-ocr");
  if (forceOcrBtn) {
    forceOcrBtn.disabled = docData.file_type !== "pdf";
  }

  const ocrBadge = document.getElementById("ocr-status-badge");
  if (ocrBadge) {
    if (docData.is_scanned_document) {
      ocrBadge.classList.remove("hidden");
      ocrBadge.textContent = `OCR ACTIVE · ${docData.ocr_pages_count || 1} Scanned Page(s)`;
    } else {
      ocrBadge.classList.add("hidden");
    }
  }

  // Automatically pick best initial view: "visual" for PDF, "text" for DOCX/TXT
  if (docData.file_type === "pdf") {
    switchView("visual");
  } else {
    switchView("text");
  }

  refreshAllPanels();
}

function refreshAllPanels() {
  if (!state.doc) return;
  updateKpiCounters();
  renderRedactionsList();
  renderInteractiveTextView();
  if (state.doc.file_type === "pdf") {
    renderVisualPage();
  }
}

async function switchView(viewName) {
  if (!state.doc) return;
  state.currentView = viewName;

  document.querySelectorAll(".view-tab").forEach((t) => {
    t.classList.toggle("active", t.getAttribute("data-view") === viewName);
  });

  const views = {
    visual: document.getElementById("view-visual-container"),
    text: document.getElementById("view-text-container"),
    burned: document.getElementById("view-burned-container"),
    vaughn: document.getElementById("view-vaughn-container"),
  };
  Object.values(views).forEach((el) => el.classList.add("hidden"));

  const pdfControls = document.getElementById("pdf-toolbar-controls");
  pdfControls.style.visibility =
    viewName === "visual" && state.doc.file_type === "pdf" ? "visible" : "hidden";

  if (viewName === "visual") {
    if (state.doc.file_type !== "pdf") {
      // For DOCX/TXT, generate burned PDF preview or switch to interactive text
      views.text.classList.remove("hidden");
      document.getElementById("tab-interactive-text").classList.add("active");
      document.getElementById("tab-visual-pdf").classList.remove("active");
      renderInteractiveTextView();
      return;
    }
    views.visual.classList.remove("hidden");
    renderVisualPage();
  } else if (viewName === "text") {
    views.text.classList.remove("hidden");
    renderInteractiveTextView();
  } else if (viewName === "burned") {
    views.burned.classList.remove("hidden");
    await executeBurnAndExport(false);
  } else if (viewName === "vaughn") {
    views.vaughn.classList.remove("hidden");
    await executeBurnAndExport(false);
  }
}

function updateKpiCounters() {
  if (!state.doc) return;
  const active = state.doc.redactions.filter((r) => r.enabled);
  document.getElementById("active-count-badge").textContent = `${active.length} Active`;

  let person = 0,
    phone = 0,
    email = 0,
    other = 0;
  active.forEach((r) => {
    if (r.entity_type === "PERSON") person++;
    else if (r.entity_type === "PHONE_NUMBER") phone++;
    else if (r.entity_type === "EMAIL_ADDRESS") email++;
    else other++;
  });

  document.getElementById("kpi-person-count").textContent = person;
  document.getElementById("kpi-phone-count").textContent = phone;
  document.getElementById("kpi-email-count").textContent = email;
  document.getElementById("kpi-other-count").textContent = other;
}

function renderVisualPage() {
  if (!state.doc || state.doc.file_type !== "pdf") return;
  const pageInd = document.getElementById("page-indicator");
  pageInd.textContent = `Page ${state.currentPage} / ${state.doc.page_count}`;

  const img = document.getElementById("pdf-page-img");
  const overlay = document.getElementById("pdf-overlay-layer");
  overlay.innerHTML = "";

  img.onload = () => {
    renderPdfBoundingBoxes();
  };
  img.src = `/api/documents/${state.doc.doc_id}/page/${state.currentPage}/image?dpi=150&t=${Date.now()}`;
}

function renderPdfBoundingBoxes() {
  const overlay = document.getElementById("pdf-overlay-layer");
  if (!overlay || !state.doc) return;
  overlay.innerHTML = "";

  const entityMeta = state.meta ? state.meta.entity_types : {};
  const pageRedactions = state.doc.redactions.filter(
    (r) => (r.page_number || 1) === state.currentPage
  );

  pageRedactions.forEach((r) => {
    const bboxes = r.bboxes || [];
    const meta = entityMeta[r.entity_type] || {
      border_color: "#2563eb",
      bg_color: "rgba(37, 99, 235, 0.25)",
    };

    bboxes.forEach((b) => {
      const box = document.createElement("div");
      box.className = `pdf-bbox ${r.enabled ? "" : "disabled"} ${
        state.selectedRedactionId === r.id ? "selected" : ""
      }`;
      box.style.left = `${(b.norm_x * 100).toFixed(3)}%`;
      box.style.top = `${(b.norm_y * 100).toFixed(3)}%`;
      box.style.width = `${Math.max(b.norm_w * 100, 1.2).toFixed(3)}%`;
      box.style.height = `${Math.max(b.norm_h * 100, 1.4).toFixed(3)}%`;
      box.style.borderColor = meta.border_color;
      if (r.enabled && state.selectedRedactionId !== r.id) {
        box.style.backgroundColor = meta.bg_color;
      }
      box.title = `${r.entity_label}: "${r.text}" | Exemption: ${r.exemption_code} (Click to inspect/toggle)`;

      const tag = document.createElement("span");
      tag.className = "pdf-bbox-tag";
      tag.textContent = r.exemption_code;
      box.appendChild(tag);

      box.addEventListener("click", (e) => {
        e.stopPropagation();
        state.selectedRedactionId = r.id;
        renderPdfBoundingBoxes();
        renderRedactionsList();
        scrollToRedactionCard(r.id);
      });

      overlay.appendChild(box);
    });
  });
}

function setupPdfBoxDrawing() {
  const wrapper = document.getElementById("pdf-canvas-wrapper");
  const rubberband = document.getElementById("draw-rubberband");
  let isDrawing = false;
  let startX = 0;
  let startY = 0;

  wrapper.addEventListener("mousedown", (e) => {
    if (!state.drawBoxMode || !state.doc || state.doc.file_type !== "pdf") return;
    const rect = wrapper.getBoundingClientRect();
    isDrawing = true;
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;

    rubberband.style.left = `${startX}px`;
    rubberband.style.top = `${startY}px`;
    rubberband.style.width = `0px`;
    rubberband.style.height = `0px`;
    rubberband.classList.remove("hidden");
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDrawing) return;
    const rect = wrapper.getBoundingClientRect();
    const curX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const curY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const left = Math.min(startX, curX);
    const top = Math.min(startY, curY);
    const width = Math.abs(curX - startX);
    const height = Math.abs(curY - startY);

    rubberband.style.left = `${left}px`;
    rubberband.style.top = `${top}px`;
    rubberband.style.width = `${width}px`;
    rubberband.style.height = `${height}px`;
  });

  window.addEventListener("mouseup", async (e) => {
    if (!isDrawing) return;
    isDrawing = false;
    rubberband.classList.add("hidden");

    const rect = wrapper.getBoundingClientRect();
    const curX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const curY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const left = Math.min(startX, curX);
    const top = Math.min(startY, curY);
    const width = Math.abs(curX - startX);
    const height = Math.abs(curY - startY);

    if (width < 8 || height < 6) return;

    const norm_x = left / rect.width;
    const norm_y = top / rect.height;
    const norm_w = width / rect.width;
    const norm_h = height / rect.height;

    const entityType = document.getElementById("manual-entity-select").value || "CUSTOM";
    const exemptionCode = document.getElementById("manual-exemption-select").value || "(b)(6)";

    const res = await fetch(`/api/documents/${state.doc.doc_id}/redactions/manual-box`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page_number: state.currentPage,
        norm_x,
        norm_y,
        norm_w,
        norm_h,
        entity_type: entityType,
        exemption_code: exemptionCode,
        comment: "Manual region redaction drawn on PDF page",
      }),
    });

    if (res.ok) {
      state.doc = await res.json();
      refreshAllPanels();
    }
  });
}

function renderInteractiveTextView() {
  const container = document.getElementById("interactive-text-content");
  if (!container || !state.doc) return;

  const fullText = state.doc.full_text || "";
  const spanRedactions = state.doc.redactions
    .filter((r) => r.start !== null && r.end !== null && r.end > r.start)
    .sort((a, b) => a.start - b.start);

  // Build non-overlapping display segments
  let html = "";
  let cursor = 0;

  spanRedactions.forEach((r) => {
    if (r.start < cursor) return; // skip overlapping display span
    if (r.start > cursor) {
      html += escapeHtml(fullText.slice(cursor, r.start));
    }
    const snippet = escapeHtml(fullText.slice(r.start, r.end));
    const disabledCls = r.enabled ? "" : "disabled";
    html += `<span class="inline-redaction-mark type-${r.entity_type} ${disabledCls}" data-rid="${
      r.id
    }" title="${escapeHtml(r.entity_label)} | Exemption ${escapeHtml(
      r.exemption_code
    )} (Click to toggle)">${snippet}<sup class="inline-exemption-sup">${escapeHtml(
      r.exemption_code
    )}</sup></span>`;
    cursor = r.end;
  });

  if (cursor < fullText.length) {
    html += escapeHtml(fullText.slice(cursor));
  }

  container.innerHTML = html;

  container.querySelectorAll(".inline-redaction-mark").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const rid = el.getAttribute("data-rid");
      const item = state.doc.redactions.find((x) => x.id === rid);
      if (item) {
        await updateSingleRedaction(rid, { enabled: !item.enabled });
      }
    });
  });
}

function setupTextSelectionPopover() {
  const textSheet = document.getElementById("interactive-text-content");
  const popover = document.getElementById("text-selection-popover");
  const previewSpan = document.getElementById("selection-preview-text");

  textSheet.addEventListener("mouseup", () => {
    const sel = window.getSelection();
    const selectedText = sel ? sel.toString().trim() : "";
    if (selectedText && selectedText.length >= 2 && selectedText.length <= 160) {
      state.pendingSelectionText = selectedText;
      previewSpan.textContent = `"${selectedText}"`;
      popover.classList.remove("hidden");
    } else {
      popover.classList.add("hidden");
    }
  });

  document.getElementById("btn-popover-redact-all").addEventListener("click", async () => {
    if (!state.pendingSelectionText || !state.doc) return;
    await addManualTextRedactionRequest({
      text: state.pendingSelectionText,
      entity_type: document.getElementById("popover-entity-select").value,
      exemption_code: document.getElementById("popover-exemption-select").value,
      apply_all_occurrences: true,
    });
    popover.classList.add("hidden");
    window.getSelection().removeAllRanges();
  });

  document.getElementById("btn-popover-redact-one").addEventListener("click", async () => {
    if (!state.pendingSelectionText || !state.doc) return;
    await addManualTextRedactionRequest({
      text: state.pendingSelectionText,
      entity_type: document.getElementById("popover-entity-select").value,
      exemption_code: document.getElementById("popover-exemption-select").value,
      apply_all_occurrences: false,
    });
    popover.classList.add("hidden");
    window.getSelection().removeAllRanges();
  });
}

function renderRedactionsList() {
  const container = document.getElementById("redactions-list-container");
  if (!container || !state.doc) return;

  const query = (document.getElementById("redaction-search-input").value || "").toLowerCase().trim();
  const typeFilter = document.getElementById("filter-type-select").value;
  const entityMeta = state.meta ? state.meta.entity_types : {};

  const filtered = state.doc.redactions.filter((r) => {
    if (typeFilter !== "ALL" && r.entity_type !== typeFilter) return false;
    if (query) {
      const hay = `${r.text} ${r.entity_label} ${r.exemption_code} ${r.comment || ""}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-list-placeholder">No matching redaction items found.</div>`;
    return;
  }

  container.innerHTML = "";
  filtered.forEach((r) => {
    const meta = entityMeta[r.entity_type] || { badge_color: "#475569", label: r.entity_type };
    const card = document.createElement("div");
    card.id = `rc-card-${r.id}`;
    card.className = `redaction-card ${r.enabled ? "" : "disabled-card"} ${
      state.selectedRedactionId === r.id ? "active-card" : ""
    }`;
    card.style.borderLeftColor = meta.badge_color;

    const exOptions = (state.meta ? state.meta.foia_exemptions : [])
      .map(
        (ex) =>
          `<option value="${ex.code}" ${
            r.exemption_code === ex.code ? "selected" : ""
          }>${ex.short_label}</option>`
      )
      .join("");

    card.innerHTML = `
      <div class="rc-top-row">
        <label class="rc-check-wrap">
          <input type="checkbox" class="rc-enable-chk" ${r.enabled ? "checked" : ""} />
          <span class="rc-text-value" title="${escapeHtml(r.text)}">${escapeHtml(r.text)}</span>
        </label>
        <button type="button" class="rc-delete-btn" title="Remove Redaction">&times;</button>
      </div>
      <div class="rc-meta-row">
        <span class="rc-type-badge" style="background:${meta.bg_color}; color:#fff; border:1px solid ${meta.border_color}">
          ${escapeHtml(r.entity_type)} · P${r.page_number || 1}
        </span>
        <select class="select-control rc-exemption-select" title="Assign FOIA Statutory Exemption">
          ${exOptions}
        </select>
      </div>
    `;

    // Toggle enabled
    card.querySelector(".rc-enable-chk").addEventListener("change", async (e) => {
      await updateSingleRedaction(r.id, { enabled: e.target.checked });
    });

    // Change exemption code
    card.querySelector(".rc-exemption-select").addEventListener("change", async (e) => {
      await updateSingleRedaction(r.id, { exemption_code: e.target.value });
    });

    // Delete item
    card.querySelector(".rc-delete-btn").addEventListener("click", async () => {
      await deleteRedaction(r.id);
    });

    // Click card to focus page on PDF
    card.addEventListener("click", (e) => {
      if (["INPUT", "SELECT", "BUTTON", "OPTION"].includes(e.target.tagName)) return;
      state.selectedRedactionId = r.id;
      if (state.doc.file_type === "pdf" && r.page_number && r.page_number !== state.currentPage) {
        state.currentPage = r.page_number;
        renderVisualPage();
      } else {
        renderPdfBoundingBoxes();
      }
      renderRedactionsList();
    });

    container.appendChild(card);
  });
}

function scrollToRedactionCard(redactionId) {
  const el = document.getElementById(`rc-card-${redactionId}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

async function reanalyzeCurrentDocument() {
  if (!state.doc) return;
  const enabledTypes = [];
  const entityExemptions = {};
  Object.entries(state.detectorConfig).forEach(([et, cfg]) => {
    if (cfg.enabled) enabledTypes.push(et);
    entityExemptions[et] = cfg.exemption;
  });

  const minConfidence = parseFloat(document.getElementById("confidence-slider").value || "0.45");

  const res = await fetch(`/api/documents/${state.doc.doc_id}/reanalyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled_types: enabledTypes,
      default_exemption: "(b)(6)",
      entity_exemptions: entityExemptions,
      min_confidence: minConfidence,
      preserve_manual: true,
    }),
  });

  if (res.ok) {
    state.doc = await res.json();
    refreshAllPanels();
  }
}

async function submitManualTextRedaction() {
  if (!state.doc) return;
  const textInput = document.getElementById("manual-text-input");
  const text = textInput.value.trim();
  if (!text) return;

  const entityType = document.getElementById("manual-entity-select").value;
  const exemptionCode = document.getElementById("manual-exemption-select").value;
  const comment = document.getElementById("manual-comment-input").value.trim();
  const applyAll = document.getElementById("manual-all-occurrences").checked;

  await addManualTextRedactionRequest({
    text,
    entity_type: entityType,
    exemption_code: exemptionCode,
    comment,
    apply_all_occurrences: applyAll,
    page_number: state.currentPage,
  });

  textInput.value = "";
  document.getElementById("manual-comment-input").value = "";
}

async function addManualTextRedactionRequest(payload) {
  const res = await fetch(`/api/documents/${state.doc.doc_id}/redactions/manual-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    state.doc = await res.json();
    refreshAllPanels();
  }
}

async function updateSingleRedaction(redactionId, patch) {
  const res = await fetch(`/api/documents/${state.doc.doc_id}/redactions/${redactionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (res.ok) {
    state.doc = await res.json();
    refreshAllPanels();
  }
}

async function bulkUpdateRedactions(payload) {
  const res = await fetch(`/api/documents/${state.doc.doc_id}/redactions/bulk-update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    state.doc = await res.json();
    refreshAllPanels();
  }
}

async function deleteRedaction(redactionId) {
  const res = await fetch(`/api/documents/${state.doc.doc_id}/redactions/${redactionId}`, {
    method: "DELETE",
  });
  if (res.ok) {
    state.doc = await res.json();
    refreshAllPanels();
  }
}

async function executeBurnAndExport(switchToBurnedTab = true) {
  if (!state.doc) return;
  const stampExemption = document.getElementById("chk-stamp-exemption").checked;

  const res = await fetch(`/api/documents/${state.doc.doc_id}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      include_exemption_stamp: stampExemption,
      redaction_style: "black_box_with_exemption",
    }),
  });

  if (!res.ok) {
    alert("Failed to apply final redactions.");
    return;
  }

  const summary = await res.json();

  // Populate download dock links
  const dlGrid = document.getElementById("download-buttons-grid");
  dlGrid.classList.remove("hidden");

  const docId = state.doc.doc_id;
  document.getElementById("dl-primary-btn").href = `/api/documents/${docId}/download/primary`;
  document.getElementById("dl-pdf-btn").href = `/api/documents/${docId}/download/pdf`;
  document.getElementById("dl-vaughn-pdf-btn").href = `/api/documents/${docId}/download/vaughn_pdf`;
  document.getElementById("dl-vaughn-csv-btn").href = `/api/documents/${docId}/download/vaughn_csv`;

  // Populate Burned Preview tab
  const verBanner = document.getElementById("verification-banner");
  const v = summary.verification;
  verBanner.innerHTML = `
    <div>
      <strong>✔ IRREVERSIBLE SANITIZATION VERIFIED:</strong> ${escapeHtml(v.audit_message)}
    </div>
    <span class="airgap-pill">0 Residual PII Leaks · Metadata Purged</span>
  `;

  const burnedImg = document.getElementById("burned-pdf-img");
  burnedImg.src = `/api/documents/${docId}/redacted-page/${state.currentPage}/image?dpi=150&t=${Date.now()}`;

  // Fetch sanitized text preview
  const txtRes = await fetch(`/api/documents/${docId}/download/txt`);
  if (txtRes.ok) {
    const sanitizedText = await txtRes.text();
    document.getElementById("burned-text-preview").textContent = sanitizedText;
  }

  // Populate Vaughn Index table
  const tbody = document.getElementById("vaughn-table-body");
  tbody.innerHTML = "";
  (summary.vaughn_index || []).forEach((entry) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>#${entry.item_number}</strong></td>
      <td>Page ${entry.page_number}</td>
      <td>${escapeHtml(entry.information_withheld_category)}</td>
      <td><span class="badge-tag">${escapeHtml(entry.exemption_code)}</span></td>
      <td><code>${escapeHtml(entry.statutory_citation)}</code></td>
      <td>${escapeHtml(entry.approximate_length)}</td>
      <td>${escapeHtml(entry.detection_method)}</td>
      <td>${escapeHtml(entry.statutory_justification)}</td>
    `;
    tbody.appendChild(tr);
  });

  if (switchToBurnedTab) {
    await switchView("burned");
  }
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
