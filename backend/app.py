"""
FastAPI Backend for the Offline Federal FOIA Redaction Workbench.
Runs 100% locally and offline. Serves both API endpoints and the web workbench UI.
"""

import re
import uuid
from pathlib import Path
from typing import Dict, List, Any, Optional

import fitz
from fastapi import FastAPI, UploadFile, File, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .foia_exemptions import FOIA_EXEMPTIONS, ENTITY_TYPE_META, get_exemption_details
from .document_processor import DocumentProcessor
from .sample_generator import generate_all_sample_documents

BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = BASE_DIR / "storage"
SAMPLE_DIR = BASE_DIR / "sample_docs"
FRONTEND_DIR = BASE_DIR / "frontend" / "public"

app = FastAPI(
    title="Federal Offline FOIA Redaction Workbench",
    description="100% Offline PII & FOIA Redaction System (Presidio + spaCy + PyMuPDF + python-docx)",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

processor = DocumentProcessor(STORAGE_DIR)
DOCUMENTS_STORE: Dict[str, Dict[str, Any]] = {}


@app.on_event("startup")
def on_startup():
    generate_all_sample_documents(SAMPLE_DIR)


# -------------------- Pydantic Schemas --------------------

class ReanalyzeRequest(BaseModel):
    enabled_types: List[str] = Field(
        default=["PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS", "US_SSN", "EMPLOYEE_ID", "STREET_ADDRESS"]
    )
    default_exemption: str = Field(default="(b)(6)")
    entity_exemptions: Dict[str, str] = Field(default_factory=dict)
    type_exemptions: Optional[Dict[str, str]] = None
    min_confidence: float = Field(default=0.45, ge=0.1, le=0.99)
    score_threshold: Optional[float] = None
    preserve_manual: bool = Field(default=True)
    force_ocr: bool = Field(default=False)
    strip_titles: bool = Field(default=False)


class UpdateRedactionRequest(BaseModel):
    enabled: Optional[bool] = None
    exemption_code: Optional[str] = None
    entity_type: Optional[str] = None
    text: Optional[str] = None
    start: Optional[int] = None
    end: Optional[int] = None
    comment: Optional[str] = None
    bboxes: Optional[List[Dict[str, Any]]] = None


class ReplaceAllRedactionsRequest(BaseModel):
    redactions: List[Dict[str, Any]]


class BulkUpdateRedactionsRequest(BaseModel):
    redaction_ids: Optional[List[str]] = None
    entity_type_filter: Optional[str] = None
    enabled: Optional[bool] = None
    exemption_code: Optional[str] = None


class AddManualTextRedactionRequest(BaseModel):
    text: str
    entity_type: str = "CUSTOM"
    exemption_code: str = "(b)(6)"
    comment: str = ""
    apply_all_occurrences: bool = True
    start: Optional[int] = None
    end: Optional[int] = None
    page_number: Optional[int] = None


class AddManualBoxRedactionRequest(BaseModel):
    page_number: int = 1
    page: Optional[int] = None
    norm_x: Optional[float] = None
    norm_y: Optional[float] = None
    norm_w: Optional[float] = None
    norm_h: Optional[float] = None
    x0: Optional[float] = None
    y0: Optional[float] = None
    x1: Optional[float] = None
    y1: Optional[float] = None
    entity_type: str = "CUSTOM"
    exemption_code: str = "(b)(6)"
    comment: str = ""
    label: Optional[str] = None


class ExportRedactedRequest(BaseModel):
    include_exemption_stamp: bool = True
    include_exemption_labels: Optional[bool] = None
    redaction_style: str = "black_box_with_exemption"
    fill_color: Optional[str] = None


# -------------------- API Endpoints --------------------

@app.get("/api/meta")
def get_system_metadata():
    """Returns offline engine status, available FOIA exemptions, entity types, and sample documents."""
    samples = []
    if SAMPLE_DIR.exists():
        for p in sorted(SAMPLE_DIR.iterdir()):
            if p.is_file() and not p.name.startswith("."):
                samples.append({
                    "filename": p.name,
                    "ext": p.suffix.lower(),
                    "size_kb": round(p.stat().st_size / 1024, 1),
                })

    return {
        "offline_mode": True,
        "external_network_calls": False,
        "nlp_engine": f"Microsoft Presidio + spaCy ({processor.engine.model_name}) + libphonenumber + RapidOCR (ONNX)",
        "pdf_engine": f"PyMuPDF (fitz {fitz.__doc__.split()[1] if fitz.__doc__ else '1.28'}) Content-Stream & Pixel Sanitizer",
        "ocr_engine": "RapidOCR + ONNXRuntime (100% Pure-Pip Offline Neural OCR)",
        "foia_exemptions": FOIA_EXEMPTIONS,
        "entity_types": ENTITY_TYPE_META,
        "sample_documents": samples,
    }


@app.post("/api/documents/upload")
async def upload_document(file: UploadFile = File(...), force_ocr: bool = False):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required.")
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        doc_data = processor.ingest_document(file.filename, file_bytes, force_ocr=force_ocr)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Document ingestion failed: {str(e)}")

    DOCUMENTS_STORE[doc_data["doc_id"]] = doc_data
    return _serialize_doc(doc_data)


@app.post("/api/documents/{doc_id}/force-ocr")
def force_ocr_document(doc_id: str):
    """Forces local Tesseract OCR across all pages of a PDF or Scanned Document."""
    doc_data = _get_doc_or_404(doc_id)
    try:
        processor.force_ocr_on_document(doc_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _serialize_doc(doc_data)


@app.post("/api/documents/load-sample/{sample_filename}")
def load_sample_document(sample_filename: str):
    sample_path = SAMPLE_DIR / sample_filename
    if not sample_path.exists() or not sample_path.is_file():
        raise HTTPException(status_code=404, detail=f"Sample file '{sample_filename}' not found.")

    file_bytes = sample_path.read_bytes()
    doc_data = processor.ingest_document(sample_path.name, file_bytes)
    DOCUMENTS_STORE[doc_data["doc_id"]] = doc_data
    return _serialize_doc(doc_data)


@app.get("/api/documents/{doc_id}")
def get_document(doc_id: str):
    doc_data = _get_doc_or_404(doc_id)
    return _serialize_doc(doc_data)


@app.get("/api/documents/{doc_id}/page/{page_number}/image")
def get_pdf_page_image(doc_id: str, page_number: int, dpi: int = 150):
    doc_data = _get_doc_or_404(doc_id)
    try:
        png_bytes = processor.render_pdf_page_png(doc_data, page_number, dpi=dpi)
        return Response(content=png_bytes, media_type="image/png")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/documents/{doc_id}/reanalyze")
def reanalyze_document(doc_id: str, req: ReanalyzeRequest):
    doc_data = _get_doc_or_404(doc_id)
    if req.force_ocr and doc_data["file_type"] == "pdf":
        processor.force_ocr_on_document(doc_data)

    manual_items = []
    if req.preserve_manual:
        manual_items = [r for r in doc_data.get("redactions", []) if r.get("source") == "manual"]

    effective_conf = req.score_threshold if req.score_threshold is not None else req.min_confidence
    effective_exemptions = req.type_exemptions if req.type_exemptions else req.entity_exemptions

    auto_items = processor.detect_redactions(
        doc_data=doc_data,
        enabled_types=req.enabled_types,
        default_exemption=req.default_exemption,
        entity_exemptions=effective_exemptions,
        min_confidence=effective_conf,
        strip_titles=req.strip_titles,
    )

    combined = auto_items + manual_items
    combined.sort(key=lambda r: (r.get("page_number", 1), r.get("start") if r.get("start") is not None else 999999))
    doc_data["redactions"] = combined
    return _serialize_doc(doc_data)


@app.put("/api/documents/{doc_id}/redactions")
def replace_all_redactions(doc_id: str, req: ReplaceAllRedactionsRequest):
    doc_data = _get_doc_or_404(doc_id)
    full_text = doc_data.get("full_text", "")
    old_map = {r["id"]: r for r in doc_data.get("redactions", []) if "id" in r}

    updated_list: List[Dict[str, Any]] = []
    needs_bbox_recalc = False

    for r in req.redactions:
        rid = r.get("id") or f"red-{uuid.uuid4().hex[:10]}"
        prev = old_map.get(rid, {})
        old_text = prev.get("text")
        new_text = (r.get("text") or "").strip()

        # If text was edited/trimmed by the user, update character offsets & PDF bounding boxes
        if new_text and old_text and new_text != old_text:
            needs_bbox_recalc = True
            old_start = prev.get("start")
            old_end = prev.get("end")
            if isinstance(old_start, int) and isinstance(old_end, int):
                # Check if new_text is a substring inside or near the original span
                win_start = max(0, old_start - 30)
                win_end = min(len(full_text), old_end + 30)
                sub_idx = full_text.find(new_text, win_start, win_end)
                if sub_idx != -1:
                    r["start"] = sub_idx
                    r["end"] = sub_idx + len(new_text)
                else:
                    global_idx = full_text.find(new_text)
                    if global_idx != -1:
                        r["start"] = global_idx
                        r["end"] = global_idx + len(new_text)
            r["bboxes"] = []
            r["rects"] = []

        etype = r.get("entity_type", "CUSTOM")
        meta = ENTITY_TYPE_META.get(etype, ENTITY_TYPE_META["CUSTOM"])
        r["entity_label"] = meta["label"]
        updated_list.append(r)

    if needs_bbox_recalc and doc_data["file_type"] == "pdf":
        processor.recalculate_single_or_dirty_bboxes(doc_data, updated_list)

    doc_data["redactions"] = updated_list
    return _serialize_doc(doc_data)


@app.patch("/api/documents/{doc_id}/redactions/{redaction_id}")
def update_single_redaction(doc_id: str, redaction_id: str, req: UpdateRedactionRequest):
    doc_data = _get_doc_or_404(doc_id)
    target = None
    for r in doc_data.get("redactions", []):
        if r["id"] == redaction_id:
            target = r
            break

    if not target:
        raise HTTPException(status_code=404, detail="Redaction item not found.")

    full_text = doc_data.get("full_text", "")
    text_changed = False

    if req.enabled is not None:
        target["enabled"] = req.enabled
    if req.exemption_code is not None:
        target["exemption_code"] = req.exemption_code
    if req.entity_type is not None:
        target["entity_type"] = req.entity_type
        meta = ENTITY_TYPE_META.get(req.entity_type, ENTITY_TYPE_META["CUSTOM"])
        target["entity_label"] = meta["label"]
    if req.comment is not None:
        target["comment"] = req.comment

    if req.start is not None and req.end is not None and 0 <= req.start < req.end <= len(full_text):
        target["start"] = req.start
        target["end"] = req.end
        target["text"] = full_text[req.start:req.end]
        text_changed = True
    elif req.text is not None and req.text.strip() and req.text.strip() != target.get("text"):
        new_t = req.text.strip()
        old_start = target.get("start")
        old_end = target.get("end")
        if isinstance(old_start, int) and isinstance(old_end, int):
            win_s = max(0, old_start - 40)
            win_e = min(len(full_text), old_end + 40)
            idx = full_text.find(new_t, win_s, win_e)
            if idx != -1:
                target["start"] = idx
                target["end"] = idx + len(new_t)
            else:
                g_idx = full_text.find(new_t)
                if g_idx != -1:
                    target["start"] = g_idx
                    target["end"] = g_idx + len(new_t)
        target["text"] = new_t
        text_changed = True

    if req.bboxes is not None:
        target["bboxes"] = req.bboxes
    elif text_changed and doc_data["file_type"] == "pdf":
        target["bboxes"] = []
        processor.recalculate_single_or_dirty_bboxes(doc_data, [target])

    return _serialize_doc(doc_data)


@app.post("/api/documents/{doc_id}/redactions/bulk-update")
def bulk_update_redactions(doc_id: str, req: BulkUpdateRedactionsRequest):
    doc_data = _get_doc_or_404(doc_id)
    for r in doc_data.get("redactions", []):
        if req.redaction_ids is not None and r["id"] not in req.redaction_ids:
            continue
        if req.entity_type_filter and r["entity_type"] != req.entity_type_filter:
            continue
        if req.enabled is not None:
            r["enabled"] = req.enabled
        if req.exemption_code is not None:
            r["exemption_code"] = req.exemption_code

    return _serialize_doc(doc_data)


@app.delete("/api/documents/{doc_id}/redactions/{redaction_id}")
def delete_redaction(doc_id: str, redaction_id: str):
    doc_data = _get_doc_or_404(doc_id)
    doc_data["redactions"] = [r for r in doc_data.get("redactions", []) if r["id"] != redaction_id]
    return _serialize_doc(doc_data)


@app.post("/api/documents/{doc_id}/redactions/manual-text")
@app.post("/api/documents/{doc_id}/manual-text")
def add_manual_text_redaction(doc_id: str, req: AddManualTextRedactionRequest):
    doc_data = _get_doc_or_404(doc_id)
    phrase = req.text.strip()
    if not phrase:
        raise HTTPException(status_code=400, detail="Text to redact cannot be empty.")

    full_text = doc_data.get("full_text", "")
    meta = ENTITY_TYPE_META.get(req.entity_type, ENTITY_TYPE_META["CUSTOM"])
    new_items: List[Dict[str, Any]] = []

    if req.apply_all_occurrences:
        # Find all case-insensitive or exact occurrences in full_text
        for match in re.finditer(re.escape(phrase), full_text, re.IGNORECASE):
            new_items.append({
                "id": f"red-{uuid.uuid4().hex[:10]}",
                "start": match.start(),
                "end": match.end(),
                "text": match.group(0),
                "entity_type": req.entity_type,
                "entity_label": meta["label"],
                "exemption_code": req.exemption_code,
                "confidence": 1.0,
                "detector": "Manual Analyst Selection",
                "enabled": True,
                "source": "manual",
                "comment": req.comment,
                "page_number": req.page_number or 1,
                "bboxes": [],
            })

    # If no matches in full_text or single occurrence requested
    if not new_items:
        start_idx = req.start if req.start is not None else full_text.find(phrase)
        end_idx = req.end if req.end is not None else (start_idx + len(phrase) if start_idx != -1 else None)
        new_items.append({
            "id": f"red-{uuid.uuid4().hex[:10]}",
            "start": start_idx if start_idx != -1 else None,
            "end": end_idx,
            "text": phrase,
            "entity_type": req.entity_type,
            "entity_label": meta["label"],
            "exemption_code": req.exemption_code,
            "confidence": 1.0,
            "detector": "Manual Analyst Entry",
            "enabled": True,
            "source": "manual",
            "comment": req.comment,
            "page_number": req.page_number or 1,
            "bboxes": [],
        })

    # If PDF, locate bounding boxes on pages for the new manual text items
    if doc_data["file_type"] == "pdf":
        pdf_doc = fitz.open(doc_data["upload_path"])
        pages_meta = doc_data["pages"]
        for item in new_items:
            # Determine page from char offset if available
            c_start = item.get("start")
            if c_start is not None:
                for p in pages_meta:
                    if p["char_start"] <= c_start <= p["char_end"]:
                        item["page_number"] = p["page_number"]
                        break

            # Search on target page (or all pages if not offset-bound)
            pno = item.get("page_number", 1)
            page = pdf_doc[pno - 1]
            pw, ph = page.rect.width, page.rect.height
            rects = page.search_for(item["text"])
            bboxes = []
            for r in rects:
                bboxes.append({
                    "page_number": pno,
                    "x0": round(r.x0, 2),
                    "y0": round(r.y0, 2),
                    "x1": round(r.x1, 2),
                    "y1": round(r.y1, 2),
                    "norm_x": round(r.x0 / pw, 5),
                    "norm_y": round(r.y0 / ph, 5),
                    "norm_w": round((r.x1 - r.x0) / pw, 5),
                    "norm_h": round((r.y1 - r.y0) / ph, 5),
                })
            item["bboxes"] = bboxes
        pdf_doc.close()

    doc_data.setdefault("redactions", []).extend(new_items)
    doc_data["redactions"].sort(
        key=lambda r: (r.get("page_number", 1), r.get("start") if r.get("start") is not None else 999999)
    )
    return _serialize_doc(doc_data)


@app.post("/api/documents/{doc_id}/redactions/manual-box")
@app.post("/api/documents/{doc_id}/manual-box")
def add_manual_box_redaction(doc_id: str, req: AddManualBoxRedactionRequest):
    doc_data = _get_doc_or_404(doc_id)
    if doc_data["file_type"] != "pdf":
        raise HTTPException(status_code=400, detail="Bounding-box drawing is only supported on PDF documents.")

    page_num = req.page if req.page is not None else req.page_number
    pages_meta = doc_data.get("pages", [])
    p_meta = next((p for p in pages_meta if p.get("page_number") == page_num), pages_meta[0] if pages_meta else {"width": 612.0, "height": 792.0})
    pw = float(p_meta.get("width") or 612.0)
    ph = float(p_meta.get("height") or 792.0)

    if req.norm_x is not None and req.norm_y is not None and req.norm_w is not None and req.norm_h is not None:
        nx, ny, nw, nh = req.norm_x, req.norm_y, req.norm_w, req.norm_h
    elif req.x0 is not None and req.y0 is not None and req.x1 is not None and req.y1 is not None:
        nx = req.x0 / pw
        ny = req.y0 / ph
        nw = (req.x1 - req.x0) / pw
        nh = (req.y1 - req.y0) / ph
    else:
        raise HTTPException(status_code=400, detail="Box coordinates required.")

    extracted_text, bbox = processor.extract_text_in_pdf_box(
        doc_data, page_num, nx, ny, nw, nh
    )
    meta = ENTITY_TYPE_META.get(req.entity_type, ENTITY_TYPE_META["CUSTOM"])

    new_item = {
        "id": f"red-{uuid.uuid4().hex[:10]}",
        "start": None,
        "end": None,
        "text": extracted_text,
        "entity_type": req.entity_type,
        "entity_label": meta["label"],
        "exemption_code": req.exemption_code,
        "confidence": 1.0,
        "score": 1.0,
        "detector": "Manual Drawn Box (PDF Canvas)",
        "enabled": True,
        "source": "manual",
        "comment": req.comment,
        "page_number": page_num,
        "bboxes": [bbox],
    }

    doc_data.setdefault("redactions", []).append(new_item)
    return _serialize_doc(doc_data)


@app.post("/api/documents/{doc_id}/export")
def export_redacted_document(doc_id: str, req: ExportRedactedRequest):
    doc_data = _get_doc_or_404(doc_id)
    stamp = req.include_exemption_labels if req.include_exemption_labels is not None else req.include_exemption_stamp
    summary = processor.apply_final_redactions(
        doc_data=doc_data,
        redaction_style=req.redaction_style,
        include_exemption_stamp=stamp,
    )
    return summary


@app.get("/api/documents/{doc_id}/download/{artifact_type}")
def download_artifact(doc_id: str, artifact_type: str):
    """
    Downloads one of the generated output artifacts:
    - primary: Native format redacted file (.pdf, .docx, or .txt)
    - pdf: Burned/flattened redacted PDF
    - txt: Redacted plain text file
    - vaughn_csv: FOIA Vaughn Index CSV
    - vaughn_pdf: FOIA Vaughn Index PDF report
    - vaughn_json: FOIA Vaughn Index JSON
    """
    doc_data = _get_doc_or_404(doc_id)
    last_export = doc_data.get("last_export")
    if not last_export:
        last_export = processor.apply_final_redactions(doc_data)

    outputs = last_export.get("outputs", {})
    if artifact_type not in outputs:
        raise HTTPException(status_code=404, detail=f"Artifact '{artifact_type}' not available for this document.")

    file_path = Path(outputs[artifact_type])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Output file missing on disk.")

    stem = Path(doc_data["filename"]).stem
    download_names = {
        "primary": outputs.get("primary_filename", file_path.name),
        "pdf": f"{stem}_REDACTED.pdf",
        "docx": f"{stem}_REDACTED.docx",
        "txt": f"{stem}_REDACTED.txt",
        "vaughn_csv": f"{stem}_FOIA_VAUGHN_INDEX.csv",
        "vaughn_pdf": f"{stem}_FOIA_VAUGHN_INDEX.pdf",
        "vaughn_json": f"{stem}_FOIA_VAUGHN_INDEX.json",
    }
    return FileResponse(
        path=str(file_path),
        filename=download_names.get(artifact_type, file_path.name),
        media_type="application/octet-stream",
    )


@app.get("/api/documents/{doc_id}/redacted-page/{page_number}/image")
def get_redacted_pdf_page_image(doc_id: str, page_number: int, dpi: int = 150):
    """Renders a page of the FINAL burned/redacted PDF so the user can visually inspect the irreversible output."""
    doc_data = _get_doc_or_404(doc_id)
    last_export = doc_data.get("last_export")
    if not last_export:
        last_export = processor.apply_final_redactions(doc_data)

    pdf_path = last_export.get("outputs", {}).get("pdf")
    if not pdf_path or not Path(pdf_path).exists():
        raise HTTPException(status_code=404, detail="Redacted PDF not generated yet.")

    pdf_doc = fitz.open(pdf_path)
    if page_number < 1 or page_number > len(pdf_doc):
        pdf_doc.close()
        raise HTTPException(status_code=400, detail="Page number out of range.")
    page = pdf_doc[page_number - 1]
    zoom = 1200.0 / max(page.rect.width, 1.0)
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    png_bytes = pix.tobytes("png")
    pdf_doc.close()
    return Response(content=png_bytes, media_type="image/png")


# -------------------- Helpers & Static UI --------------------

def _get_doc_or_404(doc_id: str) -> Dict[str, Any]:
    if doc_id not in DOCUMENTS_STORE:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found.")
    return DOCUMENTS_STORE[doc_id]


def _serialize_doc(doc_data: Dict[str, Any]) -> Dict[str, Any]:
    redactions = doc_data.get("redactions", [])
    enabled_redactions = [r for r in redactions if r.get("enabled", True)]

    counts_by_type: Dict[str, int] = {}
    counts_by_exemption: Dict[str, int] = {}
    for r in redactions:
        # Ensure both `bboxes` and `rects` (with `page` alias) and `score`/`confidence` are present
        bboxes = r.get("bboxes") or []
        rects = []
        for b in bboxes:
            pno = b.get("page_number") or b.get("page") or r.get("page_number", 1)
            b["page_number"] = pno
            b["page"] = pno
            rects.append({
                "page": pno,
                "page_number": pno,
                "x0": b.get("x0", 0),
                "y0": b.get("y0", 0),
                "x1": b.get("x1", 0),
                "y1": b.get("y1", 0),
                "norm_x": b.get("norm_x", 0),
                "norm_y": b.get("norm_y", 0),
                "norm_w": b.get("norm_w", 0),
                "norm_h": b.get("norm_h", 0),
            })
        r["rects"] = rects
        if "score" not in r:
            r["score"] = r.get("confidence", 0.9)
        if "confidence" not in r:
            r["confidence"] = r.get("score", 0.9)

    for r in enabled_redactions:
        et = r.get("entity_type", "CUSTOM")
        ex = r.get("exemption_code", "(b)(6)")
        counts_by_type[et] = counts_by_type.get(et, 0) + 1
        counts_by_exemption[ex] = counts_by_exemption.get(ex, 0) + 1

    pages_list = doc_data.get("pages", [])
    pages_meta = []
    for p in pages_list:
        pno = p.get("page_number") or p.get("page") or 1
        p["page"] = pno
        p["page_number"] = pno
        pages_meta.append(p)

    ext = Path(doc_data["filename"]).suffix.lower()
    ocr_pages = [p["page_number"] for p in pages_meta if p.get("ocr_used")]

    return {
        "doc_id": doc_data["doc_id"],
        "filename": doc_data["filename"],
        "ext": ext,
        "file_type": doc_data["file_type"],
        "is_image_doc": doc_data.get("is_scanned_document", False),
        "is_scanned_document": doc_data.get("is_scanned_document", False),
        "ocr_applied": doc_data.get("is_scanned_document", False) or len(ocr_pages) > 0,
        "ocr_pages": ocr_pages,
        "ocr_pages_count": doc_data.get("ocr_pages_count", 0),
        "created_at": doc_data["created_at"],
        "page_count": doc_data["page_count"],
        "pages": pages_meta,
        "pages_meta": pages_meta,
        "full_text": doc_data["full_text"],
        "redactions": redactions,
        "stats": {
            "total_detected": len(redactions),
            "active_count": len(enabled_redactions),
            "Skipped_count": len(redactions) - len(enabled_redactions),
            "by_entity_type": counts_by_type,
            "by_exemption": counts_by_exemption,
        },
        "last_export": doc_data.get("last_export"),
    }


@app.get("/", response_class=HTMLResponse)
def serve_index():
    index_file = FRONTEND_DIR / "index.html"
    if not index_file.exists():
        return HTMLResponse("<h1>Frontend UI building...</h1>")
    return HTMLResponse(index_file.read_text(encoding="utf-8"))


if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
