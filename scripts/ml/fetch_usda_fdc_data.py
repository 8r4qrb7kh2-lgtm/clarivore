#!/usr/bin/env python3
"""Fetch USDA FoodData Central branded ingredient labels for Clarivore training."""

import argparse
import json
import os
import random
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Set


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


# Mapping focused on allergen names commonly present in explicit contains statements.
TOKEN_TO_ALLERGEN: Dict[str, str] = {
    "milk": "milk",
    "dairy": "milk",
    "eggs": "egg",
    "egg": "egg",
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

# Contains-like statement patterns to extract high-confidence allergen signals.
CONTAINS_PATTERNS = [
    re.compile(r"\bcontains\b\s*[:\-]?\s*([^.;\n]+)", re.IGNORECASE),
    re.compile(r"\bmay contain\b\s*[:\-]?\s*([^.;\n]+)", re.IGNORECASE),
    re.compile(r"\bcontains one or more of the following\b\s*[:\-]?\s*([^.;\n]+)", re.IGNORECASE),
    re.compile(r"\bprocessed in a facility(?: that)? (?:also )?(?:processes|handles)\b\s*[:\-]?\s*([^.;\n]+)", re.IGNORECASE),
    re.compile(r"\bmanufactured on shared equipment with\b\s*[:\-]?\s*([^.;\n]+)", re.IGNORECASE),
]

NORM_RE = re.compile(r"[^a-z0-9 ]+")
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
TOKEN_MATCHERS: List[tuple[re.Pattern[str], str]] = [
    (re.compile(rf"\b{re.escape(key)}\b", re.IGNORECASE), allergen)
    for key, allergen in sorted(TOKEN_TO_ALLERGEN.items(), key=lambda item: len(item[0]), reverse=True)
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch USDA branded ingredient labels and infer allergen labels.")
    parser.add_argument("--output", default="ml/data/processed/usda_fdc_examples.jsonl")
    parser.add_argument("--summary-output", default="ml/data/processed/usda_fdc_summary.json")
    parser.add_argument("--max-pages", type=int, default=50, help="Pages to fetch.")
    parser.add_argument("--page-size", type=int, default=200, help="Rows per page (max 200).")
    parser.add_argument("--start-page", type=int, default=1)
    parser.add_argument("--throttle-seconds", type=float, default=0.35)
    parser.add_argument(
        "--query",
        default="contains",
        help="Search query for USDA foods/search (default: contains).",
    )
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--max-retries", type=int, default=5)
    parser.add_argument("--min-text-len", type=int, default=20)
    parser.add_argument(
        "--include-unlabeled",
        action="store_true",
        help="Keep rows with no detected allergen labels.",
    )
    parser.add_argument(
        "--api-key",
        default="",
        help="USDA FDC API key. Defaults to USDA_API_KEY env var then DEMO_KEY.",
    )
    return parser.parse_args()


def fetch_json(url: str, timeout: float, max_retries: int) -> Dict[str, object]:
    last_error: Exception = RuntimeError("Unknown fetch error")
    for attempt in range(1, max_retries + 1):
        req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
                if isinstance(payload, dict):
                    return payload
                raise RuntimeError("Unexpected payload type")
        except (
            urllib.error.HTTPError,
            urllib.error.URLError,
            TimeoutError,
            socket.timeout,
            json.JSONDecodeError,
        ) as error:
            last_error = error
            if attempt >= max_retries:
                break
            sleep_seconds = min(20.0, (2 ** (attempt - 1)) + random.random())
            print(f"[warn] request failed {attempt}/{max_retries}: {error}; retrying in {sleep_seconds:.1f}s")
            time.sleep(sleep_seconds)

    raise RuntimeError(f"USDA request failed after {max_retries} retries: {last_error}")


def normalize_token(value: str) -> str:
    safe = NORM_RE.sub(" ", as_text(value).lower()).strip()
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

    for pattern in CONTAINS_PATTERNS:
        for match in pattern.finditer(safe_text):
            segment = as_text(match.group(1))
            if not segment:
                continue
            segments.append(segment)
            labels.extend(map_segment_to_allergens(segment))

    labels = [label for label in stable_unique(labels) if label in ALLERGEN_CANONICAL]
    return {
        "allergens": labels,
        "contains_segments": stable_unique(segments),
    }


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


def main() -> int:
    args = parse_args()

    api_key = as_text(args.api_key) or as_text(os.environ.get("USDA_API_KEY")) or "DEMO_KEY"
    max_pages = max(1, int(args.max_pages))
    page_size = max(1, min(200, int(args.page_size)))
    start_page = max(1, int(args.start_page))
    min_text_len = max(1, int(args.min_text_len))
    query_text = as_text(args.query)

    rows: List[Dict[str, object]] = []
    seen_ids: Set[str] = set()

    requests_made = 0
    failed_requests = 0
    foods_seen = 0
    skipped_short = 0
    skipped_unlabeled = 0

    allergen_counter = Counter()

    for page in range(start_page, start_page + max_pages):
        query = urllib.parse.urlencode(
            {
                "api_key": api_key,
                "dataType": "Branded",
                "pageSize": page_size,
                "pageNumber": page,
                "query": query_text,
            }
        )
        url = f"https://api.nal.usda.gov/fdc/v1/foods/search?{query}"

        try:
            payload = fetch_json(url=url, timeout=float(args.timeout), max_retries=max(1, int(args.max_retries)))
        except RuntimeError as error:
            failed_requests += 1
            print(f"[warn] page {page} failed: {error}")
            if args.throttle_seconds > 0:
                time.sleep(float(args.throttle_seconds))
            continue

        requests_made += 1
        foods = payload.get("foods", [])
        if not isinstance(foods, list) or not foods:
            print(f"[info] no foods on page {page}; stopping")
            break

        foods_seen += len(foods)
        added = 0

        for food in foods:
            if not isinstance(food, dict):
                continue

            ingredients = as_text(food.get("ingredients"))
            if len(ingredients) < min_text_len:
                skipped_short += 1
                continue

            fdc_id = as_text(food.get("fdcId"))
            row_id = f"usda::{fdc_id}" if fdc_id else f"usda::page{page}::{len(rows)}"
            if row_id in seen_ids:
                continue

            parsed = extract_allergens_from_ingredients(ingredients)
            allergens = parsed["allergens"]
            if not args.include_unlabeled and not allergens:
                skipped_unlabeled += 1
                continue

            seen_ids.add(row_id)
            allergen_counter.update(allergens)

            rows.append(
                {
                    "id": row_id,
                    "text": ingredients,
                    "allergens": allergens,
                    "diets": [],
                    "source": "usda_fdc_branded",
                    "meta": {
                        "fdc_id": fdc_id,
                        "description": as_text(food.get("description")),
                        "brand_owner": as_text(food.get("brandOwner")),
                        "brand_name": as_text(food.get("brandName")),
                        "market_country": as_text(food.get("marketCountry")),
                        "gtin_upc": as_text(food.get("gtinUpc")),
                        "published_date": as_text(food.get("publishedDate")),
                        "contains_segments": parsed["contains_segments"],
                    },
                }
            )
            added += 1

        print(f"[page {page}] foods={len(foods)} added={added} total={len(rows)}")

        if len(foods) < page_size:
            print(f"[info] final partial page reached at {page}; stopping")
            break

        if args.throttle_seconds > 0:
            time.sleep(float(args.throttle_seconds))

    output_path = Path(args.output)
    summary_path = Path(args.summary_output)
    write_jsonl(output_path, rows)

    summary = {
        "source": "usda_fdc_branded",
        "api_key_mode": "DEMO_KEY" if api_key == "DEMO_KEY" else "CUSTOM",
        "start_page": start_page,
        "pages_requested": max_pages,
        "page_size": page_size,
        "query": query_text,
        "requests_made": requests_made,
        "failed_requests": failed_requests,
        "foods_seen": foods_seen,
        "rows_written": len(rows),
        "include_unlabeled": bool(args.include_unlabeled),
        "min_text_len": min_text_len,
        "skipped_short": skipped_short,
        "skipped_unlabeled": skipped_unlabeled,
        "allergen_counts": dict(allergen_counter),
    }
    write_json(summary_path, summary)

    print(f"Wrote {len(rows)} rows -> {output_path}")
    print(f"Summary -> {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
