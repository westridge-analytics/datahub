#!/usr/bin/env python3
"""
IRS SOI 990 data ingestion pipeline.

Reads space-delimited (.dat) and CSV source files from the IRS Statistics of
Income division, normalises financial fields, and upserts into a Postgres
database (Neon / Vercel Postgres).

Usage:
    python ingest.py [--data-dir PATH] [--eobmf PATH] [--dry-run] [--files FILE ...]

Examples:
    # Load only the 4 most recent files
    python ingest.py --files 21eoextract990.csv 22eoextract990.csv 23eoextract990.csv 24eoextract990.csv

    # Load all files (no --files flag = discover everything in --data-dir)
    python ingest.py
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path
from typing import Optional, Tuple

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Space-delimited 990 files (py12–py14, 15eo–17eo)
SPACE_DELIM_PATTERNS = {
    "py12_990.dat",
    "py13_990.dat",
    "py14_990.dat",
    "15eofinextract990.dat",
    "16eofinextract990.dat",
    "17eofinextract990.dat",
}

# Space-delimited 990-EZ files
SPACE_DELIM_EZ_PATTERNS = {
    "py12_990ez.dat",
    "py13_EZ.dat",
    "py14_EZ.dat",
    "15eofinextractEZ.dat",
    "16eofinextractez.dat",
    "17eofinextractEZ.dat",
}

# Space-delimited 990-PF files
SPACE_DELIM_PF_PATTERNS = {
    "py12_990pf.dat",
    "py13_990pf.dat",
    "py14_990pf.dat",
    "15eofinextract990pf.dat",
    "16eofinextract990pf.dat",
}

# CSV files (18eo–24eo) — filter to elf == 'E' for full Form 990.
CSV_PATTERNS_PREFIX = "eoextract990.csv"  # filenames like 18eoextract990.csv

# CSV 990-EZ files — filenames like 18eoextractez.csv or 24eoextract990EZ.csv
def is_ez_csv(filename: str) -> bool:
    f = filename.lower()
    return f.endswith(".csv") and ("ez" in f) and f[:2].isdigit()

# CSV 990-PF files — filenames like 20eoextract990pf.csv
def is_pf_csv(filename: str) -> bool:
    f = filename.lower()
    return f.endswith(".csv") and "990pf" in f and f[:2].isdigit()

NTEE_SECTOR_MAP = {
    "A": "Arts, Culture & Humanities",
    "B": "Education",
    "C": "Environment & Animals",
    "D": "Environment & Animals",
    "E": "Health",
    "F": "Health",
    "G": "Health",
    "H": "Health",
    "I": "Human Services",
    "J": "Human Services",
    "K": "Human Services",
    "L": "Human Services",
    "M": "Human Services",
    "N": "Human Services",
    "O": "Human Services",
    "P": "Human Services",
    "Q": "International & Foreign Affairs",
    "R": "Public & Societal Benefit",
    "S": "Public & Societal Benefit",
    "T": "Public & Societal Benefit",
    "U": "Public & Societal Benefit",
    "V": "Public & Societal Benefit",
    "W": "Public & Societal Benefit",
    "X": "Religion",
    "Y": "Mutual & Membership Benefit",
    "Z": "Unknown",
}

# IRS source field names that are extracted into named filings columns.
# Everything else in a raw row lands in filings_raw.raw_data.
PROMOTED_FIELDS = {
    # identifiers / period
    "elf", "efile", "e-file", "ein", "tax_pd", "tax_prd", "taxprd", "taxpd",
    "a_tax_prd", "subseccd",
    # existing main financials
    "totrevenue", "totfuncexpns", "totassetsend", "totliabend", "totnetassetend",
    "totcntrbgfts", "totprgmrevnue", "invstmntinc",
    "totprgmrvnueexpns", "totgeneralexpns", "totfundrsng",
    "nonintcashend", "cashnonsaved",
    "svngstempinvend", "svngstempinvst",
    "lndbldgsequipend", "lndbldgsequip",
    "invstmntsend", "invstmntsothrend",
    "invstmntspublicly", "invstmntsothrsec",
    "unrstrctnetasstsend", "unrstrctdnetasstsend",
    "temprstrctnetasstsend", "temprstrctdnetasstsend",
    "permrstrctnetasstsend", "permrstrctdnetasstsend",
    # new: headcount
    "noemplyeesw3cnt", "noindiv100kcnt", "nocontractor100kcnt",
    # new: compensation summary
    "totreprtabled", "totcomprelatede", "totestcompf",
    # new: Part IX expense detail
    "compnsatncurrofcr", "compnsatnandothr", "othrsalwages",
    "pensionplancontrb", "othremplyeebenef", "payrolltx",
    "profndraising", "feesforsrvcmgmt", "legalfees", "accntingfees",
    "occupancy", "travel", "infotech", "deprcatndepletn", "insurance",
    # new: grants paid
    "grntstogovt", "grnsttoindiv", "grntstofrgngovt",
    # new: revenue components
    "royaltsinc", "netrntlinc", "netgnls", "netincfndrsng", "netincgaming",
    # new: balance sheet detail
    "pldgegrntrcvblend", "accntspayableend", "txexmptbndsend",
    "secrdmrtgsend", "unsecurednotesend",
    "invstmntsprgmend",
    # new: governance flags
    "lbbyingactvtscd", "politicalactvtscd", "unrelbusinccd",
    "frgnofficecd", "frgngrntscd", "operatehosptlcd", "operateschools170cd",
    "reltdorgcd",
    # EZ-specific synonyms already handled
    "totrevnue", "totexpns", "totassetsend", "totliabend",
    "totnetassetsend", "networthend",
    "totcntrbs", "prgmservrev", "othrinvstinc",
    # PF-specific synonyms already handled
    "totrcptperbks", "totexpnspbks", "tfundnworth",
    "grscontrgifts", "netinvstinc", "topradmnexpnsa", "othrcashamt",
    "totinvstsec", "invstcorpstk", "invstcorpbnd", "invstgovtoblig",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def fmt_ein(raw: str) -> str | None:
    """Return EIN in XX-XXXXXXX format, or None if invalid."""
    digits = "".join(c for c in str(raw).strip() if c.isdigit())
    if not digits:
        return None
    digits = digits.zfill(9)
    if len(digits) != 9:
        return None
    return f"{digits[:2]}-{digits[2:]}"


def parse_int(value) -> int | None:
    """Cast value to int; return None for empty / non-numeric."""
    if value is None:
        return None
    s = str(value).strip()
    if s == "" or s == "." or s.lower() in ("nan", "null", "none"):
        return None
    try:
        return int(float(s))
    except (ValueError, OverflowError):
        return None


def parse_bool(value) -> bool | None:
    """Parse IRS Y/N flag to bool; return None if absent."""
    if value is None:
        return None
    s = str(value).strip().upper()
    if s in ("Y", "1", "TRUE", "YES"):
        return True
    if s in ("N", "0", "FALSE", "NO"):
        return False
    return None


def tax_period_to_date(raw) -> tuple[str | None, int | None]:
    """
    Convert a YYYYMM string to (YYYY-MM-01, YYYY).
    Returns (None, None) on failure.
    """
    s = str(raw).strip()
    if len(s) != 6 or not s.isdigit():
        return None, None
    yyyy, mm = s[:4], s[4:]
    if not (1 <= int(mm) <= 12):
        return None, None
    return f"{yyyy}-{mm}-01", int(yyyy)


def sum_fields(row: dict, *field_names) -> int | None:
    """Sum multiple fields from a row dict, returning None if all are absent."""
    total = None
    for name in field_names:
        val = parse_int(row.get(name))
        if val is not None:
            total = (total or 0) + val
    return total


def derive_other_revenue(
    total_revenue: int | None,
    contributions: int | None,
    program_revenue: int | None,
    investment_income: int | None,
) -> int | None:
    if total_revenue is None:
        return None
    return total_revenue - (contributions or 0) - (program_revenue or 0) - (investment_income or 0)


def build_raw_data(row: dict) -> dict:
    """Return a dict of all row fields not already promoted to named columns."""
    return {k: v for k, v in row.items() if k not in PROMOTED_FIELDS and v not in (None, "", ".")}


def extract_990_fields(row: dict) -> dict:
    """
    Extract all new research-grade fields from a full Form 990 row.
    Works for both space-delimited (.dat) and CSV formats — field names are
    the same across both; absent fields just return None.
    """
    return {
        # Headcount
        "num_employees":          parse_int(row.get("noemplyeesw3cnt")),
        "num_highly_compensated": parse_int(row.get("noindiv100kcnt")),
        "num_contractors_100k":   parse_int(row.get("nocontractor100kcnt")),
        # Compensation summary
        "comp_total_reported":    parse_int(row.get("totreprtabled")),
        "comp_related_orgs":      parse_int(row.get("totcomprelatede")),
        "comp_estimated_other":   parse_int(row.get("totestcompf")),
        # Part IX: compensation & payroll
        "comp_officers":          parse_int(row.get("compnsatncurrofcr")),
        "comp_disqualified":      parse_int(row.get("compnsatnandothr")),
        "comp_other_salaries":    parse_int(row.get("othrsalwages")),
        "pension_contributions":  parse_int(row.get("pensionplancontrb")),
        "employee_benefits":      parse_int(row.get("othremplyeebenef")),
        "payroll_taxes":          parse_int(row.get("payrolltx")),
        # Part IX: fees
        "management_fees":                parse_int(row.get("feesforsrvcmgmt")),
        "legal_fees":                     parse_int(row.get("legalfees")),
        "accounting_fees":                parse_int(row.get("accntingfees")),
        "professional_fundraising_fees":  parse_int(row.get("profndraising")),
        # Part IX: operating
        "occupancy":    parse_int(row.get("occupancy")),
        "travel":       parse_int(row.get("travel")),
        "it_expenses":  parse_int(row.get("infotech")),
        "depreciation": parse_int(row.get("deprcatndepletn")),
        "insurance":    parse_int(row.get("insurance")),
        # Part IX: grants
        "grants_to_govts":       parse_int(row.get("grntstogovt")),
        "grants_to_individuals": parse_int(row.get("grnsttoindiv")),   # IRS typo: grnst
        "grants_to_foreign":     parse_int(row.get("grntstofrgngovt")),
        # Part VIII: revenue components
        "royalties_income":        parse_int(row.get("royaltsinc")),
        "net_rental_income":       parse_int(row.get("netrntlinc")),
        "net_asset_sale_gains":    parse_int(row.get("netgnls")),
        "net_fundraising_income":  parse_int(row.get("netincfndrsng")),
        "net_gaming_income":       parse_int(row.get("netincgaming")),
        # Part X: balance sheet detail
        "pledges_receivable":          parse_int(row.get("pldgegrntrcvblend")),
        "accounts_payable":            parse_int(row.get("accntspayableend")),
        "tax_exempt_bonds_liability":  parse_int(row.get("txexmptbndsend")),
        "secured_mortgages":           parse_int(row.get("secrdmrtgsend")),
        "unsecured_notes":             parse_int(row.get("unsecurednotesend")),
        "investments_publicly_traded": parse_int(row.get("invstmntsend")),
        "investments_other":           parse_int(row.get("invstmntsothrend")),
        "investments_program_related": parse_int(row.get("invstmntsprgmend")),
        "temp_restricted_net_assets":  parse_int(row.get("temprstrctnetasstsend")),
        "perm_restricted_net_assets":  parse_int(row.get("permrstrctnetasstsend")),
        # Org classification
        "subsection_code": str(row.get("subseccd") or "").strip() or None,
        # Governance flags
        "has_lobbying":                  parse_bool(row.get("lbbyingactvtscd")),
        "has_political_activity":        parse_bool(row.get("politicalactvtscd")),
        "has_unrelated_business_income": parse_bool(row.get("unrelbusinccd")),
        "has_foreign_office":            parse_bool(row.get("frgnofficecd")),
        "has_foreign_grants":            parse_bool(row.get("frgngrntscd")),
        "operates_hospital":             parse_bool(row.get("operatehosptlcd")),
        "operates_school":               parse_bool(row.get("operateschools170cd")),
        "has_related_orgs":              parse_bool(row.get("reltdorgcd")),
    }


# ---------------------------------------------------------------------------
# Row normalisation
# ---------------------------------------------------------------------------


def normalise_space_delimited(row: dict, source_file: str) -> dict | None:
    """
    Normalise a row from a space-delimited file.
    Returns None if the row should be skipped.
    """
    elf = row.get("elf", "").strip().upper()
    if elf in ("P",):
        return None

    ein = fmt_ein(row.get("ein", ""))
    if ein is None:
        return None

    tax_period_raw = row.get("tax_prd") or row.get("tax_pd") or ""
    tax_period, fiscal_year = tax_period_to_date(tax_period_raw)
    if tax_period is None:
        return None

    total_revenue    = parse_int(row.get("totrevenue"))
    contributions    = parse_int(row.get("totcntrbgfts"))
    program_revenue  = parse_int(row.get("totprgmrevnue"))
    investment_income = parse_int(row.get("invstmntinc"))
    total_expenses   = parse_int(row.get("totfuncexpns"))
    total_assets     = parse_int(row.get("totassetsend"))
    total_liabilities = parse_int(row.get("totliabend"))
    total_net_assets = parse_int(row.get("totnetassetend"))

    program_expenses    = parse_int(row.get("totprgmrvnueexpns"))
    ga_expenses         = parse_int(row.get("totgeneralexpns"))
    fundraising_expenses = parse_int(row.get("totfundrsng"))

    cash_equiv   = parse_int(row.get("cashnonsaved") or row.get("nonintcashend"))
    st_investments = parse_int(row.get("svngstempinvst") or row.get("svngstempinvend"))
    lt_investments = sum_fields(row, "invstmntspublicly", "invstmntsothrsec")
    if lt_investments is None:
        lt_investments = sum_fields(row, "invstmntsend", "invstmntsothrend")
    ppe = parse_int(row.get("lndbldgsequip") or row.get("lndbldgsequipend"))
    unrestr_net_assets = parse_int(
        row.get("unrstrctdnetasstsend") or row.get("unrstrctnetasstsend")
    )
    restr_net_assets = sum_fields(row, "temprstrctdnetasstsend", "permrstrctdnetasstsend")
    if restr_net_assets is None:
        restr_net_assets = sum_fields(row, "temprstrctnetasstsend", "permrstrctnetasstsend")

    other_revenue = derive_other_revenue(total_revenue, contributions, program_revenue, investment_income)

    filing_method = elf if elf in ("E", "Y", "N") else None

    rec = {
        "ein": ein,
        "tax_period": tax_period,
        "fiscal_year": fiscal_year,
        "total_revenue": total_revenue,
        "total_expenses": total_expenses,
        "total_assets": total_assets,
        "total_liabilities": total_liabilities,
        "total_net_assets": total_net_assets,
        "contributions": contributions,
        "program_revenue": program_revenue,
        "investment_income": investment_income,
        "other_revenue": other_revenue,
        "program_expenses": program_expenses,
        "ga_expenses": ga_expenses,
        "fundraising_expenses": fundraising_expenses,
        "cash_equiv": cash_equiv,
        "st_investments": st_investments,
        "lt_investments": lt_investments,
        "ppe": ppe,
        "unrestr_net_assets": unrestr_net_assets,
        "restr_net_assets": restr_net_assets,
        "source_file": source_file,
        "filing_method": filing_method,
    }
    rec.update(extract_990_fields(row))
    rec["raw_data"] = build_raw_data(row)
    return rec


def normalise_csv(row: dict, source_file: str) -> dict | None:
    """
    Normalise a row from a CSV file (18eo–24eo).
    Returns None if the row should be skipped (not full Form 990).
    """
    elf = (row.get("elf") or row.get("efile") or "").strip().upper()
    if elf != "E":
        return None

    ein = fmt_ein(row.get("ein", ""))
    if ein is None:
        return None

    tax_period_raw = row.get("tax_pd", "")
    tax_period, fiscal_year = tax_period_to_date(tax_period_raw)
    if tax_period is None:
        return None

    total_revenue    = parse_int(row.get("totrevenue"))
    contributions    = parse_int(row.get("totcntrbgfts"))
    program_revenue  = parse_int(row.get("totprgmrevnue"))
    investment_income = parse_int(row.get("invstmntinc"))
    total_expenses   = parse_int(row.get("totfuncexpns"))
    total_assets     = parse_int(row.get("totassetsend"))
    total_liabilities = parse_int(row.get("totliabend"))
    total_net_assets = parse_int(row.get("totnetassetend"))

    program_expenses    = parse_int(row.get("totprgmrvnueexpns"))
    ga_expenses         = parse_int(row.get("totgeneralexpns"))
    fundraising_expenses = parse_int(row.get("totfundrsng"))

    cash_equiv     = parse_int(row.get("nonintcashend"))
    st_investments = parse_int(row.get("svngstempinvend"))
    lt_investments = sum_fields(row, "invstmntsend", "invstmntsothrend")
    ppe            = parse_int(row.get("lndbldgsequipend"))
    unrestr_net_assets = parse_int(row.get("unrstrctnetasstsend"))
    restr_net_assets   = sum_fields(row, "temprstrctnetasstsend", "permrstrctnetasstsend")

    other_revenue = derive_other_revenue(total_revenue, contributions, program_revenue, investment_income)

    rec = {
        "ein": ein,
        "tax_period": tax_period,
        "fiscal_year": fiscal_year,
        "total_revenue": total_revenue,
        "total_expenses": total_expenses,
        "total_assets": total_assets,
        "total_liabilities": total_liabilities,
        "total_net_assets": total_net_assets,
        "contributions": contributions,
        "program_revenue": program_revenue,
        "investment_income": investment_income,
        "other_revenue": other_revenue,
        "program_expenses": program_expenses,
        "ga_expenses": ga_expenses,
        "fundraising_expenses": fundraising_expenses,
        "cash_equiv": cash_equiv,
        "st_investments": st_investments,
        "lt_investments": lt_investments,
        "ppe": ppe,
        "unrestr_net_assets": unrestr_net_assets,
        "restr_net_assets": restr_net_assets,
        "source_file": source_file,
        "filing_method": elf,
    }
    rec.update(extract_990_fields(row))
    rec["raw_data"] = build_raw_data(row)
    return rec


def _ez_record(ein, tax_period, fiscal_year, row, source_file, filing_method=None) -> dict:
    """Build a normalised filing dict from 990-EZ fields."""
    total_revenue    = parse_int(row.get("totrevnue"))
    total_expenses   = parse_int(row.get("totexpns"))
    total_assets     = parse_int(row.get("totassetsend"))
    total_liabilities = parse_int(row.get("totliabend"))
    total_net_assets = parse_int(row.get("totnetassetsend") or row.get("networthend"))
    contributions    = parse_int(row.get("totcntrbs"))
    program_revenue  = parse_int(row.get("prgmservrev"))
    investment_income = parse_int(row.get("othrinvstinc"))
    other_revenue    = derive_other_revenue(total_revenue, contributions, program_revenue, investment_income)

    return {
        "ein": ein,
        "tax_period": tax_period,
        "fiscal_year": fiscal_year,
        "total_revenue": total_revenue,
        "total_expenses": total_expenses,
        "total_assets": total_assets,
        "total_liabilities": total_liabilities,
        "total_net_assets": total_net_assets,
        "contributions": contributions,
        "program_revenue": program_revenue,
        "investment_income": investment_income,
        "other_revenue": other_revenue,
        "program_expenses": None,
        "ga_expenses": None,
        "fundraising_expenses": None,
        "cash_equiv": None,
        "st_investments": None,
        "lt_investments": None,
        "ppe": None,
        "unrestr_net_assets": None,
        "restr_net_assets": None,
        "source_file": source_file,
        "form_type": "990EZ",
        "filing_method": filing_method,
        # EZ has limited new fields
        "subsection_code": str(row.get("subseccd") or "").strip() or None,
        "has_unrelated_business_income": parse_bool(row.get("unrelbusincd") or row.get("unrelbusinccd")),
        "net_fundraising_income": parse_int(row.get("netincfndrsng")),
        "num_employees": None, "num_highly_compensated": None, "num_contractors_100k": None,
        "comp_total_reported": None, "comp_related_orgs": None, "comp_estimated_other": None,
        "comp_officers": None, "comp_disqualified": None, "comp_other_salaries": None,
        "pension_contributions": None, "employee_benefits": None, "payroll_taxes": None,
        "management_fees": None, "legal_fees": None, "accounting_fees": None,
        "professional_fundraising_fees": None, "occupancy": None, "travel": None,
        "it_expenses": None, "depreciation": None, "insurance": None,
        "grants_to_govts": None, "grants_to_individuals": None, "grants_to_foreign": None,
        "royalties_income": None, "net_rental_income": None, "net_asset_sale_gains": None,
        "net_gaming_income": None,
        "pledges_receivable": None, "accounts_payable": None, "tax_exempt_bonds_liability": None,
        "secured_mortgages": None, "unsecured_notes": None,
        "investments_publicly_traded": None, "investments_other": None,
        "investments_program_related": None,
        "temp_restricted_net_assets": None, "perm_restricted_net_assets": None,
        "has_lobbying": None, "has_political_activity": None,
        "has_foreign_office": None, "has_foreign_grants": None,
        "operates_hospital": None, "operates_school": None, "has_related_orgs": None,
        "raw_data": build_raw_data(row),
    }


def normalise_ez_space_delimited(row: dict, source_file: str) -> dict | None:
    elf = row.get("elf", "").strip().upper()
    if elf in ("P",):
        return None

    ein = fmt_ein(row.get("ein", ""))
    if ein is None:
        return None

    tax_period_raw = (
        row.get("a_tax_prd") or row.get("tax_prd") or row.get("tax_pd")
        or row.get("taxprd") or row.get("taxpd") or ""
    )
    tax_period, fiscal_year = tax_period_to_date(tax_period_raw)
    if tax_period is None:
        return None

    return _ez_record(ein, tax_period, fiscal_year, row, source_file, filing_method=elf or None)


def normalise_ez_csv(row: dict, source_file: str) -> dict | None:
    elf = (row.get("efile") or row.get("e-file") or row.get("elf") or "").strip().upper()
    if elf != "E":
        return None

    ein = fmt_ein(row.get("ein", ""))
    if ein is None:
        return None

    tax_period_raw = row.get("taxpd") or row.get("tax_pd") or ""
    tax_period, fiscal_year = tax_period_to_date(tax_period_raw)
    if tax_period is None:
        return None

    return _ez_record(ein, tax_period, fiscal_year, row, source_file, filing_method=elf)


def _pf_record(ein, tax_period, fiscal_year, row, source_file) -> dict:
    """Build a normalised filing dict from 990-PF fields."""
    total_revenue    = parse_int(row.get("totrcptperbks"))
    total_expenses   = parse_int(row.get("totexpnspbks"))
    total_assets     = parse_int(row.get("totassetsend"))
    total_liabilities = parse_int(row.get("totliabend"))
    total_net_assets = parse_int(row.get("tfundnworth"))
    contributions    = parse_int(row.get("grscontrgifts"))
    investment_income = parse_int(row.get("netinvstinc"))
    other_revenue    = derive_other_revenue(total_revenue, contributions, None, investment_income)
    ga_expenses      = parse_int(row.get("topradmnexpnsa"))
    cash_equiv       = parse_int(row.get("othrcashamt"))
    lt_investments   = parse_int(row.get("totinvstsec"))
    if lt_investments is None:
        lt_investments = sum_fields(row, "invstcorpstk", "invstcorpbnd", "invstgovtoblig")

    return {
        "ein": ein,
        "tax_period": tax_period,
        "fiscal_year": fiscal_year,
        "total_revenue": total_revenue,
        "total_expenses": total_expenses,
        "total_assets": total_assets,
        "total_liabilities": total_liabilities,
        "total_net_assets": total_net_assets,
        "contributions": contributions,
        "program_revenue": None,
        "investment_income": investment_income,
        "other_revenue": other_revenue,
        "program_expenses": None,
        "ga_expenses": ga_expenses,
        "fundraising_expenses": None,
        "cash_equiv": cash_equiv,
        "st_investments": None,
        "lt_investments": lt_investments,
        "ppe": None,
        "unrestr_net_assets": None,
        "restr_net_assets": None,
        "source_file": source_file,
        "form_type": "990PF",
        "filing_method": None,
        "subsection_code": str(row.get("subseccd") or "").strip() or None,
        # PF doesn't have the standard governance flags or Part IX detail
        "num_employees": None, "num_highly_compensated": None, "num_contractors_100k": None,
        "comp_total_reported": None, "comp_related_orgs": None, "comp_estimated_other": None,
        "comp_officers": None, "comp_disqualified": None, "comp_other_salaries": None,
        "pension_contributions": None, "employee_benefits": None, "payroll_taxes": None,
        "management_fees": None, "legal_fees": None, "accounting_fees": None,
        "professional_fundraising_fees": None, "occupancy": None, "travel": None,
        "it_expenses": None, "depreciation": None, "insurance": None,
        "grants_to_govts": None, "grants_to_individuals": None, "grants_to_foreign": None,
        "royalties_income": None, "net_rental_income": None, "net_asset_sale_gains": None,
        "net_fundraising_income": None, "net_gaming_income": None,
        "pledges_receivable": None, "accounts_payable": None, "tax_exempt_bonds_liability": None,
        "secured_mortgages": None, "unsecured_notes": None,
        "investments_publicly_traded": None, "investments_other": None,
        "investments_program_related": None,
        "temp_restricted_net_assets": None, "perm_restricted_net_assets": None,
        "has_lobbying": None, "has_political_activity": None, "has_unrelated_business_income": None,
        "has_foreign_office": None, "has_foreign_grants": None,
        "operates_hospital": None, "operates_school": None, "has_related_orgs": None,
        "raw_data": build_raw_data(row),
    }


def normalise_pf_space_delimited(row: dict, source_file: str) -> dict | None:
    ein = fmt_ein(row.get("ein", ""))
    if ein is None:
        return None
    tax_period_raw = row.get("tax_prd") or row.get("tax_pd") or ""
    tax_period, fiscal_year = tax_period_to_date(tax_period_raw)
    if tax_period is None:
        return None
    return _pf_record(ein, tax_period, fiscal_year, row, source_file)


def normalise_pf_csv(row: dict, source_file: str) -> dict | None:
    ein = fmt_ein(row.get("ein", ""))
    if ein is None:
        return None
    tax_period_raw = row.get("tax_prd") or row.get("tax_pd") or ""
    tax_period, fiscal_year = tax_period_to_date(tax_period_raw)
    if tax_period is None:
        return None
    return _pf_record(ein, tax_period, fiscal_year, row, source_file)


# ---------------------------------------------------------------------------
# File reading
# ---------------------------------------------------------------------------


def is_space_delimited(filename: str) -> bool:
    return filename in SPACE_DELIM_PATTERNS


def is_space_delimited_ez(filename: str) -> bool:
    return filename in SPACE_DELIM_EZ_PATTERNS


def is_space_delimited_pf(filename: str) -> bool:
    return filename in SPACE_DELIM_PF_PATTERNS


def _normalise_row(row: dict) -> dict:
    return {k.lower().strip().lstrip("﻿"): v for k, v in row.items()}


def read_space_delimited(filepath: Path) -> list[dict]:
    rows = []
    with open(filepath, encoding="utf-8", errors="replace") as fh:
        reader = csv.DictReader(fh, delimiter=" ")
        for row in reader:
            rows.append(_normalise_row(row))
    return rows


def read_csv(filepath: Path) -> list[dict]:
    rows = []
    with open(filepath, encoding="utf-8-sig", errors="replace") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            rows.append(_normalise_row(row))
    return rows


# ---------------------------------------------------------------------------
# Database upsert
# ---------------------------------------------------------------------------

# All columns in the filings table (in order)
FILING_COLS = [
    "ein", "tax_period", "fiscal_year",
    "total_revenue", "total_expenses", "total_assets", "total_liabilities", "total_net_assets",
    "contributions", "program_revenue", "investment_income", "other_revenue",
    "program_expenses", "ga_expenses", "fundraising_expenses",
    "cash_equiv", "st_investments", "lt_investments", "ppe",
    "unrestr_net_assets", "restr_net_assets",
    "source_file", "form_type",
    # new columns
    "num_employees", "num_highly_compensated", "num_contractors_100k",
    "comp_total_reported", "comp_related_orgs", "comp_estimated_other",
    "comp_officers", "comp_disqualified", "comp_other_salaries",
    "pension_contributions", "employee_benefits", "payroll_taxes",
    "management_fees", "legal_fees", "accounting_fees", "professional_fundraising_fees",
    "occupancy", "travel", "it_expenses", "depreciation", "insurance",
    "grants_to_govts", "grants_to_individuals", "grants_to_foreign",
    "royalties_income", "net_rental_income", "net_asset_sale_gains",
    "net_fundraising_income", "net_gaming_income",
    "pledges_receivable", "accounts_payable", "tax_exempt_bonds_liability",
    "secured_mortgages", "unsecured_notes",
    "investments_publicly_traded", "investments_other", "investments_program_related",
    "temp_restricted_net_assets", "perm_restricted_net_assets",
    "subsection_code", "filing_method",
    "has_lobbying", "has_political_activity", "has_unrelated_business_income",
    "has_foreign_office", "has_foreign_grants", "operates_hospital",
    "operates_school", "has_related_orgs",
]

_update_cols = [c for c in FILING_COLS if c not in ("ein", "tax_period")]
_col_list    = ", ".join(FILING_COLS)
_val_placeholders = ", ".join(["%s"] * len(FILING_COLS))
_update_set  = ", ".join(f"{c} = EXCLUDED.{c}" for c in _update_cols)

UPSERT_FILING_SQL = f"""
INSERT INTO filings ({_col_list})
VALUES %s
ON CONFLICT (ein, tax_period) DO UPDATE SET
    {_update_set}
"""

UPSERT_RAW_SQL = """
INSERT INTO filings_raw (ein, tax_period, form_type, source_file, raw_data)
VALUES %s
ON CONFLICT (ein, tax_period) DO UPDATE SET
    form_type   = EXCLUDED.form_type,
    source_file = EXCLUDED.source_file,
    raw_data    = EXCLUDED.raw_data
"""


def upsert_filings(conn, records: list[dict], dry_run: bool) -> int:
    if not records or dry_run:
        return len(records)
    # back-fill defaults
    for r in records:
        r.setdefault("form_type", "990")
        for col in FILING_COLS:
            r.setdefault(col, None)

    with conn.cursor() as cur:
        row_tuples = [tuple(r[c] for c in FILING_COLS) for r in records]
        psycopg2.extras.execute_values(cur, UPSERT_FILING_SQL, row_tuples, page_size=len(records))
    conn.commit()
    return len(records)


def upsert_raw(conn, records: list[dict], dry_run: bool) -> int:
    if not records or dry_run:
        return len(records)
    row_tuples = [
        (
            r["ein"],
            r["tax_period"],
            r.get("form_type", "990"),
            r.get("source_file"),
            json.dumps(r.get("raw_data") or {}),
        )
        for r in records
    ]
    with conn.cursor() as cur:
        psycopg2.extras.execute_values(cur, UPSERT_RAW_SQL, row_tuples, page_size=len(row_tuples))
    conn.commit()
    return len(row_tuples)


# ---------------------------------------------------------------------------
# EO BMF ingestion
# ---------------------------------------------------------------------------

UPSERT_ORG_SQL = """
INSERT INTO organizations (ein, name, state, ntee_code, sector, subseccd)
VALUES %s
ON CONFLICT (ein) DO UPDATE SET
    name      = EXCLUDED.name,
    state     = EXCLUDED.state,
    ntee_code = EXCLUDED.ntee_code,
    sector    = EXCLUDED.sector,
    subseccd  = EXCLUDED.subseccd
"""


def decode_sector(ntee_code: str | None) -> str:
    if not ntee_code:
        return "Unknown"
    first = ntee_code.strip().upper()[:1]
    return NTEE_SECTOR_MAP.get(first, "Unknown")


def ingest_eobmf(filepath: str | Path, conn, dry_run: bool = False, database_url: str | None = None) -> None:
    filepath = Path(filepath)
    print(f"\n[EO BMF] Reading {filepath.name} ...")

    records = []
    skipped = 0

    with open(filepath, encoding="utf-8-sig", errors="replace") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames:
            reader.fieldnames = [f.lower().strip() for f in reader.fieldnames]

        for raw in reader:
            row = {k.lower().strip(): v for k, v in raw.items()}
            ein = fmt_ein(row.get("ein", ""))
            if ein is None:
                skipped += 1
                continue
            name = str(row.get("name", "") or "").strip()
            if not name:
                name = str(row.get("organization_name", "") or "").strip()
            state     = str(row.get("state", "") or row.get("st", "") or "").strip() or None
            ntee_code = str(row.get("ntee_cd", "") or row.get("nteecc", "") or "").strip() or None
            sector    = decode_sector(ntee_code)
            subseccd  = parse_int(row.get("subseccd"))
            records.append({"ein": ein, "name": name, "state": state,
                            "ntee_code": ntee_code, "sector": sector, "subseccd": subseccd})

    print(f"[EO BMF] Read {len(records) + skipped} rows — {skipped} skipped (bad EIN)")

    if dry_run:
        print(f"[EO BMF] DRY RUN — would upsert {len(records)} organizations")
        return

    batch_size = 5000
    total_upserted = 0
    i = 0
    while i < len(records):
        batch = records[i: i + batch_size]
        row_tuples = [(r["ein"], r["name"], r["state"], r["ntee_code"], r["sector"], r["subseccd"]) for r in batch]
        try:
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(cur, UPSERT_ORG_SQL, row_tuples, page_size=batch_size)
            conn.commit()
            total_upserted += len(batch)
            i += len(batch)
            print(f"[EO BMF] {total_upserted}/{len(records)} upserted ...", flush=True)
        except psycopg2.OperationalError as e:
            print(f"[EO BMF] Connection error at {total_upserted}: {e} — reconnecting ...", flush=True)
            try:
                conn.close()
            except Exception:
                pass
            if database_url:
                conn = psycopg2.connect(database_url)
            else:
                raise

    print(f"[EO BMF] Upserted {total_upserted} organizations")


# ---------------------------------------------------------------------------
# Per-file ingestion
# ---------------------------------------------------------------------------


def ingest_file(filepath: Path, conn, dry_run: bool, database_url: str | None = None) -> None:
    filename = filepath.name
    print(f"\n[{filename}] Reading ...", flush=True)

    space_delim    = is_space_delimited(filename)
    space_delim_ez = is_space_delimited_ez(filename)
    space_delim_pf = is_space_delimited_pf(filename)
    ez_csv         = is_ez_csv(filename)
    pf_csv         = is_pf_csv(filename)

    if space_delim or space_delim_ez or space_delim_pf:
        raw_rows = read_space_delimited(filepath)
    else:
        raw_rows = read_csv(filepath)

    print(f"[{filename}] {len(raw_rows)} rows read", flush=True)

    dedup: dict[tuple, dict] = {}
    skipped = 0

    for raw in raw_rows:
        if space_delim:
            rec = normalise_space_delimited(raw, filename)
        elif space_delim_ez:
            rec = normalise_ez_space_delimited(raw, filename)
        elif space_delim_pf:
            rec = normalise_pf_space_delimited(raw, filename)
        elif ez_csv:
            rec = normalise_ez_csv(raw, filename)
        elif pf_csv:
            rec = normalise_pf_csv(raw, filename)
        else:
            rec = normalise_csv(raw, filename)

        if rec is None:
            skipped += 1
            continue

        key = (rec["ein"], rec["tax_period"])
        dedup[key] = rec

    records = list(dedup.values())
    print(
        f"[{filename}] {len(records)} records to upsert, {skipped} skipped",
        flush=True,
    )

    if not records:
        return

    if dry_run:
        print(f"[{filename}] DRY RUN — would upsert {len(records)} records")
        return

    # back-fill form_type
    for r in records:
        r.setdefault("form_type", "990")

    batch_size = 1000
    total_upserted = 0
    i = 0

    while i < len(records):
        batch = records[i: i + batch_size]
        try:
            upsert_filings(conn, batch, dry_run=False)
            upsert_raw(conn, batch, dry_run=False)
            total_upserted += len(batch)
            i += len(batch)
            print(f"[{filename}] {total_upserted}/{len(records)} upserted ...", flush=True)
        except psycopg2.OperationalError as e:
            print(f"[{filename}] Connection error at {total_upserted}: {e} — reconnecting ...", flush=True)
            try:
                conn.close()
            except Exception:
                pass
            if database_url:
                conn = psycopg2.connect(database_url)
            else:
                raise

    print(f"[{filename}] Done: {total_upserted} records upserted", flush=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def _file_sort_key(f: Path) -> int:
    name = f.name
    if name.startswith("py") and name[2:4].isdigit():
        return int(name[2:4])
    if name[:2].isdigit():
        return int(name[:2])
    return 99


def discover_files(data_dir: Path) -> list[Path]:
    result = []
    for f in data_dir.iterdir():
        name = f.name
        if name in SPACE_DELIM_PATTERNS or name in SPACE_DELIM_EZ_PATTERNS or name in SPACE_DELIM_PF_PATTERNS:
            result.append(f)
        elif name.endswith(CSV_PATTERNS_PREFIX) and name[:2].isdigit():
            result.append(f)
        elif is_ez_csv(name) or is_pf_csv(name):
            result.append(f)
    return sorted(result, key=_file_sort_key)


def main() -> None:
    load_dotenv()
    load_dotenv(Path(__file__).parent.parent / "apps/web/.env.local", override=True)

    parser = argparse.ArgumentParser(description="Ingest IRS SOI 990 data into Postgres")
    parser.add_argument("--data-dir", default="../docs/990_data/file_data")
    parser.add_argument("--eobmf", default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--files", nargs="+", metavar="FILE", default=None)
    args = parser.parse_args()

    data_dir = Path(args.data_dir).expanduser().resolve()
    if not data_dir.is_dir():
        print(f"ERROR: data directory not found: {data_dir}", file=sys.stderr)
        sys.exit(1)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url and not args.dry_run:
        print("ERROR: DATABASE_URL not set.", file=sys.stderr)
        sys.exit(1)

    conn = None
    if not args.dry_run:
        print("Connecting to database ...")
        conn = psycopg2.connect(database_url)
        print("Connected.")

    if args.eobmf:
        eobmf_path = Path(args.eobmf).expanduser().resolve()
        if not eobmf_path.is_file():
            print(f"ERROR: EO BMF file not found: {eobmf_path}", file=sys.stderr)
            sys.exit(1)
        ingest_eobmf(eobmf_path, conn, dry_run=args.dry_run, database_url=database_url)

    if args.files:
        files = []
        for name in args.files:
            p = data_dir / name
            if not p.is_file():
                print(f"ERROR: file not found: {p}", file=sys.stderr)
                sys.exit(1)
            files.append(p)
    else:
        files = discover_files(data_dir)

    if not files:
        print(f"No recognised source files found in {data_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"\nFound {len(files)} source files in {data_dir}")
    for f in files:
        print(f"  {f.name}")

    for filepath in files:
        ingest_file(filepath, conn, dry_run=args.dry_run, database_url=database_url)

    if conn:
        conn.close()

    print("\nDone.")


if __name__ == "__main__":
    main()
