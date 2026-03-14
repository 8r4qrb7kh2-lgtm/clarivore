"""Build a safe ingredient catalog from SmartLabel product ground truth.

The source CSV is expected to contain one row per SmartLabel scrape result with:
- parsed ingredient items
- explicit allergens declared/present/may-contain JSON fields

This builder does not infer allergens from ingredient text. It emits a
surface-preserving ingredient lexicon from SmartLabel rows whose allergen fields
are explicitly empty.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

DEFAULT_INPUT = Path("full_smartlabel_ground_truth copy.csv")
DEFAULT_OUTPUT = Path("ml/seeds/ingredient_catalog_seed.jsonl")
DEFAULT_SUMMARY = Path("ml/seeds/ingredient_catalog_seed_summary.json")
DEFAULT_MIN_SUPPORT = 1
SEED_SOURCE = "smartlabel_ground_truth_safe_v1"
EXTRACTION_VERSION = "smartlabel_safe_v1"
MAX_SURFACE_FORMS = 12
MAX_SUPPORTING_PRODUCTS = 12

HEADER_PATTERNS = [
    re.compile(r"^contains\b", re.IGNORECASE),
    re.compile(r"^less than\b", re.IGNORECASE),
    re.compile(r"^containing one or more\b", re.IGNORECASE),
    re.compile(r"^\(the following added to promote color retention\)$", re.IGNORECASE),
    re.compile(r"^and/?or\b", re.IGNORECASE),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a safe ingredient catalog from SmartLabel.")
    parser.add_argument(
        "--input",
        default=str(DEFAULT_INPUT),
        help="Path to the SmartLabel ground truth CSV.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Path to write the ingredient catalog seed JSONL.",
    )
    parser.add_argument(
        "--summary-output",
        default=str(DEFAULT_SUMMARY),
        help="Path to write the build summary JSON.",
    )
    parser.add_argument(
        "--min-support",
        type=int,
        default=DEFAULT_MIN_SUPPORT,
        help="Minimum number of distinct safe products required per ingredient.",
    )
    return parser.parse_args()


def as_text(value: Any) -> str:
    return str(value or "").strip()


def ascii_text(value: Any) -> str:
    return unicodedata.normalize("NFKD", as_text(value)).encode("ascii", "ignore").decode("ascii")


def normalize_spaces(value: Any) -> str:
    return re.sub(r"\s+", " ", as_text(value)).strip()


def normalize_lookup_term(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", ascii_text(value).lower()).strip()


def parse_json_field(value: Any, default: Any) -> Any:
    text = as_text(value)
    if not text:
        return default
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return default


def dedupe_strings(values: list[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = normalize_spaces(value)
        if not text or text in seen:
            continue
        seen.add(text)
        output.append(text)
    return output


def is_structural_header(text: str) -> bool:
    if not text:
        return True
    if text.endswith(":"):
        return True
    return any(pattern.search(text) for pattern in HEADER_PATTERNS)


def normalize_surface_name(value: Any) -> str:
    base = ascii_text(value)
    base = base.replace("*", " ")
    base = normalize_spaces(base)
    if not base or is_structural_header(base):
        return ""
    return base


def best_row_score(row: dict[str, Any]) -> tuple[int, ...]:
    items = parse_json_field(row.get("ingredients_items_json"), [])
    declared = parse_json_field(row.get("allergens_declared_json"), [])
    present = parse_json_field(row.get("allergens_present_json"), [])
    may = parse_json_field(row.get("allergens_may_contain_json"), [])

    return (
        1 if items else 0,
        len(items),
        1 if (declared or present or may) else 0,
        len(declared) + len(present) + len(may),
        1 if as_text(row.get("ingredients_http_status")) == "200" else 0,
        1 if as_text(row.get("allergens_http_status")) == "200" else 0,
        int(as_text(row.get("rev")) or 0),
        -len(as_text(row.get("smartlabel_error"))),
        int(as_text(row.get("smartlabel_id")) or 0),
    )


def select_best_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    best_by_upc: dict[str, dict[str, Any]] = {}
    for row in rows:
        upc = as_text(row.get("smartlabel_upc"))
        if not upc:
            continue
        current = best_by_upc.get(upc)
        if current is None or best_row_score(row) > best_row_score(current):
            best_by_upc[upc] = row
    return best_by_upc


def is_safe_product(row: dict[str, Any]) -> bool:
    if as_text(row.get("allergens_http_status")) != "200":
        return False

    ingredients = parse_json_field(row.get("ingredients_items_json"), [])
    if not ingredients:
        return False

    declared = parse_json_field(row.get("allergens_declared_json"), [])
    present = parse_json_field(row.get("allergens_present_json"), [])
    may_contain = parse_json_field(row.get("allergens_may_contain_json"), [])
    return not declared and not present and not may_contain


def load_rows(input_path: Path) -> list[dict[str, Any]]:
    with input_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return list(reader)


def build_seed_rows(rows: list[dict[str, Any]], best_rows: dict[str, dict[str, Any]], min_support: int, input_path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    product_stats = Counter()
    ingredient_support: dict[str, set[str]] = defaultdict(set)
    surface_form_counts: dict[str, Counter[str]] = defaultdict(Counter)
    supporting_products: dict[str, list[dict[str, str]]] = defaultdict(list)

    for row in rows:
        if not is_safe_product(row):
            if parse_json_field(row.get("ingredients_items_json"), []):
                product_stats["unsafe_or_unknown_with_items"] += 1
            else:
                product_stats["skipped_without_items"] += 1
            continue

        product_stats["safe_rows"] += 1
        source_id = as_text(row.get("smartlabel_upc")) or as_text(row.get("smartlabel_url")) or as_text(row.get("smartlabel_id"))
        seen_in_row: set[str] = set()
        raw_items = parse_json_field(row.get("ingredients_items_json"), [])
        for item in raw_items:
            raw_text = normalize_spaces(item)
            normalized_name = normalize_surface_name(raw_text)
            if not normalized_name:
                product_stats["structural_items_filtered"] += 1
                continue
            if normalized_name in seen_in_row:
                continue
            seen_in_row.add(normalized_name)
            ingredient_support[normalized_name].add(source_id)
            if raw_text:
                surface_form_counts[normalized_name][raw_text] += 1
            supporting_products[normalized_name].append(
                {
                    "upc": as_text(row.get("smartlabel_upc")),
                    "smartlabel_id": as_text(row.get("smartlabel_id")),
                    "smartlabel_url": as_text(row.get("smartlabel_url")),
                    "ingredients_url": as_text(row.get("smartlabel_url_ingredients")),
                    "allergens_url": as_text(row.get("smartlabel_url_allergens")),
                }
            )

    seed_rows: list[dict[str, Any]] = []
    support_counter = Counter({name: len(upcs) for name, upcs in ingredient_support.items()})

    for normalized_name, support_count in sorted(
        support_counter.items(),
        key=lambda item: (-item[1], item[0]),
    ):
        if support_count < min_support:
            continue

        top_surface_forms = [
            {"name": name, "count": count}
            for name, count in surface_form_counts[normalized_name].most_common(MAX_SURFACE_FORMS)
        ]
        aliases = dedupe_strings([entry["name"] for entry in top_surface_forms])
        lookup_terms = dedupe_strings([normalize_lookup_term(normalized_name), *[normalize_lookup_term(alias) for alias in aliases]])
        seed_rows.append(
            {
                "canonical_name": aliases[0] if aliases else normalized_name,
                "normalized_name": normalized_name,
                "aliases": aliases,
                "lookup_terms": lookup_terms or [normalize_lookup_term(normalized_name)],
                "lookup_count": support_count,
                "allergens": [],
                "diets": [],
                "is_ready": True,
                "seed_source": SEED_SOURCE,
                "metadata": {
                    "source": "smartlabel",
                    "catalog_type": "safe_only",
                    "supported_diets": [],
                    "extraction_version": f"{EXTRACTION_VERSION}_surface_rows_v2",
                    "safe_basis": "explicit_empty_smartlabel_allergen_fields",
                    "input_file": str(input_path),
                    "min_support": min_support,
                    "source_product_count": support_count,
                    "surface_forms": top_surface_forms,
                    "supporting_products": supporting_products[normalized_name][:MAX_SUPPORTING_PRODUCTS],
                },
            }
        )

    summary = {
        "input_file": str(input_path),
        "seed_source": SEED_SOURCE,
        "extraction_version": f"{EXTRACTION_VERSION}_surface_rows_v2",
        "min_support": min_support,
        "total_input_rows": len(rows),
        "unique_products": len(best_rows),
        "safe_products_used": product_stats["safe_rows"],
        "products_skipped_without_items": product_stats["skipped_without_items"],
        "products_skipped_unsafe_or_unknown_with_items": product_stats["unsafe_or_unknown_with_items"],
        "structural_items_filtered": product_stats["structural_items_filtered"],
        "unique_safe_ingredients_before_support_filter": len(support_counter),
        "unique_safe_ingredients_after_support_filter": len(seed_rows),
        "top_entries": [
            {
                "normalized_name": row["normalized_name"],
                "lookup_count": row["lookup_count"],
            }
            for row in seed_rows[:25]
        ],
    }
    return seed_rows, summary


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=True, sort_keys=True))
            handle.write("\n")


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=True, indent=2, sort_keys=True)
        handle.write("\n")


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    summary_path = Path(args.summary_output).resolve()

    if args.min_support < 1:
        raise SystemExit("--min-support must be at least 1.")
    if not input_path.exists():
        raise SystemExit(f"Input CSV not found: {input_path}")

    rows = load_rows(input_path)
    best_rows = select_best_rows(rows)
    seed_rows, summary = build_seed_rows(rows, best_rows, args.min_support, input_path)

    write_jsonl(output_path, seed_rows)
    write_json(summary_path, summary)

    print(f"SmartLabel safe catalog build complete: {len(seed_rows)} rows")
    print(f"Seed written to: {output_path}")
    print(f"Summary written to: {summary_path}")


if __name__ == "__main__":
    main()
