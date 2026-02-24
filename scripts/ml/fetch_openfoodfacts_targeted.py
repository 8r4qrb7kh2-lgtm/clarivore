#!/usr/bin/env python3
"""Targeted Open Food Facts fetcher for high-yield allergen label examples."""

import argparse
import json
import random
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
    "en:wheat": "wheat",
    "en:gluten": "wheat",
}

DIET_ANALYSIS_TAG_MAP: Dict[str, str] = {
    "en:non-vegan": "Vegan",
    "en:non-vegetarian": "Vegetarian",
    "en:non-pescatarian": "Pescatarian",
}

# High-yield query tags by Clarivore allergen class.
TARGET_TAGS: Dict[str, List[str]] = {
    "milk": ["milk"],
    "egg": ["eggs"],
    "peanut": ["peanuts"],
    "tree_nut": ["nuts", "almonds", "cashew-nuts", "walnuts"],
    "fish": ["fish"],
    "shellfish": ["crustaceans", "molluscs"],
    "soy": ["soybeans"],
    "sesame": ["sesame-seeds"],
    "wheat": ["wheat", "gluten"],
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Targeted Open Food Facts fetch by allergen tags.",
    )
    parser.add_argument(
        "--output",
        default="ml/data/processed/openfoodfacts_targeted_examples.jsonl",
        help="Output JSONL path.",
    )
    parser.add_argument(
        "--summary-output",
        default="ml/data/processed/openfoodfacts_targeted_summary.json",
        help="Summary JSON path.",
    )
    parser.add_argument("--pages-per-tag", type=int, default=6, help="Pages to fetch per tag.")
    parser.add_argument("--page-size", type=int, default=50, help="Rows per page.")
    parser.add_argument(
        "--country-tag",
        default="united-states",
        help="Country tag slug for OFF search filter (e.g. united-states). Empty disables country filter.",
    )
    parser.add_argument("--throttle-seconds", type=float, default=3.5, help="Delay between requests.")
    parser.add_argument("--timeout", type=float, default=45.0, help="HTTP timeout seconds.")
    parser.add_argument("--max-retries", type=int, default=4, help="Retries per request.")
    parser.add_argument("--min-text-len", type=int, default=12, help="Minimum ingredient text length.")
    parser.add_argument(
        "--include-traces",
        action="store_true",
        help="Include traces_tags in allergen mapping.",
    )
    parser.add_argument(
        "--include-unlabeled",
        action="store_true",
        help="Keep rows even if no mapped allergen/diet labels.",
    )
    parser.add_argument(
        "--user-agent",
        default="ClarivoreML/0.1 (matt@clarivore.app)",
        help="User-Agent for OFF requests.",
    )
    return parser.parse_args()


def fetch_json(url: str, user_agent: str, timeout: float, max_retries: int) -> Dict[str, object]:
    last_error: Exception = RuntimeError("Unknown fetch error")
    for attempt in range(1, max_retries + 1):
        request = urllib.request.Request(
            url,
            method="GET",
            headers={"Accept": "application/json", "User-Agent": user_agent},
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
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
            print(f"[warn] request failed {attempt}/{max_retries}: {error}; sleeping {sleep_seconds:.1f}s")
            time.sleep(sleep_seconds)

    raise RuntimeError(f"OFF request failed after {max_retries} retries: {last_error}")


def choose_ingredient_text(product: Dict[str, object]) -> str:
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
    for token, label in DIET_ANALYSIS_TAG_MAP.items():
        if token in tags_lower:
            out.append(label)
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


def build_query_url(*, tag: str, page: int, page_size: int, country_tag: str) -> str:
    params = {
        "action": "process",
        "json": "1",
        "page": str(page),
        "page_size": str(page_size),
        "fields": "code,product_name,ingredients_text,ingredients_text_en,allergens_tags,traces_tags,ingredients_analysis_tags,countries_tags",
        "tagtype_0": "allergens",
        "tag_contains_0": "contains",
        "tag_0": tag,
    }

    if country_tag:
        params["tagtype_1"] = "countries"
        params["tag_contains_1"] = "contains"
        params["tag_1"] = country_tag

    return "https://world.openfoodfacts.org/cgi/search.pl?" + urllib.parse.urlencode(params)


def main() -> int:
    args = parse_args()

    pages_per_tag = max(1, int(args.pages_per_tag))
    page_size = max(1, min(200, int(args.page_size)))
    min_text_len = max(1, int(args.min_text_len))
    country_tag = as_text(args.country_tag).lower()

    output_path = Path(args.output)
    summary_path = Path(args.summary_output)

    rows: List[Dict[str, object]] = []
    seen_ids: Set[str] = set()

    requests_made = 0
    failed_requests = 0
    products_seen = 0
    skipped_short_text = 0
    skipped_unlabeled = 0

    query_counter = Counter()
    allergen_counter = Counter()
    diet_counter = Counter()

    for class_name, tags in TARGET_TAGS.items():
        for tag in tags:
            for page in range(1, pages_per_tag + 1):
                url = build_query_url(tag=tag, page=page, page_size=page_size, country_tag=country_tag)

                try:
                    payload = fetch_json(
                        url=url,
                        user_agent=args.user_agent,
                        timeout=float(args.timeout),
                        max_retries=max(1, int(args.max_retries)),
                    )
                except RuntimeError as error:
                    failed_requests += 1
                    print(f"[warn] query failed class={class_name} tag={tag} page={page}: {error}")
                    if args.throttle_seconds > 0:
                        time.sleep(float(args.throttle_seconds))
                    continue

                requests_made += 1
                products = payload.get("products", [])
                if not isinstance(products, list) or not products:
                    break

                products_seen += len(products)
                added = 0

                for product in products:
                    if not isinstance(product, dict):
                        continue
                    text = choose_ingredient_text(product)
                    if len(text) < min_text_len:
                        skipped_short_text += 1
                        continue

                    code = as_text(product.get("code"))
                    row_id = f"off-target::{code}" if code else f"off-target::{class_name}:{tag}:{page}:{len(rows)}"
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
                    query_counter[f"{class_name}:{tag}"] += 1
                    allergen_counter.update(mapped_allergens)
                    diet_counter.update(mapped_diets)

                    rows.append(
                        {
                            "id": row_id,
                            "text": text,
                            "allergens": mapped_allergens,
                            "diets": mapped_diets,
                            "source": "openfoodfacts_targeted",
                            "meta": {
                                "code": code,
                                "product_name": as_text(product.get("product_name")),
                                "query_class": class_name,
                                "query_tag": tag,
                                "query_page": page,
                                "countries_tags": [as_text(v) for v in (product.get("countries_tags") or []) if as_text(v)],
                                "allergens_tags": [as_text(v) for v in (product.get("allergens_tags") or []) if as_text(v)],
                                "traces_tags": [as_text(v) for v in (product.get("traces_tags") or []) if as_text(v)],
                                "ingredients_analysis_tags": [
                                    as_text(v)
                                    for v in (product.get("ingredients_analysis_tags") or [])
                                    if as_text(v)
                                ],
                                "used_traces": bool(args.include_traces),
                            },
                        }
                    )
                    added += 1

                print(
                    f"[query class={class_name} tag={tag} page={page}] products={len(products)} added={added} total={len(rows)}"
                )

                if len(products) < page_size:
                    break

                if args.throttle_seconds > 0:
                    time.sleep(float(args.throttle_seconds))

    write_jsonl(output_path, rows)

    summary = {
        "source": "openfoodfacts_targeted",
        "pages_per_tag": pages_per_tag,
        "page_size": page_size,
        "country_tag": country_tag,
        "requests_made": requests_made,
        "failed_requests": failed_requests,
        "products_seen": products_seen,
        "rows_written": len(rows),
        "include_traces": bool(args.include_traces),
        "include_unlabeled": bool(args.include_unlabeled),
        "min_text_len": min_text_len,
        "skipped_short_text": skipped_short_text,
        "skipped_unlabeled": skipped_unlabeled,
        "query_counts": dict(query_counter),
        "allergen_counts": dict(allergen_counter),
        "diet_counts": dict(diet_counter),
    }
    write_json(summary_path, summary)

    print(f"Wrote {len(rows)} rows -> {output_path}")
    print(f"Summary -> {summary_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
