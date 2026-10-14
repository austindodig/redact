"""
Offline Hybrid PII & FOIA Redaction Detection Engine.
Combines Microsoft Presidio Analyzer, spaCy large NER (en_core_web_lg),
Google libphonenumber (phonenumbers), and Federal FOIA deterministic regex recognizers.
Runs 100% locally with zero external network calls.
"""

import re
import uuid
from typing import List, Dict, Any, Optional, Tuple
import phonenumbers
import spacy
from presidio_analyzer import AnalyzerEngine, PatternRecognizer, Pattern, RecognizerResult
from presidio_analyzer.nlp_engine import NlpEngineProvider

from .foia_exemptions import ENTITY_TYPE_META

# Terms that spaCy sometimes misclassifies as PERSON in federal headers/memoranda
FEDERAL_NON_PERSON_STOPWORDS = {
    "memorandum", "memorandum for", "subject", "department", "agency", "federal",
    "freedom of information", "freedom of information act", "foia", "privacy act",
    "united states", "u.s.", "office", "inspector general", "office of inspector general",
    "general counsel", "washington", "district of columbia", "virginia", "maryland",
    "arlington", "bethesda", "reston", "alexandria", "atlanta", "chicago", "denver",
    "san francisco", "new york", "boston", "seattle", "dallas", "houston", "miami",
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december", "monday", "tuesday", "wednesday",
    "thursday", "friday", "saturday", "sunday", "unclassified", "confidential",
    "for official use only", "fouo", "controlled unclassified information", "cui",
    "sensitive", "exemption", "vaughn", "vaughn index", "redacted", "withheld",
    "page", "attachment", "enclosure", "section", "paragraph", "title", "statute",
    "usc", "cfr", "omb", "gsa", "dhs", "doj", "dod", "fbi", "cia", "nsa", "epa",
    "hhs", "va", "opm", "irs", "sec", "ftc", "fcc", "faa", "tsa", "fema", "ice",
    "cbp", "uscis", "atf", "dea", "usms", "bop", "nara", "nist", "noaa", "nasa",
    "chief", "director", "deputy", "assistant", "special agent", "analyst",
    "officer", "specialist", "supervisor", "branch", "division", "bureau",
    "committee", "commission", "board", "council", "administration", "service",
    "national", "security", "homeland", "justice", "defense", "treasury", "state",
    "interior", "agriculture", "commerce", "labor", "transportation", "energy",
    "education", "veterans", "affairs", "housing", "urban", "development",
    "north", "south", "east", "west", "street", "avenue", "boulevard", "drive",
    "road", "lane", "court", "plaza", "suite", "floor", "room", "building",
    "tel", "telephone", "phone", "fax", "mobile", "cell", "email", "e-mail",
    "ext", "extension", "ssn", "dob", "edipi", "badge", "case", "file", "ref",
    "action", "summary", "background", "discussion", "recommendation", "approved",
    "disapproved", "signature", "date", "from", "to", "thru", "through", "cc",
    "attn", "re", "fw", "fwd", "sincerely", "respectfully", "attachments",
    "clearview", "acrobat", "microsoft", "word", "excel", "outlook", "sharepoint",
    "operations", "logistics", "procurement", "contracting", "human resources",
    "information technology", "cybersecurity", "infrastructure", "agency-wide",
    "inspector", "investigations", "investigation", "reported", "interviewed",
    "stated", "confirmed", "approved", "received", "conducted", "entered"
}

HONORIFIC_PREFIXES = (
    r"(?:Mr\.|Mrs\.|Ms\.|Miss|Dr\.|Prof\.|Hon\.|Rep\.|Sen\.|Dir\.|"
    r"Gen\.|Lt\.\s*Gen\.|Maj\.\s*Gen\.|Brig\.\s*Gen\.|Col\.|Lt\.\s*Col\.|"
    r"Maj\.|Capt\.|Lt\.|1st\s*Lt\.|2nd\s*Lt\.|Sgt\.|SSgt\.|TSgt\.|MSgt\.|"
    r"Cpl\.|Spc\.|Pfc\.|Pvt\.|Adm\.|VAdm\.|RAdm\.|Cmdr\.|LCDR|ENS|"
    r"Special\s+Agent|SA|SSA|ASAC|SAC|Inspector|Auditor|Attorney|Counsel)"
)


class OfflineRedactionEngine:
    """Singleton-style offline PII detection engine using Presidio + spaCy + custom federal patterns."""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(OfflineRedactionEngine, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._init_engine()
        self._initialized = True

    def _init_engine(self):
        # Load best available local spaCy model
        try:
            self.nlp = spacy.load("en_core_web_lg")
            self.model_name = "en_core_web_lg"
        except Exception:
            self.nlp = spacy.load("en_core_web_sm")
            self.model_name = "en_core_web_sm"

        configuration = {
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": self.model_name}],
        }
        provider = NlpEngineProvider(nlp_configuration=configuration)
        nlp_engine = provider.create_engine()

        self.analyzer = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en"])
        self._register_custom_recognizers()

    def _register_custom_recognizers(self):
        # 1. Comprehensive Email Recognizer (standard, .gov, .mil, sub-addressed, mailto)
        email_patterns = [
            Pattern(
                name="standard_and_gov_email",
                regex=r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}\b",
                score=0.98,
            ),
            Pattern(
                name="spaced_or_obfuscated_email",
                regex=r"\b[A-Za-z0-9._%+\-]+\s*(?:@|\[at\]|\(at\))\s*[A-Za-z0-9.\-]+\s*(?:\.|\[dot\]|\(dot\))\s*(?:gov|mil|com|org|net|edu|us)\b",
                score=0.92,
            ),
        ]
        email_recognizer = PatternRecognizer(
            supported_entity="EMAIL_ADDRESS",
            name="FederalEmailRecognizer",
            patterns=email_patterns,
            context=["email", "e-mail", "contact", "mailto", "reach", "send"],
        )
        self.analyzer.registry.add_recognizer(email_recognizer)

        # 2. Comprehensive US / International / Federal Phone & DSN Recognizer
        phone_patterns = [
            Pattern(
                name="us_phone_with_optional_ext",
                regex=r"(?:(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})(?:\s*(?:ext\.?|extension|x|#)\s*\d{1,6})?\b",
                score=0.95,
            ),
            Pattern(
                name="dsn_military_phone",
                regex=r"\bDSN[\s:.\-]*\(?\d{3}\)?[\s.\-]?\d{3,4}[\s.\-]?\d{4}(?:\s*(?:ext\.?|x)\s*\d{1,6})?\b",
                score=0.95,
            ),
            Pattern(
                name="dsn_short_phone",
                regex=r"\bDSN[\s:.\-]+\d{3}[\s.\-]\d{4}\b",
                score=0.95,
            ),
            Pattern(
                name="intl_phone_plus",
                regex=r"\+\d{1,3}[\s.\-]?\(?\d{1,4}\)?[\s.\-]\d{2,4}[\s.\-]\d{2,4}(?:[\s.\-]\d{1,4})?\b",
                score=0.88,
            ),
            Pattern(
                name="contextual_7_digit_phone",
                regex=r"(?<=(?:Tel|Fax|ext|Ph\.|Cell)[:\s]\s)\d{3}[\s.\-]\d{4}\b",
                score=0.85,
            ),
        ]
        phone_recognizer = PatternRecognizer(
            supported_entity="PHONE_NUMBER",
            name="FederalPhoneRecognizer",
            patterns=phone_patterns,
            context=["phone", "tel", "telephone", "mobile", "cell", "fax", "call", "contact", "dsn", "ext", "direct"],
        )
        self.analyzer.registry.add_recognizer(phone_recognizer)

        # 3. Federal / Military Person Name Patterns (Honorifics)
        person_patterns = [
            Pattern(
                name="honorific_person_name",
                regex=rf"(?-i:\b{HONORIFIC_PREFIXES}\s+[A-Z][a-z]{{1,20}}(?:\s+[A-Z]\.?)?\s+[A-Z][a-zA-Z\-']{{1,25}}(?:\s*,\s*(?:Jr\.|Sr\.|II|III|IV|Ph\.?D\.?|M\.?D\.?|Esq\.?))?\b)",
                score=0.92,
            ),
        ]
        person_recognizer = PatternRecognizer(
            supported_entity="PERSON",
            name="FederalPersonPatternRecognizer",
            patterns=person_patterns,
            context=["name", "employee", "agent", "complainant", "witness", "subject", "from", "to", "thru", "by", "signed", "poc", "contact", "interviewed"],
        )
        self.analyzer.registry.add_recognizer(person_recognizer)

        # 4. US Social Security Number (formatted & contextual)
        ssn_patterns = [
            Pattern(
                name="ssn_dashed",
                regex=r"\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b",
                score=0.96,
            ),
            Pattern(
                name="ssn_spaced",
                regex=r"(?<=(?:SSN|Social Security|Soc Sec)[:\s#]\s)(?!000|666|9\d\d)\d{3}[\s\-](?!00)\d{2}[\s\-](?!0000)\d{4}\b",
                score=0.98,
            ),
            Pattern(
                name="ssn_last_four",
                regex=r"\b(?:XXX-XX-|xxx-xx-|\*\*\*-\*\*-)\d{4}\b",
                score=0.92,
            ),
        ]
        ssn_recognizer = PatternRecognizer(
            supported_entity="US_SSN",
            name="FederalSSNRecognizer",
            patterns=ssn_patterns,
            context=["ssn", "social", "security", "tax", "tin", "identification"],
        )
        self.analyzer.registry.add_recognizer(ssn_recognizer)

        # 5. Federal Badge / DoD EDIPI / Employee ID
        emp_id_patterns = [
            Pattern(
                name="dod_edipi",
                regex=r"\b(?:EDIPI|DoD\s*ID|CAC\s*ID)[\s:#\-]*\d{10}\b",
                score=0.95,
            ),
            Pattern(
                name="federal_badge_or_emp_id",
                regex=r"\b(?:Badge|Employee\s*ID|Emp\s*ID|Agent\s*ID|Credential|Personnel\s*No\.?|File\s*No\.?)[\s:#\-]*[A-Z0-9]{2,6}[\-]?\d{3,8}\b",
                score=0.90,
            ),
        ]
        emp_id_recognizer = PatternRecognizer(
            supported_entity="EMPLOYEE_ID",
            name="FederalEmployeeIDRecognizer",
            patterns=emp_id_patterns,
            context=["badge", "edipi", "employee", "credential", "id", "personnel"],
        )
        self.analyzer.registry.add_recognizer(emp_id_recognizer)

        # 6. Street / Residential Address
        address_patterns = [
            Pattern(
                name="us_street_address",
                regex=r"(?-i:\b\d{1,6}\s+(?:[A-Z][a-zA-Z0-9.]+\s+){1,4}(?:Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Road|Rd\.?|Lane|Ln\.?|Court|Ct\.?|Way|Place|Pl\.?|Circle|Cir\.?|Parkway|Pkwy\.?|Terrace|Ter\.?)(?:\s*,?\s*(?:Apt\.?|Suite|Ste\.?|Unit|#)\s*[A-Za-z0-9\-]+)?(?:\s*,\s*[A-Z][a-zA-Z\s]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)?)",
                score=0.92,
            )
        ]
        address_recognizer = PatternRecognizer(
            supported_entity="STREET_ADDRESS",
            name="FederalStreetAddressRecognizer",
            patterns=address_patterns,
            context=["address", "residence", "home", "located", "street", "live", "resides"],
        )
        self.analyzer.registry.add_recognizer(address_recognizer)

    def _detect_contextual_names(self, text: str) -> List[Dict[str, Any]]:
        """
        Detects names following federal memorandum labels (TO:, FROM:, SUBJECT:, POC:,
        Complainant:, Witness:, Signed by:, etc.) that general NER might occasionally miss
        or split.
        """
        results = []
        # Pattern 1: Memo header fields like "FROM: John A. Doe, Supervisory Special Agent"
        memo_field_regex = re.compile(
            r"(?:^|\n)\s*(?:FROM|TO|THRU|THROUGH|ATTN|POC|POINT OF CONTACT|PREPARED BY|APPROVED BY|REVIEWED BY|COMPLAINANT|SUBJECT INDIVIDUAL|WITNESS|INTERVIEWEE|EMPLOYEE|APPLICANT|REQUESTER)\s*:\s*"
            r"((?:" + HONORIFIC_PREFIXES + r"\s+)?[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-zA-Z\-']+)",
            re.MULTILINE,
        )
        for match in memo_field_regex.finditer(text):
            candidate = match.group(1).strip()
            if self._is_valid_person_name(candidate):
                results.append({
                    "start": match.start(1),
                    "end": match.end(1),
                    "text": candidate,
                    "entity_type": "PERSON",
                    "confidence": 0.94,
                    "detector": "Federal Contextual Header Analyzer",
                })

        # Pattern 2: Signature blocks or inline role attributions e.g. "Special Agent Marcus Vance" or "Analyst Sarah K. Jenkins"
        role_name_regex = re.compile(
            r"\b(?:Special\s+Agent|Supervisory\s+Special\s+Agent|Senior\s+Analyst|FOIA\s+Officer|"
            r"Investigator|Inspector|Complainant|Witness|Director|Deputy\s+Director|"
            r"Branch\s+Chief|Section\s+Chief|General\s+Counsel|Attorney|Contractor|"
            r"Dr\.|Mr\.|Mrs\.|Ms\.|Col\.|Maj\.|Capt\.|Sgt\.|Lt\.)\s+"
            r"([A-Z][a-z]{1,20}(?:\s+[A-Z]\.?)?\s+[A-Z][a-zA-Z\-']{1,22}(?:\s+(?:Jr\.|Sr\.|II|III))?)\b"
        )
        for match in role_name_regex.finditer(text):
            # Capture either full with honorific if short title (Dr./Mr./Ms.) or the name part
            full_text = match.group(0).strip()
            name_only = match.group(1).strip()
            if self._is_valid_person_name(name_only):
                # If prefix is a personal title (Mr., Ms., Mrs., Dr., Col., etc.), include it; otherwise just the person's name
                if re.match(r"^(?:Dr\.|Mr\.|Mrs\.|Ms\.|Col\.|Maj\.|Capt\.|Sgt\.|Lt\.)\b", full_text):
                    results.append({
                        "start": match.start(0),
                        "end": match.end(0),
                        "text": full_text,
                        "entity_type": "PERSON",
                        "confidence": 0.95,
                        "detector": "Federal Role/Honorific Analyzer",
                    })
                else:
                    results.append({
                        "start": match.start(1),
                        "end": match.end(1),
                        "text": name_only,
                        "entity_type": "PERSON",
                        "confidence": 0.93,
                        "detector": "Federal Role/Honorific Analyzer",
                    })

        return results

    def _detect_phonenumbers_lib(self, text: str) -> List[Dict[str, Any]]:
        """Uses Google's libphonenumber (offline) to catch any valid US phone numbers."""
        results = []
        try:
            for match in phonenumbers.PhoneNumberMatcher(text, "US"):
                raw = match.raw_string.strip()
                start = match.start
                end = match.end
                # Check if followed by an extension like " ext. 4412" or " x109"
                ext_match = re.match(r"^\s*(?:ext\.?|extension|x)\s*\d{1,6}\b", text[end:], re.IGNORECASE)
                if ext_match:
                    end += ext_match.end()
                    raw = text[start:end]
                results.append({
                    "start": start,
                    "end": end,
                    "text": raw,
                    "entity_type": "PHONE_NUMBER",
                    "confidence": 0.96,
                    "detector": "Google libphonenumber (Offline US Matcher)",
                })
        except Exception:
            pass
        return results

    def _is_valid_person_name(self, candidate: str) -> bool:
        """Filters out false-positive spaCy PERSON detections (agencies, cities, headers, dates)."""
        cleaned = candidate.strip()
        if len(cleaned) < 3:
            return False
        # Must not contain newlines or excessive punctuation
        if "\n" in cleaned or "\r" in cleaned:
            return False
        # Must not contain @ or digits (unless Jr./II/III)
        if "@" in cleaned:
            return False
        if re.search(r"\d", cleaned) and not re.search(r"\b(?:1st|2nd|3rd|II|III|IV)\b", cleaned):
            return False

        lower = cleaned.lower().strip(".,:;()[]\"'")
        if lower in FEDERAL_NON_PERSON_STOPWORDS:
            return False

        # Check individual tokens against stopwords
        raw_words = [w.strip(".,:;()[]\"'-") for w in cleaned.split() if w.strip(".,:;()[]\"'-")]
        if not raw_words:
            return False

        # Every word in a valid person name must start with an uppercase letter (or be a particle like de/van/von)
        particles = {"de", "del", "della", "di", "du", "la", "le", "van", "von", "der", "den", "al", "bin", "ibn"}
        for w in raw_words:
            if w.lower() not in particles and not w[0].isupper():
                return False

        tokens = [w.lower() for w in raw_words]
        if all(t in FEDERAL_NON_PERSON_STOPWORDS for t in tokens):
            return False

        # If any token is a known non-person structural/header word, reject
        structural_non_person = {
            "inspector", "general", "investigations", "investigation", "department",
            "agency", "federal", "memorandum", "office", "bureau", "division",
            "branch", "section", "vault", "sector", "facility", "center", "national",
            "infrastructure", "operations", "system", "systems", "drive", "street",
            "avenue", "road", "boulevard", "lane", "apt", "suite", "terrace",
            "braddock", "dominion", "evergreen", "lake", "shore", "market",
            "arlington", "alexandria", "bethesda", "chicago", "washington",
            "homeland", "security", "justice", "services", "administration",
            "direct", "mobile", "phone", "telephone", "email", "address",
            "addresses", "numbers", "names", "signed", "urgent", "cluster",
            "failover", "exhibit", "appendix", "summary", "testimony", "witness",
            "complainant", "subject", "contract", "modification", "unclassified",
            "military", "commercial", "official", "personal", "external"
        }
        if any(t in structural_non_person for t in tokens):
            return False

        # Single-word PERSON detections from NER are often noisy unless capitalized properly
        # Keep single-word names only if they are at least 3 chars and not a common English word/header
        if len(tokens) == 1:
            if cleaned.isupper() and len(cleaned) <= 5:
                # Likely an acronym like FOIA, CUI, DHS, OIG
                return False
            if tokens[0] in FEDERAL_NON_PERSON_STOPWORDS:
                return False

        return True

    def analyze_text(
        self,
        text: str,
        enabled_types: Optional[List[str]] = None,
        default_exemption: str = "(b)(6)",
        entity_exemptions: Optional[Dict[str, str]] = None,
        min_confidence: float = 0.45,
    ) -> List[Dict[str, Any]]:
        """
        Runs full hybrid detection on `text` and returns de-duplicated, non-overlapping spans
        sorted by start offset.
        """
        if not text or not text.strip():
            return []

        if enabled_types is None:
            enabled_types = [
                "PERSON",
                "PHONE_NUMBER",
                "EMAIL_ADDRESS",
                "US_SSN",
                "EMPLOYEE_ID",
                "STREET_ADDRESS",
            ]

        entity_exemptions = entity_exemptions or {}

        # Map our entity types to Presidio supported entities
        presidio_entities = [e for e in enabled_types if e in {
            "PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS", "US_SSN", "EMPLOYEE_ID", "STREET_ADDRESS"
        }]

        raw_candidates: List[Dict[str, Any]] = []

        # 1. Run Presidio Analyzer (includes spaCy NER + our custom PatternRecognizers)
        if presidio_entities:
            presidio_results: List[RecognizerResult] = self.analyzer.analyze(
                text=text,
                language="en",
                entities=presidio_entities,
                score_threshold=min_confidence,
            )
            for res in presidio_results:
                span_start = res.start
                span_end = res.end
                span_text = text[span_start:span_end]

                # Trim leading/trailing whitespace, dashes, or stray newlines from span
                while span_start < span_end and text[span_start] in " \t\r\n,;:.-*•":
                    span_start += 1
                while span_end > span_start and text[span_end - 1] in " \t\r\n,;:-*•":
                    span_end -= 1
                span_text = text[span_start:span_end]

                if not span_text:
                    continue

                if res.entity_type == "PERSON":
                    # Split across newlines if spaCy grouped across line breaks
                    if "\n" in span_text:
                        parts = span_text.split("\n")
                        offset = span_start
                        for part in parts:
                            p_strip = part.strip(" \t\r\n,;:.-*•")
                            if p_strip and self._is_valid_person_name(p_strip):
                                sub_start = text.find(p_strip, offset, offset + len(part) + 1)
                                if sub_start != -1:
                                    raw_candidates.append({
                                        "start": sub_start,
                                        "end": sub_start + len(p_strip),
                                        "text": p_strip,
                                        "entity_type": "PERSON",
                                        "confidence": round(float(res.score), 2),
                                        "detector": f"Presidio + spaCy ({self.model_name})",
                                    })
                            offset += len(part) + 1
                        continue

                    if not self._is_valid_person_name(span_text):
                        continue

                raw_candidates.append({
                    "start": span_start,
                    "end": span_end,
                    "text": span_text,
                    "entity_type": res.entity_type,
                    "confidence": round(float(res.score), 2),
                    "detector": f"Presidio ({self.model_name})",
                })

        # 2. Run Google libphonenumber if PHONE_NUMBER enabled
        if "PHONE_NUMBER" in enabled_types:
            raw_candidates.extend(self._detect_phonenumbers_lib(text))

        # 3. Run contextual federal name matcher if PERSON enabled
        if "PERSON" in enabled_types:
            raw_candidates.extend(self._detect_contextual_names(text))
            # Propagate multi-word full names found in the document to other occurrences
            raw_candidates.extend(self._propagate_detected_names(text, raw_candidates))

        # 4. Resolve overlapping spans (prefer higher specificity / longer span / higher score)
        merged = self._resolve_overlaps(raw_candidates)

        # 5. Enrich with FOIA exemption codes and metadata
        final_items: List[Dict[str, Any]] = []
        for item in merged:
            etype = item["entity_type"]
            meta = ENTITY_TYPE_META.get(etype, ENTITY_TYPE_META["CUSTOM"])
            exemption = (
                entity_exemptions.get(etype)
                or default_exemption
                or meta.get("default_exemption", "(b)(6)")
            )
            final_items.append({
                "id": f"red-{uuid.uuid4().hex[:10]}",
                "start": item["start"],
                "end": item["end"],
                "text": item["text"],
                "entity_type": etype,
                "entity_label": meta["label"],
                "exemption_code": exemption,
                "confidence": item["confidence"],
                "detector": item["detector"],
                "enabled": True,
                "source": "auto",
                "comment": "",
            })

        return final_items

    def _propagate_detected_names(
        self, text: str, current_candidates: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Ensures consistency across the document: if a high-confidence multi-word PERSON
        name (e.g. 'Elena Rostova') is detected, also flag any exact matches of that full
        name or 'Last, First' variation elsewhere in the document.
        """
        propagated = []
        high_conf_names = set()
        for c in current_candidates:
            if c["entity_type"] == "PERSON" and c["confidence"] >= 0.85:
                words = c["text"].split()
                if len(words) >= 2 and self._is_valid_person_name(c["text"]):
                    high_conf_names.add(c["text"])

        for name in high_conf_names:
            for match in re.finditer(rf"\b{re.escape(name)}\b", text):
                propagated.append({
                    "start": match.start(),
                    "end": match.end(),
                    "text": match.group(0),
                    "entity_type": "PERSON",
                    "confidence": 0.90,
                    "detector": "Entity Consistency Propagator",
                })

        return propagated

    def _resolve_overlaps(self, candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Resolves overlapping entity spans.
        Priority: EMAIL_ADDRESS & US_SSN & PHONE_NUMBER take precedence over partial PERSON matches;
        longer spans beat shorter spans when of the same or compatible type.
        """
        if not candidates:
            return []

        type_priority = {
            "EMAIL_ADDRESS": 5,
            "US_SSN": 5,
            "PHONE_NUMBER": 4,
            "EMPLOYEE_ID": 4,
            "PERSON": 3,
            "STREET_ADDRESS": 2,
            "CUSTOM": 1,
        }

        # Sort by: start ASC, length DESC, type_priority DESC, confidence DESC
        sorted_cands = sorted(
            candidates,
            key=lambda c: (
                c["start"],
                -(c["end"] - c["start"]),
                -type_priority.get(c["entity_type"], 1),
                -c["confidence"],
            ),
        )

        accepted: List[Dict[str, Any]] = []
        for cand in sorted_cands:
            c_start, c_end = cand["start"], cand["end"]
            overlap_idx = None
            for idx, acc in enumerate(accepted):
                a_start, a_end = acc["start"], acc["end"]
                # Check if intervals overlap
                if max(c_start, a_start) < min(c_end, a_end):
                    overlap_idx = idx
                    break

            if overlap_idx is None:
                accepted.append(cand)
            else:
                acc = accepted[overlap_idx]
                c_prio = type_priority.get(cand["entity_type"], 1)
                a_prio = type_priority.get(acc["entity_type"], 1)
                c_len = c_end - c_start
                a_len = acc["end"] - acc["start"]

                # Replace if candidate has strictly higher type priority (e.g., EMAIL over PERSON inside email)
                # or same type and longer span
                if c_prio > a_prio or (c_prio == a_prio and c_len > a_len):
                    accepted[overlap_idx] = cand

        accepted.sort(key=lambda x: x["start"])
        return accepted
