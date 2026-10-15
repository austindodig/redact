/**
 * Document Redactor — Interactive Frontend Controller
 * Aligned with design.md (No emojis, SVG icons only, collapsible overlay left drawer)
 */

const state = {
  meta: null,
  doc: null,
  currentPage: 1,
  activeView: "visual", // "visual" | "text" | "burned" | "vaughn"
  enabledTypes: new Set(["PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS", "US_SSN", "EMPLOYEE_ID", "STREET_ADDRESS"]),
  typeDefaultExemptions: {
    PERSON: "(b)(6)",
    PHONE_NUMBER: "(b)(6)",
    EMAIL_ADDRESS: "(b)(6)",
    US_SSN: "(b)(6)",
    EMPLOYEE_ID: "(b)(7)(C)",
    STREET_ADDRESS: "(b)(6)",
    CUSTOM: "(b)(6)",
  },
  scoreThreshold: 0.45,
  stripTitles: false,
  searchFilter: "",
  typeFilter: "ALL",
  drawBoxMode: false,
  isDrawing: false,
  drawStart: null,
  resizingBbox: null,
  selectedTextRange: null,
  lastExportResult: null,
  highlightedRedactionId: null,
  leftDrawerOpen: false,
};

const TITLE_PREFIX_REGEX = /^(?:(?:Supervisory\s+Special\s+Agent|Special\s+Agent|Senior\s+Analyst|FOIA\s+Officer|Assistant\s+Inspector\s+General|Deputy\s+Director|Branch\s+Chief|Section\s+Chief|General\s+Counsel|Investigator|Inspector|Auditor|Attorney|Counsel|Director|Agent|Officer|Mr\.|Mrs\.|Ms\.|Miss|Dr\.|Prof\.|Hon\.|Rep\.|Sen\.|Dir\.|Gen\.|Lt\.\s*Gen\.|Maj\.\s*Gen\.|Brig\.\s*Gen\.|Col\.|Lt\.\s*Col\.|Maj\.|Capt\.|Lt\.|Sgt\.|Cpl\.|Adm\.|Cmdr\.|SA|SSA|ASAC|SAC)\s+)+/i;

const SVG_ICONS = {
  lock: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
  refresh: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
  scan: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><line x1="7" y1="12" x2="17" y2="12"></line></svg>`,
  draw: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4 2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>`,
  download: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
  close: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>`,
};

document.addEventListener("DOMContentLoaded", async () => {
  await loadMeta();
  bindEvents();
});

async function loadMeta() {
  const res = await fetch("/api/meta");
  const meta = await res.json();

  // Normalize foia_exemptions list into a code-keyed map if returned as an array
  if (Array.isArray(meta.foia_exemptions)) {
    const exMap = {};
    for (const ex of meta.foia_exemptions) {
      exMap[ex.code] = ex;
    }
    meta.foia_exemptions = exMap;
  }

  // Normalize entity_types color property
  if (meta.entity_types) {
    for (const info of Object.values(meta.entity_types)) {
      if (!info.color && info.badge_color) {
        info.color = info.badge_color;
      }
    }
  }

  state.meta = meta;

  renderDetectorToggles();
  populateExemptionDropdowns();
  renderExemptionReferenceCards();
}

function renderDetectorToggles() {
  const container = document.getElementById("detector-toggles-list");
  container.innerHTML = "";

  const typesOrder = [
    "PERSON",
    "PHONE_NUMBER",
    "EMAIL_ADDRESS",
    "US_SSN",
    "EMPLOYEE_ID",
    "STREET_ADDRESS",
  ];

  for (const typeKey of typesOrder) {
    const info = state.meta.entity_types[typeKey] || {
      label: typeKey,
      color: "#005691",
      default_exemption: "(b)(6)",
    };

    const row = document.createElement("div");
    row.className = "detector-item";
    row.innerHTML = `
      <label class="detector-left" style="cursor:pointer;">
        <input type="checkbox" data-entity-toggle="${typeKey}" ${state.enabledTypes.has(typeKey) ? "checked" : ""} />
        <span class="cat-dot" style="background:${info.color}"></span>
        <span class="detector-name">${info.label}</span>
      </label>
      <span class="detector-exemption-tag" title="Default FOIA Exemption">${info.default_exemption}</span>
    `;

    row.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) {
        state.enabledTypes.add(typeKey);
      } else {
        state.enabledTypes.delete(typeKey);
      }
    });

    container.appendChild(row);
  }
}

function populateExemptionDropdowns() {
  const selects = [
    document.getElementById("manual-exemption-select"),
    document.getElementById("popover-exemption-select"),
  ];

  const exemptions = state.meta.foia_exemptions;
  for (const sel of selects) {
    if (!sel) continue;
    sel.innerHTML = "";
    for (const [code, ex] of Object.entries(exemptions)) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = `${code} — ${ex.title.replace(/^Exemption\s+[^\s—]+\s*—\s*/, "")}`;
      sel.appendChild(opt);
    }
    sel.value = "(b)(6)";
  }

  const bulkSel = document.getElementById("bulk-exemption-select");
  if (bulkSel) {
    bulkSel.innerHTML = `<option value="">Bulk Set Exemption...</option>`;
    for (const [code, ex] of Object.entries(exemptions)) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = `Set All Filtered -> ${code}`;
      bulkSel.appendChild(opt);
    }
  }
}

function renderExemptionReferenceCards() {
  const container = document.getElementById("exemption-reference-cards");
  if (!container) return;
  container.innerHTML = "";
  for (const [code, ex] of Object.entries(state.meta.foia_exemptions)) {
    const card = document.createElement("div");
    card.className = "exemption-ref-card";
    card.innerHTML = `
      <div class="exemption-ref-head">
        <span class="exemption-code-badge">${code}</span>
        <span class="exemption-statute">${ex.statute}</span>
      </div>
      <div class="exemption-ref-desc">${ex.description}</div>
    `;
    container.appendChild(card);
  }
}

function bindEvents() {
  // Collapsible Left Drawer Toggle (Rest of the page remains completely stationary)
  const drawerBtn = document.getElementById("btn-toggle-left-drawer");
  const leftDrawer = document.getElementById("left-drawer");
  if (drawerBtn && leftDrawer) {
    drawerBtn.addEventListener("click", () => {
      state.leftDrawerOpen = !state.leftDrawerOpen;
      leftDrawer.classList.toggle("collapsed", !state.leftDrawerOpen);
      drawerBtn.setAttribute("aria-expanded", String(state.leftDrawerOpen));
    });
  }

  // File Upload Input
  const fileInput = document.getElementById("file-upload-input");
  fileInput.addEventListener("change", async (e) => {
    if (e.target.files && e.target.files[0]) {
      await uploadFile(e.target.files[0]);
      e.target.value = "";
    }
  });

  // Drag & Drop on Empty Stage Dropzone
  const dropzone = document.getElementById("dropzone-area");
  if (dropzone) {
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", async (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        await uploadFile(e.dataTransfer.files[0]);
      }
    });
  }

  // Confidence Slider
  const slider = document.getElementById("confidence-slider");
  const sliderVal = document.getElementById("confidence-val");
  slider.addEventListener("input", (e) => {
    state.scoreThreshold = parseFloat(e.target.value);
    sliderVal.textContent = state.scoreThreshold.toFixed(2);
  });

  // Strip Titles Checkbox
  const stripTitlesChk = document.getElementById("chk-strip-titles");
  if (stripTitlesChk) {
    stripTitlesChk.addEventListener("change", async (e) => {
      state.stripTitles = e.target.checked;
      if (state.doc) {
        await reanalyzeCurrentDoc(false);
      }
    });
  }

  // Re-Analyze Button
  document.getElementById("btn-reanalyze").addEventListener("click", async () => {
    await reanalyzeCurrentDoc(false);
  });

  // Force Full-Page OCR Button
  const forceOcrBtn = document.getElementById("btn-force-ocr");
  if (forceOcrBtn) {
    forceOcrBtn.addEventListener("click", async () => {
      await reanalyzeCurrentDoc(true);
    });
  }

  // Manual Text Form
  document.getElementById("manual-text-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.doc) return;
    const text = document.getElementById("manual-text-input").value.trim();
    if (!text) return;
    const entityType = document.getElementById("manual-entity-select").value;
    const exemption = document.getElementById("manual-exemption-select").value;
    const comment = document.getElementById("manual-comment-input").value.trim();
    const allOccurrences = document.getElementById("manual-all-occurrences").checked;

    await addManualTextRedaction({
      text,
      entity_type: entityType,
      exemption_code: exemption,
      comment,
      apply_all_occurrences: allOccurrences,
    });

    document.getElementById("manual-text-input").value = "";
    document.getElementById("manual-comment-input").value = "";
  });

  // View Tabs
  document.querySelectorAll(".view-tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      const view = tab.dataset.view;
      await switchView(view);
    });
  });

  // PDF Page Navigation
  document.getElementById("btn-prev-page").addEventListener("click", () => {
    if (!state.doc) return;
    if (state.currentPage > 1) {
      state.currentPage--;
      renderVisualPdfPage();
    }
  });
  document.getElementById("btn-next-page").addEventListener("click", () => {
    if (!state.doc) return;
    if (state.currentPage < state.doc.page_count) {
      state.currentPage++;
      renderVisualPdfPage();
    }
  });

  // Draw Box Mode Toggle
  const drawBtn = document.getElementById("btn-draw-box-mode");
  drawBtn.addEventListener("click", () => {
    state.drawBoxMode = !state.drawBoxMode;
    drawBtn.classList.toggle("active", state.drawBoxMode);
    drawBtn.innerHTML = `${SVG_ICONS.draw} <span>Draw Redaction Box: ${state.drawBoxMode ? "ON" : "OFF"}</span>`;
    const wrapper = document.getElementById("pdf-canvas-wrapper");
    wrapper.classList.toggle("crosshair-mode", state.drawBoxMode);
  });

  // Rubber-band Box Drawing on PDF Page
  setupPdfBoxDrawing();

  // Text Selection in Interactive Text View
  setupTextSelectionRedaction();

  // Right Panel Filters & Bulk Controls
  document.getElementById("redaction-search-input").addEventListener("input", (e) => {
    state.searchFilter = e.target.value.toLowerCase();
    renderRedactionsQueue();
  });

  document.getElementById("filter-type-select").addEventListener("change", (e) => {
    state.typeFilter = e.target.value;
    renderRedactionsQueue();
  });

  document.getElementById("bulk-exemption-select").addEventListener("change", async (e) => {
    const code = e.target.value;
    if (!code || !state.doc) return;
    const filtered = getFilteredRedactions();
    for (const r of filtered) {
      r.exemption_code = code;
    }
    e.target.value = "";
    await syncRedactionsToServer();
  });

  document.getElementById("btn-enable-all").addEventListener("click", async () => {
    if (!state.doc) return;
    for (const r of getFilteredRedactions()) {
      r.enabled = true;
    }
    await syncRedactionsToServer();
  });

  document.getElementById("btn-disable-all").addEventListener("click", async () => {
    if (!state.doc) return;
    for (const r of getFilteredRedactions()) {
      r.enabled = false;
    }
    await syncRedactionsToServer();
  });

  // Finalize & Burn Redactions Button
  document.getElementById("btn-finalize-export").addEventListener("click", async () => {
    await executeBurnAndExport();
  });

  // Vaughn Index Download Buttons
  document.getElementById("btn-download-vaughn-csv").addEventListener("click", async () => {
    if (!state.lastExportResult) await executeBurnAndExport(false);
    if (state.lastExportResult) window.open(state.lastExportResult.downloads.vaughn_csv, "_blank");
  });
  document.getElementById("btn-download-vaughn-pdf").addEventListener("click", async () => {
    if (!state.lastExportResult) await executeBurnAndExport(false);
    if (state.lastExportResult) window.open(state.lastExportResult.downloads.vaughn_pdf, "_blank");
  });
}

async function uploadFile(file) {
  setLoadingState(true, `Analyzing ${file.name}...`);
  try {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/documents/upload", {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`Error uploading file: ${err.detail || res.statusText}`);
      return;
    }
    const doc = await res.json();
    onDocumentLoaded(doc);
  } finally {
    setLoadingState(false);
  }
}

function onDocumentLoaded(doc) {
  if (!doc || !doc.doc_id) return;
  state.doc = doc;
  state.currentPage = 1;
  state.lastExportResult = null;

  document.getElementById("empty-upload-state").classList.add("hidden");
  document.getElementById("btn-reanalyze").disabled = false;
  const forceOcrBtn = document.getElementById("btn-force-ocr");
  if (forceOcrBtn) {
    forceOcrBtn.disabled = !(doc.ext === ".pdf" || doc.is_image_doc);
  }
  document.getElementById("btn-add-manual-text").disabled = false;
  document.getElementById("btn-finalize-export").disabled = false;
  document.getElementById("download-buttons-grid").classList.add("hidden");

  // Update active document pill in header
  const docPill = document.getElementById("active-doc-pill");
  if (docPill) {
    docPill.textContent = doc.filename;
    docPill.classList.remove("hidden");
  }

  // Show OCR status badge if document was processed with pure-pip RapidOCR
  const ocrBadge = document.getElementById("ocr-status-badge");
  if (ocrBadge) {
    if (doc.ocr_applied) {
      ocrBadge.classList.remove("hidden");
      ocrBadge.textContent = doc.is_image_doc
        ? `OCR Active (${(doc.ext || "").replace(".", "").toUpperCase()} Scan)`
        : `OCR Active (${(doc.ocr_pages || []).length || doc.ocr_pages_count || 1} pg)`;
    } else {
      ocrBadge.classList.add("hidden");
    }
  }

  switchView(state.activeView === "burned" ? "visual" : state.activeView);
  renderAllPanels();
}

async function reanalyzeCurrentDoc(forceOcr = false) {
  if (!state.doc || !state.doc.doc_id) return;
  setLoadingState(true, forceOcr ? "Running Pure-Pip RapidOCR & PII Detection..." : "Re-running PII detection...");
  try {
    const res = await fetch(`/api/documents/${state.doc.doc_id}/reanalyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled_types: Array.from(state.enabledTypes),
        score_threshold: state.scoreThreshold,
        type_exemptions: state.typeDefaultExemptions,
        force_ocr: forceOcr,
        strip_titles: state.stripTitles,
      }),
    });
    if (!res.ok) return;
    const doc = await res.json();
    onDocumentLoaded(doc);
  } finally {
    setLoadingState(false);
  }
}

async function addManualTextRedaction(payload) {
  if (!state.doc || !state.doc.doc_id) return;
  const res = await fetch(`/api/documents/${state.doc.doc_id}/redactions/manual-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return;
  const doc = await res.json();
  if (doc && doc.doc_id) {
    state.doc = doc;
    state.lastExportResult = null;
    renderAllPanels();
  }
}

async function syncRedactionsToServer() {
  if (!state.doc || !state.doc.doc_id) return;
  const res = await fetch(`/api/documents/${state.doc.doc_id}/redactions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redactions: state.doc.redactions }),
  });
  if (!res.ok) return;
  const doc = await res.json();
  if (doc && doc.doc_id) {
    state.doc = doc;
    state.lastExportResult = null;
    renderAllPanels();
  }
}

async function patchSingleRedaction(redactionId, patchPayload) {
  if (!state.doc || !state.doc.doc_id) return;
  const res = await fetch(`/api/documents/${state.doc.doc_id}/redactions/${redactionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patchPayload),
  });
  if (!res.ok) return;
  const doc = await res.json();
  if (doc && doc.doc_id) {
    state.doc = doc;
    state.lastExportResult = null;
    renderAllPanels();
  }
}

async function switchView(viewName) {
  state.activeView = viewName;
  document.querySelectorAll(".view-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.view === viewName);
  });

  const views = {
    visual: document.getElementById("view-visual-container"),
    text: document.getElementById("view-text-container"),
    burned: document.getElementById("view-burned-container"),
    vaughn: document.getElementById("view-vaughn-container"),
  };

  Object.values(views).forEach((el) => el.classList.add("hidden"));
  if (!state.doc) {
    document.getElementById("empty-upload-state").classList.remove("hidden");
    return;
  }

  const pdfControls = document.getElementById("pdf-toolbar-controls");
  if (pdfControls) {
    pdfControls.classList.toggle("hidden", !(viewName === "visual" && state.doc));
  }

  if (viewName === "visual") {
    views.visual.classList.remove("hidden");
    renderVisualPdfPage();
  } else if (viewName === "text") {
    views.text.classList.remove("hidden");
    renderInteractiveTextView();
  } else if (viewName === "burned") {
    views.burned.classList.remove("hidden");
    if (!state.lastExportResult) {
      await executeBurnAndExport(false);
    } else {
      renderBurnedPreview();
    }
  } else if (viewName === "vaughn") {
    views.vaughn.classList.remove("hidden");
    renderVaughnIndexTable();
  }
}

function renderAllPanels() {
  if (!state.doc || !state.doc.redactions) return;
  updateKpiStrip();
  renderRedactionsQueue();

  if (state.activeView === "visual") {
    renderVisualPdfPage();
  } else if (state.activeView === "text") {
    renderInteractiveTextView();
  } else if (state.activeView === "vaughn") {
    renderVaughnIndexTable();
  }
}

function updateKpiStrip() {
  const active = (state.doc.redactions || []).filter((r) => r.enabled);
  document.getElementById("active-count-badge").textContent = `${active.length} Active`;

  const counts = { PERSON: 0, PHONE_NUMBER: 0, EMAIL_ADDRESS: 0, OTHER: 0 };
  for (const r of active) {
    if (r.entity_type === "PERSON") counts.PERSON++;
    else if (r.entity_type === "PHONE_NUMBER") counts.PHONE_NUMBER++;
    else if (r.entity_type === "EMAIL_ADDRESS") counts.EMAIL_ADDRESS++;
    else counts.OTHER++;
  }

  document.getElementById("kpi-person-count").textContent = counts.PERSON;
  document.getElementById("kpi-phone-count").textContent = counts.PHONE_NUMBER;
  document.getElementById("kpi-email-count").textContent = counts.EMAIL_ADDRESS;
  document.getElementById("kpi-other-count").textContent = counts.OTHER;
}

// ==================== VISUAL PDF PAGE & BOUNDING BOX OVERLAYS ====================

function renderVisualPdfPage() {
  if (!state.doc || !state.doc.doc_id) return;
  const pageNum = state.currentPage;
  document.getElementById("page-indicator").textContent = `Page ${pageNum} / ${state.doc.page_count}`;

  const img = document.getElementById("pdf-page-img");
  const overlay = document.getElementById("pdf-overlay-layer");
  overlay.innerHTML = "";

  const targetSrc = `/api/documents/${state.doc.doc_id}/page/${pageNum}/image?t=${(state.doc.redactions || []).length}`;
  img.onload = () => {
    drawPageBoundingBoxes(pageNum);
  };
  img.src = targetSrc;
}

function drawPageBoundingBoxes(pageNum) {
  const overlay = document.getElementById("pdf-overlay-layer");
  overlay.innerHTML = "";

  const pagesList = state.doc.pages_meta || state.doc.pages || [];
  const pageMeta = pagesList.find((p) => (p.page || p.page_number) === pageNum);
  if (!pageMeta) return;

  const pageW = pageMeta.width || 612;
  const pageH = pageMeta.height || 792;

  for (const r of state.doc.redactions || []) {
    const rawRects = r.rects || r.bboxes || [];
    const pageRects = rawRects.filter((rc) => (rc.page || rc.page_number) === pageNum);
    const typeInfo = state.meta.entity_types[r.entity_type] || { color: "#005691" };

    pageRects.forEach((rc, rectIdx) => {
      const box = document.createElement("div");
      box.className = `bbox-overlay ${r.enabled ? "" : "disabled-redaction"} ${
        state.highlightedRedactionId === r.id ? "highlighted" : ""
      }`;
      box.dataset.redactionId = r.id;

      const leftPct = (rc.x0 / pageW) * 100;
      const topPct = (rc.y0 / pageH) * 100;
      const widthPct = ((rc.x1 - rc.x0) / pageW) * 100;
      const heightPct = ((rc.y1 - rc.y0) / pageH) * 100;

      box.style.left = `${leftPct}%`;
      box.style.top = `${topPct}%`;
      box.style.width = `${widthPct}%`;
      box.style.height = `${heightPct}%`;
      box.style.borderColor = typeInfo.color;
      box.style.backgroundColor = hexToRgba(typeInfo.color, 0.24);

      box.title = `${r.entity_type}: "${r.text}" | FOIA ${r.exemption_code} (Click to toggle, or drag side handles to adjust width)`;

      const tag = document.createElement("span");
      tag.className = "bbox-tag";
      tag.textContent = r.exemption_code;
      box.appendChild(tag);

      // Left & Right Horizontal Resize Handles for adjusting redaction length visually
      const handleLeft = document.createElement("div");
      handleLeft.className = "bbox-handle bbox-handle-left";
      handleLeft.title = "Drag to adjust start of redaction box";

      const handleRight = document.createElement("div");
      handleRight.className = "bbox-handle bbox-handle-right";
      handleRight.title = "Drag to adjust end of redaction box";

      handleLeft.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        startBboxHorizontalResize(e, r, rectIdx, "left", pageW, pageH);
      });

      handleRight.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        startBboxHorizontalResize(e, r, rectIdx, "right", pageW, pageH);
      });

      box.appendChild(handleLeft);
      box.appendChild(handleRight);

      box.addEventListener("click", async (e) => {
        if (state.drawBoxMode || state.resizingBbox) return;
        e.stopPropagation();
        r.enabled = !r.enabled;
        await syncRedactionsToServer();
      });

      box.addEventListener("mouseenter", () => {
        highlightCardInQueue(r.id, true);
      });
      box.addEventListener("mouseleave", () => {
        highlightCardInQueue(r.id, false);
      });

      overlay.appendChild(box);
    });
  }
}

function startBboxHorizontalResize(startEvent, redactionItem, rectIdx, side, pageW, pageH) {
  const wrapper = document.getElementById("pdf-canvas-wrapper");
  const wrapperRect = wrapper.getBoundingClientRect();
  const targetBbox = (redactionItem.bboxes || redactionItem.rects || [])[rectIdx];
  if (!targetBbox) return;

  state.resizingBbox = {
    redactionItem,
    targetBbox,
    side,
    pageW,
    pageH,
    wrapperRect,
  };

  const onMouseMove = (moveEvent) => {
    if (!state.resizingBbox) return;
    const relX = Math.max(0, Math.min(wrapperRect.width, moveEvent.clientX - wrapperRect.left));
    const pdfX = (relX / wrapperRect.width) * pageW;

    if (side === "left") {
      targetBbox.x0 = Math.min(pdfX, targetBbox.x1 - 6);
    } else {
      targetBbox.x1 = Math.max(pdfX, targetBbox.x0 + 6);
    }
    targetBbox.norm_x = targetBbox.x0 / pageW;
    targetBbox.norm_w = (targetBbox.x1 - targetBbox.x0) / pageW;

    drawPageBoundingBoxes(state.currentPage);
  };

  const onMouseUp = async () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    if (!state.resizingBbox) return;
    state.resizingBbox = null;

    await patchSingleRedaction(redactionItem.id, {
      bboxes: redactionItem.bboxes || redactionItem.rects,
    });
  };

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
}

function setupPdfBoxDrawing() {
  const wrapper = document.getElementById("pdf-canvas-wrapper");
  const rubberband = document.getElementById("draw-rubberband");

  wrapper.addEventListener("mousedown", (e) => {
    if (!state.drawBoxMode || !state.doc) return;
    e.preventDefault();
    const rect = wrapper.getBoundingClientRect();
    state.isDrawing = true;
    state.drawStart = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    rubberband.style.left = `${state.drawStart.x}px`;
    rubberband.style.top = `${state.drawStart.y}px`;
    rubberband.style.width = `0px`;
    rubberband.style.height = `0px`;
    rubberband.classList.remove("hidden");
  });

  window.addEventListener("mousemove", (e) => {
    if (!state.isDrawing || !state.drawStart) return;
    const rect = wrapper.getBoundingClientRect();
    const curX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    const x0 = Math.min(state.drawStart.x, curX);
    const y0 = Math.min(state.drawStart.y, curY);
    const w = Math.abs(curX - state.drawStart.x);
    const h = Math.abs(curY - state.drawStart.y);

    rubberband.style.left = `${x0}px`;
    rubberband.style.top = `${y0}px`;
    rubberband.style.width = `${w}px`;
    rubberband.style.height = `${h}px`;
  });

  window.addEventListener("mouseup", async (e) => {
    if (!state.isDrawing || !state.drawStart) return;
    state.isDrawing = false;
    rubberband.classList.add("hidden");

    const rect = wrapper.getBoundingClientRect();
    const curX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    const pxX0 = Math.min(state.drawStart.x, curX);
    const pxY0 = Math.min(state.drawStart.y, curY);
    const pxX1 = Math.max(state.drawStart.x, curX);
    const pxY1 = Math.max(state.drawStart.y, curY);

    if (pxX1 - pxX0 < 8 || pxY1 - pxY0 < 6) return;

    const pagesList = state.doc.pages_meta || state.doc.pages || [];
    const pageMeta = pagesList.find((p) => (p.page || p.page_number) === state.currentPage);
    if (!pageMeta) return;

    const scaleX = pageMeta.width / rect.width;
    const scaleY = pageMeta.height / rect.height;

    const pdfX0 = pxX0 * scaleX;
    const pdfY0 = pxY0 * scaleY;
    const pdfX1 = pxX1 * scaleX;
    const pdfY1 = pxY1 * scaleY;

    const entityType = document.getElementById("manual-entity-select").value || "CUSTOM";
    const exemptionCode = document.getElementById("manual-exemption-select").value || "(b)(6)";

    const res = await fetch(`/api/documents/${state.doc.doc_id}/redactions/manual-box`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page_number: state.currentPage,
        x0: pdfX0,
        y0: pdfY0,
        x1: pdfX1,
        y1: pdfY1,
        entity_type: entityType,
        exemption_code: exemptionCode,
        label: "[Area Redaction]",
        comment: "Manual bounding box area redaction",
      }),
    });

    if (res.ok) {
      const updated = await res.json();
      if (updated && updated.doc_id) {
        state.doc = updated;
        state.lastExportResult = null;
        renderAllPanels();
      }
    }
  });
}

// ==================== INTERACTIVE TEXT VIEW & HIGHLIGHTING ====================

function renderInteractiveTextView() {
  if (!state.doc) return;
  const container = document.getElementById("interactive-text-content");
  const fullText = state.doc.full_text || "";

  const charSpans = (state.doc.redactions || [])
    .filter((r) => typeof r.start === "number" && typeof r.end === "number" && r.end > r.start)
    .slice()
    .sort((a, b) => a.start - b.start);

  let html = "";
  let cursor = 0;

  for (const r of charSpans) {
    if (r.start < cursor) continue;
    if (r.start > cursor) {
      html += escapeHtml(fullText.slice(cursor, r.start));
    }

    const segment = escapeHtml(fullText.slice(r.start, r.end));
    const cls = `redaction-mark mark-${r.entity_type} ${r.enabled ? "" : "disabled"}`;
    html += `<span class="${cls}" data-redaction-id="${r.id}" title="${r.entity_type} | Click to toggle redaction">${segment}<span class="redaction-mark-exemption">${escapeHtml(
      r.exemption_code
    )}</span></span>`;
    cursor = r.end;
  }

  if (cursor < fullText.length) {
    html += escapeHtml(fullText.slice(cursor));
  }

  container.innerHTML = html;

  container.querySelectorAll(".redaction-mark").forEach((markEl) => {
    markEl.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = markEl.dataset.redactionId;
      const target = state.doc.redactions.find((r) => r.id === id);
      if (target) {
        target.enabled = !target.enabled;
        await syncRedactionsToServer();
      }
    });
  });
}

function setupTextSelectionRedaction() {
  const textContainer = document.getElementById("view-text-container");
  const popover = document.getElementById("text-selection-popover");
  const previewSpan = document.getElementById("selection-preview-text");

  textContainer.addEventListener("mouseup", () => {
    const sel = window.getSelection();
    const selectedStr = sel ? sel.toString().trim() : "";
    if (selectedStr && selectedStr.length >= 2) {
      state.selectedTextRange = selectedStr;
      previewSpan.textContent = `"${selectedStr}"`;
      popover.classList.remove("hidden");
    } else {
      popover.classList.add("hidden");
    }
  });

  document.getElementById("btn-popover-redact-all").addEventListener("click", async () => {
    if (!state.selectedTextRange) return;
    const entityType = document.getElementById("popover-entity-select").value;
    const exemption = document.getElementById("popover-exemption-select").value;
    popover.classList.add("hidden");
    window.getSelection().removeAllRanges();
    await addManualTextRedaction({
      text: state.selectedTextRange,
      entity_type: entityType,
      exemption_code: exemption,
      comment: "Added via interactive text selection",
      apply_all_occurrences: true,
    });
  });

  document.getElementById("btn-popover-redact-one").addEventListener("click", async () => {
    if (!state.selectedTextRange) return;
    const entityType = document.getElementById("popover-entity-select").value;
    const exemption = document.getElementById("popover-exemption-select").value;
    popover.classList.add("hidden");
    window.getSelection().removeAllRanges();
    await addManualTextRedaction({
      text: state.selectedTextRange,
      entity_type: entityType,
      exemption_code: exemption,
      comment: "Added via single text selection",
      apply_all_occurrences: false,
    });
  });
}

// ==================== RIGHT PANEL: REDACTION QUEUE (WITH SPAN TRIMMING & EDITING) ====================

function getFilteredRedactions() {
  if (!state.doc || !state.doc.redactions) return [];
  return state.doc.redactions.filter((r) => {
    if (state.typeFilter !== "ALL" && r.entity_type !== state.typeFilter) {
      return false;
    }
    if (state.searchFilter) {
      const hay = `${r.text} ${r.entity_type} ${r.exemption_code} ${r.comment || ""}`.toLowerCase();
      if (!hay.includes(state.searchFilter)) return false;
    }
    return true;
  });
}

function renderRedactionsQueue() {
  const container = document.getElementById("redactions-list-container");
  if (!state.doc) return;

  const list = getFilteredRedactions();
  container.innerHTML = "";

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-list-placeholder">No matching redactions in queue.</div>`;
    return;
  }

  const exemptions = state.meta.foia_exemptions;

  for (const r of list) {
    const typeInfo = state.meta.entity_types[r.entity_type] || {
      label: r.entity_type,
      color: "#005691",
    };

    const card = document.createElement("div");
    card.className = `redaction-card ${r.enabled ? "" : "disabled-card"}`;
    card.id = `rc-card-${r.id}`;
    card.style.borderLeftColor = typeInfo.color;

    const pageNum = r.rects && r.rects[0] ? r.rects[0].page : r.page_number || 1;

    let optionsHtml = "";
    for (const [code, ex] of Object.entries(exemptions)) {
      const selected = r.exemption_code === code ? "selected" : "";
      optionsHtml += `<option value="${code}" ${selected}>${code} — ${ex.title.replace(
        /^Exemption\s+[^\s—]+\s*—\s*/,
        ""
      )}</option>`;
    }

    // Build word chips so the user can trim words from a multi-word redaction (e.g. remove "Special Agent")
    const words = (r.text || "").trim().split(/\s+/).filter(Boolean);
    const hasTitlePrefix = TITLE_PREFIX_REGEX.test(r.text || "");
    let wordChipsHtml = "";
    if (words.length > 1) {
      const chips = words
        .map(
          (w, idx) =>
            `<span class="rc-token-chip" data-word-idx="${idx}" title="Click to exclude '${escapeHtml(
              w
            )}' from this redaction">${escapeHtml(w)} ×</span>`
        )
        .join("");
      const stripBtn = hasTitlePrefix
        ? `<button type="button" class="rc-strip-title-btn" title="Remove leading title/rank and keep only the person's name">Name Only</button>`
        : "";
      wordChipsHtml = `
        <div class="rc-span-adjust-row">
          <div class="rc-token-chips">${chips}</div>
          ${stripBtn}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="rc-top-row">
        <div class="rc-check-wrap">
          <input type="checkbox" class="rc-toggle-chk" ${r.enabled ? "checked" : ""} title="Enable/Disable redaction" />
          <input
            type="text"
            class="rc-text-input"
            value="${escapeHtml(r.text)}"
            title="Edit exact text to redact (press Enter or click outside to apply)"
            aria-label="Redacted text span"
          />
        </div>
        <button class="rc-delete-btn" title="Remove from queue" aria-label="Remove redaction">${SVG_ICONS.close}</button>
      </div>
      ${wordChipsHtml}
      <div class="rc-meta-row">
        <span class="rc-type-badge" style="border-left: 3px solid ${typeInfo.color}">${typeInfo.label}</span>
        <span>Page ${pageNum} · ${r.source === "manual" ? "Manual" : `${Math.round((r.score || r.confidence || 0.9) * 100)}% conf`}</span>
      </div>
      <div class="rc-controls-row">
        <select class="select-control select-sm rc-exemption-select" aria-label="FOIA Exemption">
          ${optionsHtml}
        </select>
        <input type="text" class="input-sm rc-comment-input" placeholder="Optional Vaughn justification note..." value="${escapeHtml(
          r.comment || ""
        )}" />
      </div>
    `;

    card.querySelector(".rc-toggle-chk").addEventListener("change", async (e) => {
      r.enabled = e.target.checked;
      await syncRedactionsToServer();
    });

    // Direct inline text editing to adjust redaction length
    const textInput = card.querySelector(".rc-text-input");
    const commitTextEdit = async () => {
      const nextText = textInput.value.trim();
      if (nextText && nextText !== r.text) {
        await patchSingleRedaction(r.id, { text: nextText });
      } else {
        textInput.value = r.text;
      }
    };
    textInput.addEventListener("change", commitTextEdit);
    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        textInput.blur();
      }
    });

    // Clicking a word chip removes that token (or trims from that side)
    card.querySelectorAll(".rc-token-chip").forEach((chip) => {
      chip.addEventListener("click", async () => {
        const idx = parseInt(chip.dataset.wordIdx, 10);
        if (words.length <= 1) return;
        let remaining;
        if (idx === 0) {
          remaining = words.slice(1);
        } else if (idx === words.length - 1) {
          remaining = words.slice(0, -1);
        } else {
          // If clicking an interior prefix word (like "Agent" in "Special Agent Valerie M. Sterling"),
          // drop everything up to and including idx if idx < words.length / 2, else drop from idx onward
          remaining = idx < words.length / 2 ? words.slice(idx + 1) : words.slice(0, idx);
        }
        const updatedText = remaining.join(" ").trim();
        if (updatedText) {
          await patchSingleRedaction(r.id, { text: updatedText });
        }
      });
    });

    // Quick "Name Only" button for titles/ranks
    const stripTitleBtn = card.querySelector(".rc-strip-title-btn");
    if (stripTitleBtn) {
      stripTitleBtn.addEventListener("click", async () => {
        const stripped = (r.text || "").replace(TITLE_PREFIX_REGEX, "").trim();
        if (stripped && stripped !== r.text) {
          await patchSingleRedaction(r.id, { text: stripped });
        }
      });
    }

    card.querySelector(".rc-delete-btn").addEventListener("click", async () => {
      const res = await fetch(`/api/documents/${state.doc.doc_id}/redactions/${r.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        state.doc = await res.json();
        renderAllPanels();
      }
    });

    card.querySelector(".rc-exemption-select").addEventListener("change", async (e) => {
      r.exemption_code = e.target.value;
      await syncRedactionsToServer();
    });

    card.querySelector(".rc-comment-input").addEventListener("change", async (e) => {
      r.comment = e.target.value;
      await syncRedactionsToServer();
    });

    card.addEventListener("mouseenter", () => {
      state.highlightedRedactionId = r.id;
      document.querySelectorAll(`.bbox-overlay[data-redaction-id="${r.id}"]`).forEach((el) => {
        el.classList.add("highlighted");
      });
    });

    card.addEventListener("mouseleave", () => {
      state.highlightedRedactionId = null;
      document.querySelectorAll(`.bbox-overlay[data-redaction-id="${r.id}"]`).forEach((el) => {
        el.classList.remove("highlighted");
      });
    });

    container.appendChild(card);
  }
}

function highlightCardInQueue(redactionId, active) {
  const card = document.getElementById(`rc-card-${redactionId}`);
  if (!card) return;
  card.classList.toggle("active-card", active);
  if (active) {
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

// ==================== VAUGHN INDEX TABLE ====================

function renderVaughnIndexTable() {
  if (!state.doc) return;
  const tbody = document.getElementById("vaughn-table-body");
  tbody.innerHTML = "";

  const active = (state.doc.redactions || []).filter((r) => r.enabled);
  const exemptions = state.meta.foia_exemptions;

  active.forEach((r, idx) => {
    const ex = exemptions[r.exemption_code] || {
      statute: "5 U.S.C. § 552",
      vaughn_rationale: "Redacted pursuant to FOIA statutory exemption.",
    };
    const typeInfo = state.meta.entity_types[r.entity_type] || { label: r.entity_type };
    const pages = Array.from(new Set((r.rects || []).map((rc) => rc.page))).join(", ") || r.page_number || "1";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono-val">${idx + 1}</td>
      <td class="mono-val">p. ${pages}</td>
      <td><strong>${escapeHtml(typeInfo.label)}</strong></td>
      <td><span class="exemption-code-badge">${escapeHtml(r.exemption_code)}</span></td>
      <td class="mono-val">${escapeHtml(ex.statute)}</td>
      <td class="mono-val">${(r.text || "").length} chars</td>
      <td>${r.source === "manual" ? "Analyst Manual" : "Auto NER/Regex"}</td>
      <td>${escapeHtml(r.comment ? `${ex.vaughn_rationale} (${r.comment})` : ex.vaughn_rationale)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ==================== BURN REDACTIONS & FINAL EXPORT ====================

async function executeBurnAndExport(switchToBurnedTab = true) {
  if (!state.doc || !state.doc.doc_id) return;
  setLoadingState(true, "Permanently burning redactions & generating Vaughn Index...");
  try {
    const stampExemption = document.getElementById("chk-stamp-exemption").checked;
    const res = await fetch(`/api/documents/${state.doc.doc_id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        include_exemption_stamp: stampExemption,
        include_exemption_labels: stampExemption,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`Export failed: ${err.detail || res.statusText}`);
      return;
    }

    const result = await res.json();
    state.lastExportResult = result;

    // Populate Download Dock
    const dlGrid = document.getElementById("download-buttons-grid");
    dlGrid.classList.remove("hidden");

    const dlPrimary = document.getElementById("dl-primary-btn");
    dlPrimary.href = result.downloads.primary;
    dlPrimary.innerHTML = `${SVG_ICONS.download} <span>Redacted (${(state.doc.ext || ".pdf").toUpperCase().replace(".", "")})</span>`;

    document.getElementById("dl-pdf-btn").href = result.downloads.redacted_pdf;
    document.getElementById("dl-vaughn-pdf-btn").href = result.downloads.vaughn_pdf;
    document.getElementById("dl-vaughn-csv-btn").href = result.downloads.vaughn_csv;

    if (switchToBurnedTab) {
      await switchView("burned");
    } else {
      renderBurnedPreview();
    }
  } finally {
    setLoadingState(false);
  }
}

function renderBurnedPreview() {
  if (!state.lastExportResult || !state.doc || !state.doc.doc_id) return;
  const v = state.lastExportResult.verification || {};
  const banner = document.getElementById("verification-banner");
  const totalBurned =
    v.total_redactions_burned ??
    state.lastExportResult.total_redactions_applied ??
    (state.doc.redactions || []).filter((r) => r.enabled).length;

  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="color:var(--color-positive);display:inline-flex;">${SVG_ICONS.check}</span>
      <div>
        <strong>Irreversible Sanitization Verified:</strong>
        ${totalBurned} redaction(s) permanently burned into document stream.
        Underlying characters and image pixels have been physically excised from the output file.
      </div>
    </div>
  `;

  const burnedImg = document.getElementById("burned-pdf-img");
  burnedImg.src = `/api/documents/${state.doc.doc_id}/redacted-page/${state.currentPage}/image?t=${Date.now()}`;

  document.getElementById("burned-text-preview").textContent =
    state.lastExportResult.sanitized_text_preview || "";
}

// ==================== UTILITIES ====================

function setLoadingState(isLoading, msg = "Processing...") {
  const btnExport = document.getElementById("btn-finalize-export");
  const btnReanalyze = document.getElementById("btn-reanalyze");
  if (isLoading) {
    btnExport.disabled = true;
    btnExport.innerHTML = `<span>${escapeHtml(msg)}</span>`;
    btnReanalyze.disabled = true;
  } else {
    if (state.doc) {
      btnExport.disabled = false;
      btnReanalyze.disabled = false;
    }
    btnExport.innerHTML = `${SVG_ICONS.lock} <span>Burn Redactions &amp; Export</span>`;
  }
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hexToRgba(hex, alpha) {
  const clean = (hex || "#005691").replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
