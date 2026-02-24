#!/usr/bin/env python3
"""Fetch real ingredient-label examples from Open Food Facts into Clarivore JSONL format."""

import argparse
import json
import math
import random
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


ALLERGEN_MAP: Dict[str, str] = {
    "en:milk": "milk",
    "en:eggs": "egg",
    "en:egg": "egg",
    "en:peanuts": "peanut",
    "en:peanut": "peanut",
    "en:nuts": "tree nut",
    "en:tree-nuts": "tree nut",
    "en:almonds": "tree nut",
    "en:cashew-nuts": "tree nut",
    "en:hazelnuts": "tree nut",
    "en:pecan-nuts": "tree nut",
    "en:walnuts": "tree nut",
    "en:macadamia-nuts": "tree nut",
    "en:pine-nuts": "tree nut",
    "en:pistachios": "tree nut",
    "en:brazil-nuts": "tree nut",
    "en:fish": "fish",
    "en:shellfish": "shellfish",
    "en:crustaceans": "shellfish",
    "en:molluscs": "shellfish",
    "en:soybeans": "soy",
    "en:soy": "soy",
    "en:sesame-seeds": "sesame",
    "en:sesame": "sesame",
    # Clarivore tracks wheat as the gluten-driving allergen class.
    "en:wheat": "wheat",
    "en:gluten": "wheat",
}

DIET_ANALYSIS_TAG_MAP: Dict[str, str] = {
    "en:non-vegan": "Vegan",
    "en:non-vegetarian": "Vegetarian",
    "en:non-pescatarian": "Pescatarian",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Collect Open Food Facts ingredient-label training rows.",
    )
    parser.add_argument(
        "--output",
        default="ml/data/processed/openfoodfacts_examples.jsonl",
        help="Output JSONL file path.",
    )
    parser.add_argument(
        "--summary-output",
        default="ml/data/processed/openfoodfacts_summary.json",
        help="Output summary JSON file path.",
    )
    parser.add_argument("--max-pages", type=int, default=10, help="Maximum pages to fetch.")
    parser.add_argument("--page-size", type=int, default=100, help="Products per API page.")
    parser.add_argument(
        "--throttle-seconds",
        type=float,
        default=6.2,
        help="Delay between search requests. Open Food Facts search API limit is 10 requests/minute.",
    )
    parser.add_argument(
        "--country-tag",
        default="en:united-states",
        help="Only keep products with this country tag. Use --country-tag '' to disable.",
    )
    parser.add_argument(
        "--include-traces",
        action="store_true",
        help="Include traces_tags when mapping allergen labels.",
    )
    parser.add_argument(
        "--include-unlabeled",
        action="store_true",
        help="Keep rows even if no mapped allergen or diet labels are found.",
    )
    parser.add_argument("--min-text-len", type=int, default=12, help="Minimum ingredient text length.")
    parser.add_argument("--max-retries", type=int, default=4, help="Retry attempts per page request.")
    parser.add_argument("--timeout", type=float, default=45.0, help="HTTP timeout (seconds).")
    parser.add_argument(
        "--user-agent",
        default="ClarivoreML/0.1 (matt@clarivore.app)",
        help="User-Agent for Open Food Facts API requests.",
    )
    return parser.parse_args()


def fetch_json(url: str, user_agent: str, timeout: float, max_retries: int) -> Dict[str, object]:
    last_error: Exception = RuntimeError("Unknown fetch error")
    for attempt in range(1, max_retries + 1):
        request = urllib.request.Request(
            url,
            method="GET",
            headers={
                "Accept": "application/json",
                "User-Agent": user_agent,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
                if isinstance(payload, dict):
                    return payload
                raise RuntimeError("Unexpected payload type (expected object)")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            if attempt >= max_retries:
                break
            sleep_seconds = min(20.0, (2 ** (attempt - 1)) + random.random())
            print(f"[warn] request failed (attempt {attempt}/{max_retries}): {error}; retrying in {sleep_seconds:.1f}s")
            time.sleep(sleep_seconds)

    raise RuntimeError(f"Open Food Facts request failed after {max_retries} attempts: {last_error}")


def choose_ingredient_text(product: Dict[str, object]) -> str:
    # Prefer English text when present, fallback to raw ingredients_text.
    text = as_text(product.get("ingredients_text_en"))
    if text:
        return text
    return as_text(product.get("ingredients_text"))


def map_allergens(tags: Sequence[object]) -> List[str]:
    mapped: List[str] = []
    for tag in tags or []:
        token = as_text(tag).lower()
        if token in ALLERGEN_MAP:
            mapped.append(ALLERGEN_MAP[token])
    return stable_unique(mapped)


def map_diet_violations(analysis_tags: Sequence[object], mapped_allergens: Sequence[str]) -> List[str]:
    out: List[str] = []
    tags_lower = {as_text(tag).lower() for tag in (analysis_tags or []) if as_text(tag)}

    for token, diet_label in DIET_ANALYSIS_TAG_MAP.items():
        if token in tags_lower:
            out.append(diet_label)

    # Clarivore models gluten-free as a diet violation driven by wheat/gluten evidence.
    if "wheat" in set(mapped_allergens):
        out.append("Gluten-free")

    return stable_unique(out)


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

    max_pages = max(1, int(args.max_pages))
    page_size = max(1, min(200, int(args.page_size)))
    min_text_len = max(1, int(args.min_text_len))
    country_tag = as_text(args.country_tag).lower()

    fields = ",".join(
        [
            "code",
            "product_name",
            "ingredients_text",
            "ingredients_text_en",
            "allergens_tags",
            "traces_tags",
            "ingredients_analysis_tags",
            "countries_tags",
        ]
    )

    collected: List[Dict[str, object]] = []
    seen_ids: Set[str] = set()

    pages_fetched = 0
    products_seen = 0
    skipped_short_text = 0
    skipped_country = 0
    skipped_unlabeled = 0

    allergen_counter = Counter()
    diet_counter = Counter()

    for page in range(1, max_pages + 1):
        query = urllib.parse.urlencode(
            {
                "fields": fields,
                "page": page,
                "page_size": page_size,
            }
        )
        url = f"https://world.openfoodfacts.org/api/v2/search?{query}"
        payload = fetch_json(
            url=url,
            user_agent=args.user_agent,
            timeout=float(args.timeout),
            max_retries=max(1, int(args.max_retries)),
        )

        products = payload.get("products", [])
        if not isinstance(products, list) or not products:
            print(f"[info] no products on page {page}; stopping")
            break

        pages_fetched += 1
        products_seen += len(products)

        added_this_page = 0

        for product in products:
            if not isinstance(product, dict):
                continue

            countries = [as_text(tag).lower() for tag in (product.get("countries_tags") or []) if as_text(tag)]
            if country_tag and country_tag not in countries:
                skipped_country += 1
                continue

            text = choose_ingredient_text(product)
            if len(text) < min_text_len:
                skipped_short_text += 1
                continue

            product_code = as_text(product.get("code"))
            row_id = f"off::{product_code}" if product_code else f"off::page{page}::{len(collected)}"
            if row_id in seen_ids:
                continue

            allergen_tags = list(product.get("allergens_tags") or [])
            if args.include_traces:
                allergen_tags.extend(list(product.get("traces_tags") or []))

            mapped_allergens = map_allergens(allergen_tags)
            mapped_diets = map_diet_violations(
                analysis_tags=list(product.get("ingredients_analysis_tags") or []),
                mapped_allergens=mapped_allergens,
            )

            if not args.include_unlabeled and not mapped_allergens and not mapped_diets:
                skipped_unlabeled += 1
                continue

            seen_ids.add(row_id)
            row = {
                "id": row_id,
                "text": text,
                "allergens": mapped_allergens,
                "diets": mapped_diets,
                "source": "openfoodfacts",
                "meta": {
                    "code": product_code,
                    "product_name": as_text(product.get("product_name")),
                    "countries_tags": countries,
                    "allergens_tags": [as_text(tag) for tag in (product.get("allergens_tags") or []) if as_text(tag)],
                    "traces_tags": [as_text(tag) for tag in (product.get("traces_tags") or []) if as_text(tag)],
                    "ingredients_analysis_tags": [
                        as_text(tag)
                        for tag in (product.get("ingredients_analysis_tags") or [])
                        if as_text(tag)
                    ],
                    "used_traces": bool(args.include_traces),
                },
            }
            collected.append(row)
            added_this_page += 1
            allergen_counter.update(mapped_allergens)
            diet_counter.update(mapped_diets)

        print(
            f"[page {page}] products={len(products)} kept={added_this_page} total_kept={len(collected)}"
        )

        if len(products) < page_size:
            print(f"[info] final partial page reached at {page}; stopping")
            break

        if page < max_pages and args.throttle_seconds > 0:
            time.sleep(float(args.throttle_seconds))

    output_path = Path(args.output)
    summary_path = Path(args.summary_output)

    write_jsonl(output_path, collected)

    summary = {
        "source": "openfoodfacts",
        "pages_requested": max_pages,
        "pages_fetched": pages_fetched,
        "page_size": page_size,
        "products_seen": products_seen,
        "rows_written": len(collected),
        "country_tag": country_tag,
        "include_traces": bool(args.include_traces),
        "include_unlabeled": bool(args.include_unlabeled),
        "min_text_len": min_text_len,
        "skipped_short_text": skipped_short_text,
        "skipped_country": skipped_country,
        "skipped_unlabeled": skipped_unlabeled,
        "allergen_counts": dict(allergen_counter),
        "diet_counts": dict(diet_counter),
    }
    write_json(summary_path, summary)

    print(f"Wrote {len(collected)} rows -> {output_path}")
    print(f"Summary -> {summary_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
