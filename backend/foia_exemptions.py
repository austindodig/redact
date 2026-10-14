"""
FOIA Exemption Catalog (5 U.S.C. § 552(b)) & Privacy Act (5 U.S.C. § 552a)
Standard federal exemptions, sub-exemptions, and statutory rationale for Vaught Index generation.
"""

from typing import Dict, List, Any

FOIA_EXEMPTIONS: List[Dict[str, Any]] = [
    {
        "code": "(b)(6)",
        "statute": "5 U.S.C. § 552(b)(6)",
        "title": "Personal Privacy (Personnel, Medical, & Similar Files)",
        "short_label": "(b)(6) - Personal Privacy",
        "description": "Protects information in personnel and medical files and similar files when disclosure would constitute a clearly unwarranted invasion of personal privacy.",
        "vaughn_rationale": "Withheld to protect the personal privacy of individuals (including names, home/direct phone numbers, personal email addresses, SSNs, and residential addresses) where disclosure would constitute a clearly unwarranted invasion of personal privacy and does not shed light on agency operations.",
        "common_for": ["PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "US_SSN", "LOCATION", "DATE_OF_BIRTH"],
        "color": "#1e40af"
    },
    {
        "code": "(b)(7)(C)",
        "statute": "5 U.S.C. § 552(b)(7)(C)",
        "title": "Law Enforcement — Personal Privacy",
        "short_label": "(b)(7)(C) - Law Enforcement Privacy",
        "description": "Protects records or information compiled for law enforcement purposes to the extent that production could reasonably be expected to constitute an unwarranted invasion of personal privacy.",
        "vaughn_rationale": "Withheld from law enforcement/investigative records to protect the identities and contact information of third parties, witnesses, investigators, and subjects, as disclosure could reasonably be expected to cause harassment, embarrassment, or unwarranted invasion of privacy.",
        "common_for": ["PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS", "US_SSN"],
        "color": "#9a3412"
    },
    {
        "code": "(b)(7)(F)",
        "statute": "5 U.S.C. § 552(b)(7)(F)",
        "title": "Law Enforcement — Physical Safety",
        "short_label": "(b)(7)(F) - Physical Safety",
        "description": "Protects law enforcement information that could reasonably be expected to endanger the life or physical safety of any individual.",
        "vaughn_rationale": "Withheld to protect the identities and direct contact details of federal personnel and cooperating individuals where release could reasonably be expected to endanger their life or physical safety.",
        "common_for": ["PERSON", "PHONE_NUMBER", "LOCATION"],
        "color": "#991b1b"
    },
    {
        "code": "(b)(7)(E)",
        "statute": "5 U.S.C. § 552(b)(7)(E)",
        "title": "Law Enforcement — Techniques & Procedures",
        "short_label": "(b)(7)(E) - Law Enforcement Techniques",
        "description": "Protects techniques and procedures for law enforcement investigations or prosecutions, or guidelines if disclosure could reasonably risk circumvention of the law.",
        "vaughn_rationale": "Withheld to protect non-public internal law enforcement systems, internal URLs/identifiers, and investigative procedures whose disclosure could risk circumvention of the law.",
        "common_for": ["CASE_ID", "INTERNAL_SYSTEM", "CUSTOM"],
        "color": "#6b21a8"
    },
    {
        "code": "(b)(7)(D)",
        "statute": "5 U.S.C. § 552(b)(7)(D)",
        "title": "Law Enforcement — Confidential Sources",
        "short_label": "(b)(7)(D) - Confidential Sources",
        "description": "Protects the identity of a confidential source and information furnished by a confidential source in a criminal or national security investigation.",
        "vaughn_rationale": "Withheld to protect the identity, contact details, and information provided by a confidential source under an express or implied assurance of confidentiality.",
        "common_for": ["PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS"],
        "color": "#854d0e"
    },
    {
        "code": "(b)(5)",
        "statute": "5 U.S.C. § 552(b)(5)",
        "title": "Inter-Agency / Intra-Agency Privileged Memoranda",
        "short_label": "(b)(5) - Deliberative / Attorney-Client Privilege",
        "description": "Protects inter-agency or intra-agency memorandums or letters that would not be available by law to a party other than an agency in litigation with the agency (Deliberative Process, Attorney-Client, Attorney Work-Product).",
        "vaughn_rationale": "Withheld as pre-decisional and deliberative intra-agency communication, or privileged attorney-client advice, the disclosure of which would chill candid agency deliberations.",
        "common_for": ["CUSTOM"],
        "color": "#3730a3"
    },
    {
        "code": "(b)(4)",
        "statute": "5 U.S.C. § 552(b)(4)",
        "title": "Trade Secrets & Commercial/Financial Information",
        "short_label": "(b)(4) - Commercial / Trade Secrets",
        "description": "Protects trade secrets and commercial or financial information obtained from a person that is privileged or confidential.",
        "vaughn_rationale": "Withheld to protect confidential commercial or financial information (such as banking/account numbers, proprietary contractor pricing, or trade secrets) customarily and actually treated as private by the submitter.",
        "common_for": ["FINANCIAL", "CUSTOM"],
        "color": "#065f46"
    },
    {
        "code": "(b)(3)",
        "statute": "5 U.S.C. § 552(b)(3)",
        "title": "Specifically Exempted by Other Statute",
        "short_label": "(b)(3) - Statutory Exemption",
        "description": "Protects information specifically exempted from disclosure by another federal statute (e.g., 26 U.S.C. § 6103 tax returns, 50 U.S.C. § 3024(i) intelligence sources, Fed. R. Crim. P. 6(e) grand jury).",
        "vaughn_rationale": "Withheld pursuant to a specific federal withholding statute leaving no discretion or establishing particular criteria for withholding.",
        "common_for": ["US_SSN", "CASE_ID", "CUSTOM"],
        "color": "#115e59"
    },
    {
        "code": "(b)(2)",
        "statute": "5 U.S.C. § 552(b)(2)",
        "title": "Internal Personnel Rules & Practices",
        "short_label": "(b)(2) - Internal Personnel Rules",
        "description": "Protects matters that are related solely to the internal personnel rules and practices of an agency.",
        "vaughn_rationale": "Withheld as information relating solely to internal agency personnel rules and administrative practices.",
        "common_for": ["EMPLOYEE_ID", "CUSTOM"],
        "color": "#475569"
    },
    {
        "code": "(b)(1)",
        "statute": "5 U.S.C. § 552(b)(1)",
        "title": "Classified National Defense & Foreign Policy",
        "short_label": "(b)(1) - National Security (Classified)",
        "description": "Protects information specifically authorized under criteria established by an Executive Order to be kept secret in the interest of national defense or foreign policy.",
        "vaughn_rationale": "Withheld as properly classified national security information pursuant to Executive Order 13526.",
        "common_for": ["CUSTOM"],
        "color": "#7f1d1d"
    },
    {
        "code": "(b)(6), (b)(7)(C)",
        "statute": "5 U.S.C. § 552(b)(6) & (b)(7)(C)",
        "title": "Dual Privacy Exemption (Personnel + Law Enforcement)",
        "short_label": "(b)(6), (b)(7)(C) - Dual Privacy",
        "description": "Jointly cited in federal records containing both personnel/similar file data and law enforcement records to protect personal PII (names, phone numbers, email addresses).",
        "vaughn_rationale": "Jointly withheld under Exemptions 6 and 7(C) to protect the names, telephone numbers, email addresses, and personal identifiers of federal employees, witnesses, and third parties mentioned in investigative or administrative files.",
        "common_for": ["PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS", "US_SSN"],
        "color": "#1d4ed8"
    },
    {
        "code": "PA (d)(5) / (k)(2)",
        "statute": "5 U.S.C. § 552a(d)(5) & (k)(2)",
        "title": "Privacy Act Exemption",
        "short_label": "PA (d)(5)/(k)(2) - Privacy Act",
        "description": "Protects first-party investigative material compiled for law enforcement or civil action/proceeding under the Privacy Act.",
        "vaughn_rationale": "Withheld pursuant to the Privacy Act of 1974 (5 U.S.C. § 552a) to protect third-party privacy and investigative material.",
        "common_for": ["PERSON", "US_SSN", "CUSTOM"],
        "color": "#334155"
    }
]

EXEMPTION_MAP: Dict[str, Dict[str, Any]] = {item["code"]: item for item in FOIA_EXEMPTIONS}

ENTITY_TYPE_META: Dict[str, Dict[str, str]] = {
    "PERSON": {
        "label": "Person / Name",
        "default_exemption": "(b)(6)",
        "badge_color": "#2563eb",
        "bg_color": "rgba(37, 99, 235, 0.22)",
        "border_color": "#1d4ed8",
        "priority": "PRIMARY"
    },
    "PHONE_NUMBER": {
        "label": "Phone Number",
        "default_exemption": "(b)(6)",
        "badge_color": "#059669",
        "bg_color": "rgba(5, 150, 105, 0.22)",
        "border_color": "#047857",
        "priority": "PRIMARY"
    },
    "EMAIL_ADDRESS": {
        "label": "Email Address",
        "default_exemption": "(b)(6)",
        "badge_color": "#7c3aed",
        "bg_color": "rgba(124, 58, 237, 0.22)",
        "border_color": "#6d28d9",
        "priority": "PRIMARY"
    },
    "US_SSN": {
        "label": "Social Security Number",
        "default_exemption": "(b)(6)",
        "badge_color": "#dc2626",
        "bg_color": "rgba(220, 38, 38, 0.22)",
        "border_color": "#b91c1c",
        "priority": "SECONDARY"
    },
    "EMPLOYEE_ID": {
        "label": "Federal Badge / DoD EDIPI / ID",
        "default_exemption": "(b)(6)",
        "badge_color": "#d97706",
        "bg_color": "rgba(217, 119, 6, 0.22)",
        "border_color": "#b45309",
        "priority": "SECONDARY"
    },
    "STREET_ADDRESS": {
        "label": "Residential / Street Address",
        "default_exemption": "(b)(6)",
        "badge_color": "#0891b2",
        "bg_color": "rgba(8, 145, 178, 0.22)",
        "border_color": "#0e7490",
        "priority": "SECONDARY"
    },
    "CUSTOM": {
        "label": "Manual / Custom Redaction",
        "default_exemption": "(b)(6)",
        "badge_color": "#475569",
        "bg_color": "rgba(71, 85, 105, 0.25)",
        "border_color": "#334155",
        "priority": "MANUAL"
    }
}


def get_exemption_details(code: str) -> Dict[str, Any]:
    if code in EXEMPTION_MAP:
        return EXEMPTION_MAP[code]
    return {
        "code": code,
        "statute": f"5 U.S.C. § 552 {code}",
        "title": "Custom FOIA Exemption Citation",
        "short_label": code,
        "description": "Custom exemption citation applied by FOIA analyst.",
        "vaughn_rationale": f"Withheld pursuant to FOIA Exemption {code} as determined by agency review.",
        "common_for": ["CUSTOM"],
        "color": "#334155"
    }
