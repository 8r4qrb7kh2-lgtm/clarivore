#!/usr/bin/env python3
"""Download and parse USDA FDC branded CSV data for Clarivore training/validation."""

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Set, Tuple


DEFAULT_DOWNLOAD_URL = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_branded_food_csv_2025-04-24.zip"


def as_text(value: object) -> str:
    return str(value or "").strip()


def stable_unique(values: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen: Set[str] = set()
    for value in values:
        safe = as_text(value)
        if not safe or safe in seen:
            continue
        seen.add(safe)
        out.append(safe)
    return out


TOKEN_TO_ALLERGEN: Dict[str, str] = {
    "milk": "milk",
    "dairy": "milk",
    "egg": "egg",
    "eggs": "egg",
    "peanut": "peanut",
    "peanuts": "peanut",
    "tree nut": "tree nut",
    "tree nuts": "tree nut",
    "nut": "tree nut",
    "nuts": "tree nut",
    "almond": "tree nut",
    "almonds": "tree nut",
    "cashew": "tree nut",
    "cashews": "tree nut",
    "walnut": "tree nut",
    "walnuts": "tree nut",
    "pecan": "tree nut",
    "pecans": "tree nut",
    "hazelnut": "tree nut",
    "hazelnuts": "tree nut",
    "pistachio": "tree nut",
    "pistachios": "tree nut",
    "macadamia": "tree nut",
    "coconut": "tree nut",
    "coconuts": "tree nut",
    "coconut milk": "tree nut",
    "coconut cream": "tree nut",
    "brazil nut": "tree nut",
    "brazil nuts": "tree nut",
    "fish": "fish",
    "anchovy": "fish",
    "anchovies": "fish",
    "cod": "fish",
    "salmon": "fish",
    "tuna": "fish",
    "shellfish": "shellfish",
    "crustacean": "shellfish",
    "crustaceans": "shellfish",
    "mollusk": "shellfish",
    "mollusks": "shellfish",
    "mollusc": "shellfish",
    "molluscs": "shellfish",
    "shrimp": "shellfish",
    "crab": "shellfish",
    "lobster": "shellfish",
    "soy": "soy",
    "soybean": "soy",
    "soybeans": "soy",
    "sesame": "sesame",
    "sesame seed": "sesame",
    "sesame seeds": "sesame",
    "wheat": "wheat",
    "gluten": "wheat",
}

ALLERGEN_CANONICAL = [
    "milk",
    "egg",
    "peanut",
    "tree nut",
    "shellfish",
    "fish",
    "soy",
    "sesame",
    "wheat",
]

CONTAINS_PATTERNS = [
    re.compile(r"\bcontains\b\s*[:\-]?\s*([^.;\n]+)", re.IGNORECASE),
    re.compile(r"\bmay contain\b\s*[:\-]?\s*([^.;\n]+)", re.IGNORECASE),
    re.compile(r"\bcontains one or more of the following\b\s*[:\-]?\s*([^.;\n]+)", re.IGNORECASE),
    re.compile(r"\bprocessed in a facility(?: that)? (?:also )?(?:processes|handles)\b\s*[:\-]?\s*([^.;\n]+)", re.IGNORECASE),
    re.compile(r"\bmanufactured on shared equipment with\b\s*[:\-]?\s*([^.;\n]+)", re.IGNORECASE),
]

NORM_RE = re.compile(r"[^a-z0-9 ]+")
SPACE_RE = re.compile(r"\s+")
BAD_PUNCT_SPACE_RE = re.compile(r"\s+([,;:.])")
EMPTY_PUNCT_RE = re.compile(r"([,;:.])\s*([,;:.])+")
TRAILING_DISCLOSURE_RE = re.compile(
    r"(?:[,\s]*\b(?:may contain|contains one or more of the following|contains|processed in a facility(?: that)? (?:also )?(?:processes|handles)|manufactured on shared equipment with)\b\s*[:\-]?\s*)+$",
    re.IGNORECASE,
)

PLANT_MILK_BASES = sorted(
    {
        "almond",
        "cashew",
        "coconut",
        "hazelnut",
        "hemp",
        "macadamia",
        "oat",
        "pea",
        "pecan",
        "pistachio",
        "quinoa",
        "rice",
        "soy",
        "walnut",
    },
    key=len,
    reverse=True,
)
PLANT_MILK_RE = re.compile(
    r"\b(" + "|".join(re.escape(value) for value in PLANT_MILK_BASES) + r")\s+milk\b",
    re.IGNORECASE,
)
TOKEN_MATCHERS: List[Tuple[re.Pattern[str], str]] = [
    (re.compile(rf"\b{re.escape(key)}\b", re.IGNORECASE), allergen)
    for key, allergen in sorted(TOKEN_TO_ALLERGEN.items(), key=lambda item: len(item[0]), reverse=True)
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download and parse USDA branded food CSV at scale.")
    parser.add_argument("--download-url", default=DEFAULT_DOWNLOAD_URL)
    parser.add_argument("--download-path", default="ml/data/raw/usda_fdc_branded_food_csv.zip")
    parser.add_argument("--train-output", default="ml/data/processed/usda_fdc_bulk_train_examples.jsonl")
    parser.add_argument("--holdout-output", default="ml/data/processed/usda_fdc_bulk_holdout_examples.jsonl")
    parser.add_argument("--summary-output", default="ml/data/processed/usda_fdc_bulk_summary.json")
    parser.add_argument("--holdout-ratio", type=float, default=0.15, help="Deterministic holdout split ratio (0..0.9).")
    parser.add_argument("--max-rows", type=int, default=0, help="Limit rows processed from branded_food.csv (0 = all).")
    parser.add_argument("--min-text-len", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--force-download", action="store_true", help="Redownload even if --download-path exists.")
    parser.add_argument(
        "--include-unlabeled",
        action="store_true",
        help="Include rows with no extracted allergen labels.",
    )
    parser.add_argument(
        "--require-contains",
        action="store_true",
        help="Require an explicit contains/may-contain segment in text.",
    )
    return parser.parse_args()


def normalize_token(value: str) -> str:
    safe = NORM_RE.sub(" ", as_text(value).lower()).strip()
    # Keep plant-milk compounds from matching dairy milk.
    safe = PLANT_MILK_RE.sub(lambda match: f"{match.group(1).lower()} plantmilk", safe)
    safe = re.sub(r"\s+", " ", safe)
    return safe


def map_segment_to_allergens(segment: str) -> List[str]:
    cleaned = normalize_token(segment)
    if not cleaned:
        return []

    mapped: List[str] = []
    for pattern, allergen in TOKEN_MATCHERS:
        if pattern.search(cleaned):
            mapped.append(allergen)
    return stable_unique(mapped)


def extract_allergens_from_ingredients(text: str) -> Dict[str, object]:
    safe_text = as_text(text)
    segments: List[str] = []
    labels: List[str] = []
    spans: List[Tuple[int, int]] = []

    for pattern in CONTAINS_PATTERNS:
        for match in pattern.finditer(safe_text):
            segment = as_text(match.group(1))
            if not segment:
                continue
            segments.append(segment)
            labels.extend(map_segment_to_allergens(segment))
            spans.append((int(match.start()), int(match.end())))

    labels = [label for label in stable_unique(labels) if label in ALLERGEN_CANONICAL]
    return {
        "allergens": labels,
        "contains_segments": stable_unique(segments),
        "match_spans": spans,
    }


def _merge_spans(spans: Sequence[Tuple[int, int]]) -> List[Tuple[int, int]]:
    merged: List[Tuple[int, int]] = []
    for start, end in sorted((max(0, int(s)), max(0, int(e))) for s, e in spans if int(e) > int(s)):
        if not merged:
            merged.append((start, end))
            continue
        prev_start, prev_end = merged[-1]
        if start <= prev_end:
            merged[-1] = (prev_start, max(prev_end, end))
        else:
            merged.append((start, end))
    return merged


def strip_disclosure_segments(text: str, spans: Sequence[Tuple[int, int]]) -> str:
    safe = as_text(text)
    merged = _merge_spans(spans)
    if not merged:
        return safe

    parts: List[str] = []
    cursor = 0
    for start, end in merged:
        if start > cursor:
            parts.append(safe[cursor:start])
        cursor = max(cursor, end)
    if cursor < len(safe):
        parts.append(safe[cursor:])

    cleaned = "".join(parts)
    cleaned = EMPTY_PUNCT_RE.sub(r"\1", cleaned)
    cleaned = BAD_PUNCT_SPACE_RE.sub(r"\1", cleaned)
    cleaned = TRAILING_DISCLOSURE_RE.sub("", cleaned)
    cleaned = SPACE_RE.sub(" ", cleaned).strip(" ,;:.")
    return cleaned


def write_jsonl(path: Path, rows: Sequence[Dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False))
            handle.write("\n")


def write_json(path: Path, payload: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def hash_to_unit(value: str) -> float:
    digest = hashlib.blake2b(value.encode("utf-8"), digest_size=8).digest()
    integer = int.from_bytes(digest, "big", signed=False)
    return float(integer) / float(2**64)


def maybe_download_file(url: str, output_path: Path, timeout: float, force_download: bool) -> Dict[str, object]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists() and not force_download:
        return {"downloaded": False, "bytes_written": int(output_path.stat().st_size)}

    temp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    if temp_path.exists():
        temp_path.unlink()

    request = urllib.request.Request(url, method="GET")
    bytes_written = 0
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response, temp_path.open("wb") as out:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
                bytes_written += len(chunk)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
        if temp_path.exists():
            temp_path.unlink()
        raise RuntimeError(f"download failed: {error}") from error

    os.replace(temp_path, output_path)
    return {"downloaded": True, "bytes_written": bytes_written}


def find_branded_food_member(zip_handle: zipfile.ZipFile) -> str:
    for member in zip_handle.namelist():
        if member.lower().endswith("branded_food.csv"):
            return member
    raise RuntimeError("Could not find branded_food.csv in USDA ZIP archive.")


def split_rows(rows: Sequence[Dict[str, object]], holdout_ratio: float) -> Tuple[List[Dict[str, object]], List[Dict[str, object]]]:
    train_rows: List[Dict[str, object]] = []
    holdout_rows: List[Dict[str, object]] = []
    for row in rows:
        row_id = as_text(row.get("id"))
        if holdout_ratio > 0 and hash_to_unit(row_id) < holdout_ratio:
            holdout_rows.append(row)
        else:
            train_rows.append(row)
    return train_rows, holdout_rows


def main() -> int:
    args = parse_args()

    holdout_ratio = max(0.0, min(0.9, float(args.holdout_ratio)))
    min_text_len = max(1, int(args.min_text_len))
    max_rows = max(0, int(args.max_rows))

    download_path = Path(args.download_path)
    train_output = Path(args.train_output)
    holdout_output = Path(args.holdout_output)
    summary_output = Path(args.summary_output)

    download_meta = maybe_download_file(
        url=as_text(args.download_url),
        output_path=download_path,
        timeout=float(args.timeout),
        force_download=bool(args.force_download),
    )
    if download_meta.get("downloaded"):
        print(f"Downloaded USDA ZIP -> {download_path} ({download_meta.get('bytes_written', 0)} bytes)")
    else:
        print(f"Using existing USDA ZIP -> {download_path}")

    rows: List[Dict[str, object]] = []
    seen_ids: Set[str] = set()

    skipped_short = 0
    skipped_unlabeled = 0
    skipped_no_contains = 0
    skipped_empty_after_strip = 0
    processed_rows = 0
    allergen_counter: Counter = Counter()

    with zipfile.ZipFile(download_path, mode="r") as archive:
        member = find_branded_food_member(archive)
        with archive.open(member, mode="r") as raw_handle:
            text_handle = io.TextIOWrapper(raw_handle, encoding="utf-8", newline="")
            reader = csv.DictReader(text_handle)

            for source_row in reader:
                processed_rows += 1
                if max_rows and processed_rows > max_rows:
                    break

                ingredients = as_text(source_row.get("ingredients"))
                if len(ingredients) < min_text_len:
                    skipped_short += 1
                    continue

                parsed = extract_allergens_from_ingredients(ingredients)
                allergens = parsed["allergens"]
                contains_segments = parsed["contains_segments"]
                sanitized_text = strip_disclosure_segments(ingredients, parsed["match_spans"])
                if len(sanitized_text) < min_text_len:
                    skipped_empty_after_strip += 1
                    continue

                if args.require_contains and not contains_segments:
                    skipped_no_contains += 1
                    continue

                if not args.include_unlabeled and not allergens:
                    skipped_unlabeled += 1
                    continue

                fdc_id = as_text(source_row.get("fdc_id"))
                row_id = f"usda_bulk::{fdc_id}" if fdc_id else f"usda_bulk::row{processed_rows}"
                if row_id in seen_ids:
                    continue
                seen_ids.add(row_id)

                allergen_counter.update(allergens)

                rows.append(
                    {
                        "id": row_id,
                        "text": sanitized_text,
                        "allergens": allergens,
                        "diets": [],
                        "source": "usda_fdc_bulk_branded",
                        "meta": {
                            "fdc_id": fdc_id,
                            "brand_owner": as_text(source_row.get("brand_owner")),
                            "brand_name": as_text(source_row.get("brand_name")),
                            "subcategory": as_text(source_row.get("subcategory")),
                            "serving_size": as_text(source_row.get("serving_size")),
                            "serving_size_unit": as_text(source_row.get("serving_size_unit")),
                            "contains_segments": contains_segments,
                            "raw_ingredients": ingredients,
                        },
                    }
                )

                if len(rows) % 25000 == 0:
                    print(f"kept_rows={len(rows)} processed={processed_rows}")

    train_rows, holdout_rows = split_rows(rows, holdout_ratio)
    write_jsonl(train_output, train_rows)
    write_jsonl(holdout_output, holdout_rows)

    summary = {
        "source": "usda_fdc_bulk_branded",
        "download_url": as_text(args.download_url),
        "download_path": str(download_path),
        "downloaded": bool(download_meta.get("downloaded")),
        "download_bytes": int(download_meta.get("bytes_written", 0)),
        "rows_processed": processed_rows if not max_rows else min(processed_rows, max_rows),
        "rows_kept": len(rows),
        "train_rows": len(train_rows),
        "holdout_rows": len(holdout_rows),
        "holdout_ratio": holdout_ratio,
        "include_unlabeled": bool(args.include_unlabeled),
        "require_contains": bool(args.require_contains),
        "min_text_len": min_text_len,
        "max_rows": max_rows,
        "skipped_short": skipped_short,
        "skipped_unlabeled": skipped_unlabeled,
        "skipped_no_contains": skipped_no_contains,
        "skipped_empty_after_strip": skipped_empty_after_strip,
        "allergen_counts": dict(allergen_counter),
    }
    write_json(summary_output, summary)

    print(f"Wrote train rows -> {train_output} ({len(train_rows)})")
    print(f"Wrote holdout rows -> {holdout_output} ({len(holdout_rows)})")
    print(f"Summary -> {summary_output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
