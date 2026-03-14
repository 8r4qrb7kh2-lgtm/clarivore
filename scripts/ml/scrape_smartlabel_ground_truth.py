"""Scrape additional SmartLabel ground-truth rows from live SmartLabel pages.

This script expands the local SmartLabel CSV without inferring allergens from
ingredient text. It supports two live templates:

- scanbuy-style product pages discovered from XML sitemaps, where a landing
  page exposes a hidden product UUID and separate ingredients/allergens HTML
  fragments.
- syndigo-style product pages, where the ingredients and allergens sections are
  already embedded in the landing HTML.

The output CSV keeps the existing schema used by build_smartlabel_safe_catalog.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import zlib
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from bs4 import BeautifulSoup

DEFAULT_INPUT = Path("full_smartlabel_ground_truth copy.csv")
DEFAULT_OUTPUT = DEFAULT_INPUT
DEFAULT_SUMMARY = Path("ml/seeds/smartlabel_ground_truth_scrape_summary.json")
DEFAULT_MAX_WORKERS = 12
DEFAULT_MAX_PER_HOST = 0
DEFAULT_MAX_TOTAL = 0
DEFAULT_TIMEOUT_SECONDS = 20
DEFAULT_SEARCH_API_PAGES = 0
DEFAULT_SEARCH_API_PER_PAGE = 500
DEFAULT_SITEMAP_HOSTS = [
    "smartlabel1.foodclub.com",
    "smartlabel.freedomschoice.info",
    "smartlabel.pepsico.info",
    "smartlabel.conagra.com",
    "smartlabel.mondelez.info",
    "smartlabel.hersheys.com",
    "smartlabel.bluediamond.com",
]
SITEMAP_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
USER_AGENT = "Mozilla/5.0 (compatible; ClarivoreSmartLabelScraper/1.0)"
SEARCH_API_URL = "https://api.smartlabel.org/api/search"
PG_PRODUCT_DETAILS_URL = "https://az-na-smartlabel-prod-functionapp-api.pgcloud.com/api/getproductdetails"
PG_FUNCTIONS_KEY = "rcFCU9OGRqabB1wIlttDM8MKKGU8aVb0YquO2xw6uiW9a7SGraQhlw=="
CSV_FIELDNAMES = [
    "smartlabel_id",
    "smartlabel_upc",
    "smartlabel_url",
    "smartlabel_url_ingredients",
    "smartlabel_url_allergens",
    "image_url",
    "image_field",
    "rev",
    "http_status",
    "notes",
    "ingredients_http_status",
    "allergens_http_status",
    "ingredients_text",
    "ingredients_items_json",
    "allergens_declared_json",
    "allergens_present_json",
    "allergens_may_contain_json",
    "smartlabel_error",
]
SAFE_NOTES = "ok"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Expand SmartLabel ground truth from live SmartLabel pages.")
    parser.add_argument(
        "--input",
        default=str(DEFAULT_INPUT),
        help="Existing SmartLabel ground-truth CSV to merge into.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Path to write the merged SmartLabel ground-truth CSV.",
    )
    parser.add_argument(
        "--summary-output",
        default=str(DEFAULT_SUMMARY),
        help="Path to write a scrape summary JSON file.",
    )
    parser.add_argument(
        "--hosts",
        default=",".join(DEFAULT_SITEMAP_HOSTS),
        help="Comma-separated sitemap hosts to crawl.",
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        default=DEFAULT_MAX_WORKERS,
        help="Number of concurrent fetch workers.",
    )
    parser.add_argument(
        "--max-per-host",
        type=int,
        default=DEFAULT_MAX_PER_HOST,
        help="Optional cap per sitemap host. Use 0 for no cap.",
    )
    parser.add_argument(
        "--max-total",
        type=int,
        default=DEFAULT_MAX_TOTAL,
        help="Optional total cap across discovered sitemap URLs. Use 0 for no cap.",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help="Per-request timeout in seconds.",
    )
    parser.add_argument(
        "--search-api-pages",
        type=int,
        default=DEFAULT_SEARCH_API_PAGES,
        help="Number of SmartLabel search API pages to crawl for additional product URLs. Use 0 to disable.",
    )
    parser.add_argument(
        "--search-api-hosts",
        default="",
        help="Optional comma-separated host filter for SmartLabel search API discovered URLs.",
    )
    return parser.parse_args()


def as_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_spaces(value: Any) -> str:
    return re.sub(r"\s+", " ", as_text(value)).strip()


def parse_json_list(value: Any) -> list[str]:
    text = as_text(value)
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [normalize_spaces(item) for item in parsed if normalize_spaces(item)]


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


def hosts_from_arg(hosts_arg: str) -> list[str]:
    return [host.strip().lower() for host in hosts_arg.split(",") if host.strip()]


def load_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return [dict(row) for row in reader]


def ensure_fieldnames(rows: list[dict[str, str]]) -> list[str]:
    if not rows:
        return list(CSV_FIELDNAMES)
    ordered = list(rows[0].keys())
    for field in CSV_FIELDNAMES:
        if field not in ordered:
            ordered.append(field)
    return ordered


def write_csv_rows(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fieldnames})


def fetch_url(url: str, timeout_seconds: int) -> tuple[str, str, str]:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            text = response.read().decode(charset, "ignore")
            return str(response.status), text, ""
    except HTTPError as exc:
        body = exc.read().decode("utf-8", "ignore") if exc.fp else ""
        return str(exc.code), body, str(exc)
    except URLError as exc:
        return "", "", str(exc)
    except TimeoutError as exc:
        return "", "", str(exc)


def fetch_json(url: str, timeout_seconds: int) -> tuple[str, Any | None, str]:
    status, text, error = fetch_url(url, timeout_seconds)
    if status != "200":
        return status, None, error
    try:
        return status, json.loads(text), ""
    except json.JSONDecodeError as exc:
        return status, None, str(exc)


def fetch_json_with_headers(url: str, timeout_seconds: int, headers: dict[str, str]) -> tuple[str, Any | None, str]:
    request = Request(url, headers={"User-Agent": USER_AGENT, **headers})
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            text = response.read().decode(charset, "ignore")
            return str(response.status), json.loads(text), ""
    except HTTPError as exc:
        body = exc.read().decode("utf-8", "ignore") if exc.fp else ""
        return str(exc.code), None, body or str(exc)
    except json.JSONDecodeError as exc:
        return "200", None, str(exc)
    except URLError as exc:
        return "", None, str(exc)
    except TimeoutError as exc:
        return "", None, str(exc)


def fetch_form_url(url: str, form_data: dict[str, str], timeout_seconds: int) -> tuple[str, str, str]:
    request = Request(
        url,
        data=urlencode(form_data).encode("utf-8"),
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            text = response.read().decode(charset, "ignore")
            return str(response.status), text, ""
    except HTTPError as exc:
        body = exc.read().decode("utf-8", "ignore") if exc.fp else ""
        return str(exc.code), body, str(exc)
    except URLError as exc:
        return "", "", str(exc)
    except TimeoutError as exc:
        return "", "", str(exc)


def make_numeric_id(seed: str) -> str:
    return str(zlib.crc32(seed.encode("utf-8")) & 0xFFFFFFFF)


def build_empty_row(url: str) -> dict[str, str]:
    row = {field: "" for field in CSV_FIELDNAMES}
    row.update(
        {
            "smartlabel_id": make_numeric_id(url),
            "smartlabel_upc": "",
            "smartlabel_url": url,
            "smartlabel_url_ingredients": url,
            "smartlabel_url_allergens": url,
            "image_url": "",
            "image_field": "",
            "rev": "",
            "http_status": "",
            "notes": "",
            "ingredients_http_status": "",
            "allergens_http_status": "",
            "ingredients_text": "",
            "ingredients_items_json": "[]",
            "allergens_declared_json": "[]",
            "allergens_present_json": "[]",
            "allergens_may_contain_json": "[]",
            "smartlabel_error": "",
        }
    )
    return row


def append_error(errors: list[str], message: str) -> None:
    text = normalize_spaces(message)
    if text and text not in errors:
        errors.append(text)


def path_upc_and_rev(url: str) -> tuple[str, str]:
    match = re.search(r"/([0-9]{11,14})-(\d{4})-[A-Za-z]{2}-[A-Za-z]{2}/index\.html$", url)
    if not match:
        return "", ""
    return match.group(1), str(int(match.group(2)))


def labelinsight_product_id(url: str) -> str:
    match = re.search(r"/(?:product|id)/(\d+)(?:/|$)", url)
    return as_text(match.group(1)) if match else ""


def find_meta_content(soup: BeautifulSoup, name: str, attr: str = "property") -> str:
    tag = soup.find("meta", attrs={attr: name})
    if not tag:
        return ""
    return as_text(tag.get("content"))


def extract_scanbuy_product_id(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    node = soup.select_one('#productId') or soup.find("input", attrs={"name": "productId"})
    if not node:
        return ""
    return as_text(node.get("value"))


def extract_syndigo_upc(soup: BeautifulSoup) -> str:
    candidates = [
        soup.select_one(".top__text__upc"),
        soup.select_one('[data-id="image__front"]'),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        text = normalize_spaces(candidate.get_text(" ", strip=True))
        digits = re.sub(r"\D+", "", text)
        if digits:
            return digits
    return ""


def extract_bestchoice_upc(soup: BeautifulSoup) -> str:
    for candidate in [
        soup.select_one(".product-upc"),
        soup.select_one(".image-gtin-container p"),
    ]:
        if not candidate:
            continue
        digits = re.sub(r"\D+", "", normalize_spaces(candidate.get_text(" ", strip=True)))
        if digits:
            return digits
    return ""


def extract_generalmills_gtin(value: str) -> str:
    match = re.search(r"(\d{11,14})", as_text(value))
    return as_text(match.group(1)) if match else ""


def extract_pg_locale_and_gtin(url: str) -> tuple[str, str]:
    match = re.search(r"/([a-z]{2}-[a-z]{2})/([0-9]{11,14})\.html$", as_text(url), re.IGNORECASE)
    if not match:
        return "", extract_generalmills_gtin(url)
    return match.group(1), match.group(2)


def normalize_allergen_name(value: str) -> str:
    text = normalize_spaces(value).strip(".:,;")
    return text


def split_allergen_names(value: str) -> list[str]:
    compact = normalize_spaces(value)
    if not compact:
        return []
    compact = compact.replace(" and/or ", ", ")
    compact = compact.replace(" or ", ", ")
    compact = re.sub(r"\band\b", ",", compact, flags=re.IGNORECASE)
    parts = re.split(r",|/", compact)
    return dedupe_strings([normalize_allergen_name(part) for part in parts])


def classify_allergen_status(status: str) -> str:
    normalized = normalize_spaces(status).lower()
    if not normalized:
        return "declared"
    if any(token in normalized for token in ["does not contain", "free from", "not present"]):
        return "none"
    if normalized.startswith("contain") or normalized == "contains":
        return "present"
    if any(
        token in normalized
        for token in [
            "may contain",
            "shared facility",
            "shared equipment",
            "same facility",
            "same equipment",
            "manufactured on shared",
            "processed on shared",
            "processed in a facility",
            "trace",
        ]
    ):
        return "may_contain"
    return "declared"


def assign_allergen_bucket(
    name: str,
    status: str,
    declared: list[str],
    present: list[str],
    may_contain: list[str],
) -> None:
    normalized_name = normalize_allergen_name(name)
    if not normalized_name:
        return
    bucket = classify_allergen_status(status)
    if bucket == "present":
        present.append(normalized_name)
    elif bucket == "may_contain":
        may_contain.append(normalized_name)
    elif bucket == "declared":
        declared.append(normalized_name)


def parse_scanbuy_allergens_html(html: str) -> tuple[list[str], list[str], list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    declared: list[str] = []
    present: list[str] = []
    may_contain: list[str] = []

    for row in soup.select("#allergens-list li"):
        classification = row.select_one('[data-id="classification"]')
        if classification:
            text = normalize_spaces(classification.get_text(" ", strip=True))
            if "|" in text:
                name, status = text.split("|", 1)
            else:
                name, status = text, ""
        else:
            name_node = row.select_one(".col-xs-8, .col-md-8, .col-lg-8, .blue")
            status_node = row.select_one(".badge, .allergens__warning-label")
            name = normalize_spaces(name_node.get_text(" ", strip=True)) if name_node else ""
            status = normalize_spaces(status_node.get_text(" ", strip=True)) if status_node else ""
        assign_allergen_bucket(name, status, declared, present, may_contain)

    return dedupe_strings(declared), dedupe_strings(present), dedupe_strings(may_contain)


def parse_scanbuy_ingredients_html(html: str) -> tuple[str, list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    container = soup.select_one("#ingredient-list") or soup
    items = [
        normalize_spaces(node.get_text(" ", strip=True))
        for node in container.select(".list-title")
        if normalize_spaces(node.get_text(" ", strip=True))
    ]
    unique_items = dedupe_strings(items)
    return ", ".join(unique_items), unique_items


def parse_syndigo_allergens_html(html: str) -> tuple[list[str], list[str], list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    declared: list[str] = []
    present: list[str] = []
    may_contain: list[str] = []
    seen_pairs: set[tuple[str, str]] = set()

    for node in soup.select('[data-id="allergens__labels_classifications"] [data-id="classification"]'):
        text = normalize_spaces(node.get_text(" ", strip=True))
        if not text or "|" not in text:
            continue
        name, status = text.split("|", 1)
        pair = (normalize_allergen_name(name), normalize_spaces(status))
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        assign_allergen_bucket(name, status, declared, present, may_contain)

    if not seen_pairs:
        for row in soup.select('[data-id="human_allergens_classifications"] li, [data-id="allergens__labels_classifications"] li'):
            name_node = row.select_one('[data-id="allergens_classification"], .blue')
            status_node = row.select_one(".allergens__warning-label")
            name = normalize_spaces(name_node.get_text(" ", strip=True)) if name_node else ""
            status = normalize_spaces(status_node.get_text(" ", strip=True)) if status_node else ""
            pair = (normalize_allergen_name(name), normalize_spaces(status))
            if not pair[0] or pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            assign_allergen_bucket(name, status, declared, present, may_contain)

    if not seen_pairs:
        text = soup.get_text(" ", strip=True)
        contains_match = re.search(r"Contains[: ]+([^\.]+)", text, re.IGNORECASE)
        if contains_match:
            for name in split_allergen_names(contains_match.group(1)):
                present.append(name)
        shared_match = re.search(
            r"(?:shared equipment|shared facility|manufactured on shared equipment)[^\.]*contain[s]? ([^\.]+)",
            text,
            re.IGNORECASE,
        )
        if shared_match:
            for name in split_allergen_names(shared_match.group(1)):
                may_contain.append(name)

    return dedupe_strings(declared), dedupe_strings(present), dedupe_strings(may_contain)


def parse_syndigo_ingredients_html(html: str) -> tuple[str, list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    container = soup.select_one('[data-name="ingredients"]') or soup
    items = [
        normalize_spaces(node.get_text(" ", strip=True))
        for node in container.select("span.linked-list__text")
        if normalize_spaces(node.get_text(" ", strip=True))
    ]
    unique_items = dedupe_strings(items)
    return ", ".join(unique_items), unique_items


def parse_bestchoice_allergens_html(html: str) -> tuple[list[str], list[str], list[str], int]:
    soup = BeautifulSoup(html, "html.parser")
    declared: list[str] = []
    present: list[str] = []
    may_contain: list[str] = []
    explicit_rows = 0

    for row in soup.select("ul.allergen-list li"):
        name_node = row.select_one(".atc")
        status_node = row.select_one(".locc")
        name = normalize_spaces(name_node.get_text(" ", strip=True)) if name_node else ""
        status = normalize_spaces(status_node.get_text(" ", strip=True)) if status_node else ""
        if not name or not status:
            continue
        explicit_rows += 1
        assign_allergen_bucket(name, status, declared, present, may_contain)

    return dedupe_strings(declared), dedupe_strings(present), dedupe_strings(may_contain), explicit_rows


def parse_bestchoice_ingredients_html(html: str) -> tuple[str, list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    container = soup.select_one("#ingredients") or soup
    items = [
        normalize_spaces(node.get_text(" ", strip=True))
        for node in container.select("li")
        if normalize_spaces(node.get_text(" ", strip=True))
    ]
    unique_items = dedupe_strings(items)
    return ", ".join(unique_items), unique_items


def parse_generalmills_ingredients_html(html: str) -> tuple[str, list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    items = [
        normalize_spaces(node.get_text(" ", strip=True))
        for node in soup.select("#ingredients-list .list-title")
        if normalize_spaces(node.get_text(" ", strip=True))
    ]
    unique_items = dedupe_strings(items)
    return ", ".join(unique_items), unique_items


def parse_generalmills_allergens_html(html: str) -> tuple[list[str], list[str], list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    declared: list[str] = []
    present: list[str] = []
    may_contain: list[str] = []

    for row in soup.select("#allergens-list li"):
        name_node = row.select_one("h3, .list-title")
        status_node = row.select_one(".contain-link span, .contain-link")
        name = normalize_spaces(name_node.get_text(" ", strip=True)) if name_node else ""
        status = normalize_spaces(status_node.get_text(" ", strip=True)) if status_node else ""
        if not name:
            continue
        assign_allergen_bucket(name, status, declared, present, may_contain)

    return dedupe_strings(declared), dedupe_strings(present), dedupe_strings(may_contain)


def parse_hormel_ingredients_html(html: str) -> tuple[str, list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    items = [
        normalize_spaces(node.get_text(" ", strip=True))
        for node in soup.select("#ingredientsTab li p")
        if normalize_spaces(node.get_text(" ", strip=True))
    ]
    if not items:
        text = normalize_spaces((soup.select_one("#ingredientsTab") or soup).get_text(" ", strip=True))
        items = split_allergen_names(text) if "," in text else [text] if text else []
    unique_items = dedupe_strings(items)
    return ", ".join(unique_items), unique_items


def parse_hormel_allergens_html(html: str) -> tuple[list[str], list[str], list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    declared: list[str] = []
    present: list[str] = []
    may_contain: list[str] = []

    for row in soup.select("#allergensTab ul li"):
        name_node = row.select_one("p")
        status_node = row.select_one(".contains-pill")
        name = normalize_spaces(name_node.get_text(" ", strip=True)) if name_node else ""
        status = normalize_spaces(status_node.get_text(" ", strip=True)) if status_node else ""
        if name and status:
            assign_allergen_bucket(name, status, declared, present, may_contain)

    text = normalize_spaces((soup.select_one("#allergensTab") or soup).get_text(" ", strip=True))
    for prefix, bucket in [("Contains:", present), ("May Contain:", may_contain)]:
        for match in re.finditer(rf"{re.escape(prefix)}\s*([^\.]+)", text, re.IGNORECASE):
            for name in split_allergen_names(match.group(1)):
                bucket.append(name)

    return dedupe_strings(declared), dedupe_strings(present), dedupe_strings(may_contain)


def parse_rbnainfo_ingredients_html(html: str) -> tuple[str, list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    items: list[str] = []

    for detail in soup.select("#ingredients .accChild"):
        header = detail.find_previous_sibling("div", class_="card-header")
        if not header:
            continue
        heading = header.select_one("h3")
        name = normalize_spaces(heading.get_text(" ", strip=True)) if heading else ""
        if name:
            items.append(name)

    unique_items = dedupe_strings(items)
    return ", ".join(unique_items), unique_items


def flatten_labelinsight_ingredients(items: list[dict[str, Any]]) -> list[str]:
    output: list[str] = []

    def visit(nodes: list[dict[str, Any]]) -> None:
        for node in nodes or []:
            if not isinstance(node, dict):
                continue
            name = normalize_spaces(node.get("name"))
            if name:
                output.append(name)
            visit(node.get("subIngredients") or [])
            visit(node.get("ingredientComponents") or [])

    visit(items)
    return dedupe_strings(output)


def parse_labelinsight_payload(payload: dict[str, Any]) -> tuple[str, list[str], list[str], list[str], list[str], str]:
    ingredient_section = payload.get("ingredientSection") or {}
    allergen_section = payload.get("allergenSection") or {}

    ingredient_items = flatten_labelinsight_ingredients(ingredient_section.get("ingredients") or [])
    if not ingredient_items:
        ingredient_items = flatten_labelinsight_ingredients(ingredient_section.get("activeIngredients") or [])

    declared: list[str] = []
    present: list[str] = []
    may_contain: list[str] = []

    for allergen in allergen_section.get("allergens") or []:
        if not isinstance(allergen, dict):
            continue
        presence = normalize_spaces(allergen.get("presence"))
        if not presence:
            continue
        assign_allergen_bucket(allergen.get("name", ""), presence, declared, present, may_contain)

    ingredients_text = normalize_spaces(payload.get("rawIngredients"))
    if not ingredients_text:
        ingredients_text = ", ".join(ingredient_items)

    image_url = normalize_spaces(payload.get("marketingImage"))
    return (
        ingredients_text,
        ingredient_items,
        dedupe_strings(declared),
        dedupe_strings(present),
        dedupe_strings(may_contain),
        image_url,
    )


def flatten_pg_ingredients(items: list[dict[str, Any]]) -> list[str]:
    output: list[str] = []

    def visit(nodes: list[dict[str, Any]]) -> None:
        for node in nodes or []:
            if not isinstance(node, dict):
                continue
            name = normalize_spaces(node.get("ingredientName"))
            if name:
                output.append(name)
            visit(node.get("subIngredients") or [])
            visit(node.get("fragranceIngredients") or [])

    visit(items)
    return dedupe_strings(output)


def parse_pg_product_payload(payload: dict[str, Any]) -> tuple[str, list[str], list[str], list[str], list[str], str]:
    fields = payload.get("fields") or {}
    ingredient_items = flatten_pg_ingredients(fields.get("ingredientList") or [])
    ingredients_text = ", ".join(ingredient_items)

    declared: list[str] = []
    allergen_fields = (fields.get("allergen") or {}).get("fields") or {}
    allergen_statement = normalize_spaces(allergen_fields.get("allergenStatement"))
    if allergen_statement:
        declared.append(allergen_statement)

    image_url = ""
    for key in ["productImage", "drugFactImage"]:
        file_url = normalize_spaces((((fields.get(key) or {}).get("fields") or {}).get("file") or {}).get("url"))
        if file_url:
            image_url = f"https:{file_url}" if file_url.startswith("//") else file_url
            break

    return ingredients_text, ingredient_items, dedupe_strings(declared), [], [], image_url


def finalize_row(row: dict[str, str], errors: list[str], parser_name: str) -> dict[str, str]:
    row["ingredients_items_json"] = json.dumps(parse_json_list(row["ingredients_items_json"]), ensure_ascii=True)
    row["allergens_declared_json"] = json.dumps(parse_json_list(row["allergens_declared_json"]), ensure_ascii=True)
    row["allergens_present_json"] = json.dumps(parse_json_list(row["allergens_present_json"]), ensure_ascii=True)
    row["allergens_may_contain_json"] = json.dumps(parse_json_list(row["allergens_may_contain_json"]), ensure_ascii=True)
    row["notes"] = SAFE_NOTES if not errors else f"{parser_name}_partial"
    row["smartlabel_error"] = "; ".join(errors)
    return row


def scrape_labelinsight_page(landing_url: str, timeout_seconds: int) -> dict[str, str]:
    row = build_empty_row(landing_url)
    row["http_status"] = "200"
    row["notes"] = SAFE_NOTES
    errors: list[str] = []

    product_id = labelinsight_product_id(landing_url)
    if not product_id:
        row["notes"] = "unsupported"
        row["smartlabel_error"] = "labelinsight:missing_product_id"
        return row

    api_url = f"https://external-api.labelinsight.com/smartlabel-api/api/v3/{product_id}"
    api_status, payload, api_error = fetch_json(api_url, timeout_seconds)
    row["ingredients_http_status"] = api_status
    row["allergens_http_status"] = api_status
    if api_status != "200" or not isinstance(payload, dict):
        row["notes"] = "fetch_failed"
        row["smartlabel_error"] = api_error or api_status or "labelinsight_api_failed"
        return row

    row["smartlabel_id"] = product_id
    row["smartlabel_upc"] = re.sub(r"\D+", "", as_text(payload.get("upc")))
    if "/product/" in landing_url:
        row["smartlabel_url_ingredients"] = f"https://smartlabel.labelinsight.com/product/{product_id}/ingredients"
        row["smartlabel_url_allergens"] = f"https://smartlabel.labelinsight.com/product/{product_id}/allergens"
    else:
        row["smartlabel_url_ingredients"] = landing_url
        row["smartlabel_url_allergens"] = landing_url

    (
        ingredients_text,
        ingredient_items,
        declared,
        present,
        may_contain,
        image_url,
    ) = parse_labelinsight_payload(payload)
    row["ingredients_text"] = ingredients_text
    row["ingredients_items_json"] = json.dumps(ingredient_items, ensure_ascii=True)
    row["allergens_declared_json"] = json.dumps(declared, ensure_ascii=True)
    row["allergens_present_json"] = json.dumps(present, ensure_ascii=True)
    row["allergens_may_contain_json"] = json.dumps(may_contain, ensure_ascii=True)
    row["image_url"] = image_url
    row["image_field"] = "front" if image_url else ""

    if not ingredient_items:
        append_error(errors, "ingredients:empty_after_parse")

    return finalize_row(row, errors, "labelinsight")


def scrape_scanbuy_page(landing_url: str, landing_html: str, timeout_seconds: int) -> dict[str, str]:
    row = build_empty_row(landing_url)
    row["http_status"] = "200"
    errors: list[str] = []
    soup = BeautifulSoup(landing_html, "html.parser")

    row["image_url"] = urljoin(landing_url, find_meta_content(soup, "og:image"))
    row["image_field"] = "front" if row["image_url"] else ""
    upc, rev = path_upc_and_rev(landing_url)
    row["smartlabel_upc"] = upc
    row["rev"] = rev

    product_id = extract_scanbuy_product_id(landing_html)
    if not product_id:
        append_error(errors, "scanbuy:missing_product_id")
        return finalize_row(row, errors, "scanbuy")

    base_url = landing_url.rsplit("/", 1)[0] + "/"
    row["smartlabel_url_ingredients"] = urljoin(base_url, f"{product_id}-ingredients.html")
    row["smartlabel_url_allergens"] = urljoin(base_url, f"{product_id}-allergens.html")

    allergens_status, allergens_html, allergens_error = fetch_url(row["smartlabel_url_allergens"], timeout_seconds)
    row["allergens_http_status"] = allergens_status
    if allergens_status == "200":
        declared, present, may_contain = parse_scanbuy_allergens_html(allergens_html)
        row["allergens_declared_json"] = json.dumps(declared, ensure_ascii=True)
        row["allergens_present_json"] = json.dumps(present, ensure_ascii=True)
        row["allergens_may_contain_json"] = json.dumps(may_contain, ensure_ascii=True)
    else:
        append_error(errors, f"allergens:{allergens_error or allergens_status or 'fetch_failed'}")

    safe_product = (
        row["allergens_http_status"] == "200"
        and row["allergens_declared_json"] == "[]"
        and row["allergens_present_json"] == "[]"
        and row["allergens_may_contain_json"] == "[]"
    )
    if safe_product:
        ingredients_status, ingredients_html, ingredients_error = fetch_url(row["smartlabel_url_ingredients"], timeout_seconds)
        row["ingredients_http_status"] = ingredients_status
        if ingredients_status == "200":
            ingredients_text, items = parse_scanbuy_ingredients_html(ingredients_html)
            row["ingredients_text"] = ingredients_text
            row["ingredients_items_json"] = json.dumps(items, ensure_ascii=True)
            if not items:
                append_error(errors, "ingredients:empty_after_parse")
        else:
            append_error(errors, f"ingredients:{ingredients_error or ingredients_status or 'fetch_failed'}")

    return finalize_row(row, errors, "scanbuy")


def scrape_syndigo_page(landing_url: str, landing_html: str) -> dict[str, str]:
    row = build_empty_row(landing_url)
    row["http_status"] = "200"
    row["smartlabel_url_ingredients"] = landing_url
    row["smartlabel_url_allergens"] = landing_url
    row["ingredients_http_status"] = "200"
    row["allergens_http_status"] = "200"
    errors: list[str] = []

    soup = BeautifulSoup(landing_html, "html.parser")
    row["smartlabel_upc"] = extract_syndigo_upc(soup)
    row["image_url"] = urljoin(landing_url, find_meta_content(soup, "og:image"))
    if not row["image_url"]:
        image_tag = soup.select_one('[data-id="image__front"]')
        if image_tag and image_tag.get("src"):
            row["image_url"] = urljoin(landing_url, as_text(image_tag.get("src")))
    row["image_field"] = "front" if row["image_url"] else ""

    ingredients_text, items = parse_syndigo_ingredients_html(landing_html)
    declared, present, may_contain = parse_syndigo_allergens_html(landing_html)
    row["ingredients_text"] = ingredients_text
    row["ingredients_items_json"] = json.dumps(items, ensure_ascii=True)
    row["allergens_declared_json"] = json.dumps(declared, ensure_ascii=True)
    row["allergens_present_json"] = json.dumps(present, ensure_ascii=True)
    row["allergens_may_contain_json"] = json.dumps(may_contain, ensure_ascii=True)

    if not items:
        append_error(errors, "ingredients:empty_after_parse")

    return finalize_row(row, errors, "syndigo")


def scrape_bestchoice_page(landing_url: str, landing_html: str) -> dict[str, str]:
    row = build_empty_row(landing_url)
    row["http_status"] = "200"
    row["smartlabel_url_ingredients"] = landing_url
    row["smartlabel_url_allergens"] = landing_url
    row["ingredients_http_status"] = "200"
    errors: list[str] = []

    soup = BeautifulSoup(landing_html, "html.parser")
    row["smartlabel_upc"] = extract_bestchoice_upc(soup)
    row["image_url"] = urljoin(landing_url, find_meta_content(soup, "og:image"))
    if not row["image_url"]:
        image_tag = soup.select_one(".productImg")
        if image_tag and image_tag.get("src"):
            row["image_url"] = urljoin(landing_url, as_text(image_tag.get("src")))
    row["image_field"] = "front" if row["image_url"] else ""

    ingredients_text, items = parse_bestchoice_ingredients_html(landing_html)
    declared, present, may_contain, explicit_rows = parse_bestchoice_allergens_html(landing_html)
    row["ingredients_text"] = ingredients_text
    row["ingredients_items_json"] = json.dumps(items, ensure_ascii=True)
    if explicit_rows:
        row["allergens_http_status"] = "200"
    else:
        row["allergens_http_status"] = "204"
        append_error(errors, "allergens:missing_explicit_status_rows")
    row["allergens_declared_json"] = json.dumps(declared, ensure_ascii=True)
    row["allergens_present_json"] = json.dumps(present, ensure_ascii=True)
    row["allergens_may_contain_json"] = json.dumps(may_contain, ensure_ascii=True)

    if not items:
        append_error(errors, "ingredients:empty_after_parse")

    return finalize_row(row, errors, "bestchoice")


def scrape_generalmills_page(landing_url: str, landing_html: str, timeout_seconds: int) -> dict[str, str]:
    row = build_empty_row(landing_url)
    row["http_status"] = "200"
    errors: list[str] = []
    soup = BeautifulSoup(landing_html, "html.parser")
    base_url = "https://smartlabel.generalmills.com"

    gtin = extract_generalmills_gtin(landing_url) or extract_generalmills_gtin(
        as_text((soup.select_one("#hdnGTINId") or {}).get("value"))
    )
    row["smartlabel_upc"] = gtin
    row["smartlabel_url_ingredients"] = f"{base_url}/GTIN/Ingredients"
    row["smartlabel_url_allergens"] = f"{base_url}/GTIN/Allergens"

    product_info_status, product_info_html, product_info_error = fetch_url(
        f"{base_url}/GTIN/ProductInfo?gtinID={gtin}",
        timeout_seconds,
    )
    if product_info_status == "200":
        product_info_soup = BeautifulSoup(product_info_html, "html.parser")
        image_tag = product_info_soup.select_one(".product-image")
        if image_tag and image_tag.get("src"):
            row["image_url"] = urljoin(landing_url, as_text(image_tag.get("src")))
            row["image_field"] = "front"
        if not row["smartlabel_upc"]:
            row["smartlabel_upc"] = extract_generalmills_gtin(product_info_html)
    else:
        append_error(errors, f"product_info:{product_info_error or product_info_status or 'fetch_failed'}")

    form_data = {"id": gtin, "isNutri": "true"}
    ingredients_status, ingredients_html, ingredients_error = fetch_url(
        row["smartlabel_url_ingredients"], timeout_seconds
    )
    if ingredients_status != "200":
        ingredients_status, ingredients_html, ingredients_error = fetch_form_url(
            row["smartlabel_url_ingredients"], form_data, timeout_seconds
        )
    row["ingredients_http_status"] = ingredients_status
    if ingredients_status == "200":
        ingredients_text, items = parse_generalmills_ingredients_html(ingredients_html)
        row["ingredients_text"] = ingredients_text
        row["ingredients_items_json"] = json.dumps(items, ensure_ascii=True)
        if not items:
            append_error(errors, "ingredients:empty_after_parse")
    else:
        append_error(errors, f"ingredients:{ingredients_error or ingredients_status or 'fetch_failed'}")

    allergens_status, allergens_html, allergens_error = fetch_url(row["smartlabel_url_allergens"], timeout_seconds)
    if allergens_status != "200":
        allergens_status, allergens_html, allergens_error = fetch_form_url(
            row["smartlabel_url_allergens"], form_data, timeout_seconds
        )
    row["allergens_http_status"] = allergens_status
    if allergens_status == "200":
        declared, present, may_contain = parse_generalmills_allergens_html(allergens_html)
        row["allergens_declared_json"] = json.dumps(declared, ensure_ascii=True)
        row["allergens_present_json"] = json.dumps(present, ensure_ascii=True)
        row["allergens_may_contain_json"] = json.dumps(may_contain, ensure_ascii=True)
    else:
        append_error(errors, f"allergens:{allergens_error or allergens_status or 'fetch_failed'}")

    return finalize_row(row, errors, "generalmills")


def scrape_hormel_page(landing_url: str, landing_html: str) -> dict[str, str]:
    row = build_empty_row(landing_url)
    row["http_status"] = "200"
    row["smartlabel_url_ingredients"] = landing_url
    row["smartlabel_url_allergens"] = landing_url
    row["ingredients_http_status"] = "200"
    row["allergens_http_status"] = "200"
    errors: list[str] = []

    soup = BeautifulSoup(landing_html, "html.parser")
    row["smartlabel_upc"] = extract_generalmills_gtin(landing_url) or extract_generalmills_gtin(
        normalize_spaces((soup.select_one(".image-gtin-container p") or soup).get_text(" ", strip=True))
    )
    image_tag = soup.select_one(".product-image")
    if image_tag and image_tag.get("src"):
        row["image_url"] = urljoin(landing_url, as_text(image_tag.get("src")))
        row["image_field"] = "front"

    ingredients_text, items = parse_hormel_ingredients_html(landing_html)
    declared, present, may_contain = parse_hormel_allergens_html(landing_html)
    row["ingredients_text"] = ingredients_text
    row["ingredients_items_json"] = json.dumps(items, ensure_ascii=True)
    row["allergens_declared_json"] = json.dumps(declared, ensure_ascii=True)
    row["allergens_present_json"] = json.dumps(present, ensure_ascii=True)
    row["allergens_may_contain_json"] = json.dumps(may_contain, ensure_ascii=True)

    if not items:
        append_error(errors, "ingredients:empty_after_parse")

    return finalize_row(row, errors, "hormel")


def scrape_pg_page(landing_url: str, timeout_seconds: int) -> dict[str, str]:
    row = build_empty_row(landing_url)
    row["http_status"] = "200"
    row["smartlabel_url_ingredients"] = landing_url
    row["smartlabel_url_allergens"] = landing_url
    errors: list[str] = []

    locale, gtin = extract_pg_locale_and_gtin(landing_url)
    row["smartlabel_upc"] = gtin
    api_url = f"{PG_PRODUCT_DETAILS_URL}?gtin={gtin}&locale={locale or 'en-US'}"
    status, payload, error = fetch_json_with_headers(
        api_url,
        timeout_seconds,
        headers={"x-functions-key": PG_FUNCTIONS_KEY},
    )
    row["ingredients_http_status"] = status
    row["allergens_http_status"] = status
    if status != "200" or not isinstance(payload, dict):
        append_error(errors, f"pg_api:{error or status or 'fetch_failed'}")
        return finalize_row(row, errors, "pg")

    (
        ingredients_text,
        ingredient_items,
        declared,
        present,
        may_contain,
        image_url,
    ) = parse_pg_product_payload(payload)
    row["ingredients_text"] = ingredients_text
    row["ingredients_items_json"] = json.dumps(ingredient_items, ensure_ascii=True)
    row["allergens_declared_json"] = json.dumps(declared, ensure_ascii=True)
    row["allergens_present_json"] = json.dumps(present, ensure_ascii=True)
    row["allergens_may_contain_json"] = json.dumps(may_contain, ensure_ascii=True)
    row["image_url"] = image_url
    row["image_field"] = "front" if image_url else ""

    if not ingredient_items:
        append_error(errors, "ingredients:empty_after_parse")

    return finalize_row(row, errors, "pg")


def scrape_rbnainfo_page(landing_url: str, landing_html: str) -> dict[str, str]:
    row = build_empty_row(landing_url)
    row["http_status"] = "200"
    row["smartlabel_url_ingredients"] = landing_url
    row["smartlabel_url_allergens"] = landing_url
    row["ingredients_http_status"] = "200"
    row["allergens_http_status"] = "200"
    errors: list[str] = []

    soup = BeautifulSoup(landing_html, "html.parser")
    upc_node = soup.select_one(".header-upcs td")
    row["smartlabel_upc"] = extract_generalmills_gtin(upc_node.get_text(" ", strip=True) if upc_node else landing_url)
    image_tag = soup.select_one(".product-image img")
    if image_tag and image_tag.get("src"):
        row["image_url"] = urljoin(landing_url, as_text(image_tag.get("src")))
        row["image_field"] = "front"

    ingredients_text, items = parse_rbnainfo_ingredients_html(landing_html)
    row["ingredients_text"] = ingredients_text
    row["ingredients_items_json"] = json.dumps(items, ensure_ascii=True)

    if not items:
        append_error(errors, "ingredients:empty_after_parse")

    return finalize_row(row, errors, "rbnainfo")


def scrape_url(url: str, timeout_seconds: int) -> dict[str, str]:
    host = urlparse(url).netloc.lower()
    if host == "smartlabel.labelinsight.com":
        return scrape_labelinsight_page(url, timeout_seconds)

    status, html, error = fetch_url(url, timeout_seconds)
    row = build_empty_row(url)
    row["http_status"] = status
    if status != "200":
        row["notes"] = "fetch_failed"
        row["smartlabel_error"] = error or status or "fetch_failed"
        return row

    if host == "smartlabel.generalmills.com":
        return scrape_generalmills_page(url, html, timeout_seconds)
    if host == "smartlabel.hormelfoods.com":
        return scrape_hormel_page(url, html)
    if host == "smartlabel.pg.com":
        return scrape_pg_page(url, timeout_seconds)
    if host in {"www.rbnainfo.com", "rbnainfo.com"}:
        return scrape_rbnainfo_page(url, html)
    if extract_scanbuy_product_id(html):
        return scrape_scanbuy_page(url, html, timeout_seconds)
    if 'data-name="ingredients"' in html or "data-name='ingredients'" in html:
        return scrape_syndigo_page(url, html)
    if "#ingredients" in html and "allergen-list" in html:
        return scrape_bestchoice_page(url, html)

    row["notes"] = "unsupported"
    row["smartlabel_error"] = "unsupported_template"
    return row


def row_needs_refresh(row: dict[str, str] | None) -> bool:
    if row is None:
        return True
    host = urlparse(as_text(row.get("smartlabel_url"))).netloc.lower()
    if host == "smartlabel.labelinsight.com":
        return False
    if as_text(row.get("http_status")) != "200":
        return True
    ingredients = parse_json_list(row.get("ingredients_items_json"))
    declared = parse_json_list(row.get("allergens_declared_json"))
    present = parse_json_list(row.get("allergens_present_json"))
    may_contain = parse_json_list(row.get("allergens_may_contain_json"))
    if ingredients or declared or present or may_contain:
        return False
    return True


def discover_sitemap_urls(host: str, timeout_seconds: int) -> list[str]:
    sitemap_url = f"https://{host}/sitemap.xml"
    status, body, _ = fetch_url(sitemap_url, timeout_seconds)
    if status != "200" or "<urlset" not in body:
        return []
    root = ET.fromstring(body)
    return [as_text(node.text) for node in root.findall("sm:url/sm:loc", SITEMAP_NS) if as_text(node.text)]


def discover_search_api_urls(
    timeout_seconds: int,
    pages: int,
    host_filter: set[str],
) -> list[str]:
    discovered: list[str] = []
    seen: set[str] = set()
    for page in range(1, pages + 1):
        url = f"{SEARCH_API_URL}?perPage={DEFAULT_SEARCH_API_PER_PAGE}&page={page}"
        status, payload, error = fetch_json(url, timeout_seconds)
        if status != "200" or not isinstance(payload, dict):
            raise RuntimeError(f"Search API page {page} failed: {error or status}")
        data = payload.get("data") or {}
        for item in data.get("data") or []:
            if not isinstance(item, dict):
                continue
            candidate = as_text(item.get("url"))
            if not candidate:
                continue
            host = urlparse(candidate).netloc.lower()
            if host_filter and host not in host_filter:
                continue
            if candidate in seen:
                continue
            seen.add(candidate)
            discovered.append(candidate)
    return discovered


def build_scrape_queue(
    existing_by_url: dict[str, dict[str, str]],
    hosts: list[str],
    timeout_seconds: int,
    max_per_host: int,
    max_total: int,
    search_api_pages: int,
    search_api_hosts: set[str],
) -> tuple[list[str], dict[str, int]]:
    queue: list[str] = []
    per_host_counts: dict[str, int] = {}
    seen: set[str] = set()

    for host in hosts:
        discovered = discover_sitemap_urls(host, timeout_seconds)
        per_host_counts[host] = len(discovered)
        kept_for_host = 0
        for url in discovered:
            if max_per_host and kept_for_host >= max_per_host:
                break
            if max_total and len(queue) >= max_total:
                break
            if url in seen:
                continue
            existing_row = existing_by_url.get(url)
            if existing_row and not row_needs_refresh(existing_row):
                continue
            queue.append(url)
            seen.add(url)
            kept_for_host += 1
        if max_total and len(queue) >= max_total:
            break

    if search_api_pages and (not max_total or len(queue) < max_total):
        search_urls = discover_search_api_urls(
            timeout_seconds=timeout_seconds,
            pages=search_api_pages,
            host_filter=search_api_hosts,
        )
        per_host_counts["search_api"] = len(search_urls)
        for url in search_urls:
            if max_total and len(queue) >= max_total:
                break
            if url in seen:
                continue
            existing_row = existing_by_url.get(url)
            if existing_row and not row_needs_refresh(existing_row):
                continue
            queue.append(url)
            seen.add(url)

    for url, row in existing_by_url.items():
        if max_total and len(queue) >= max_total:
            break
        if url in seen or not row_needs_refresh(row):
            continue
        if urlparse(url).netloc.lower() == "smartlabel.labelinsight.com":
            continue
        queue.append(url)
        seen.add(url)

    return queue, per_host_counts


def merge_rows(
    existing_rows: list[dict[str, str]],
    scraped_rows: dict[str, dict[str, str]],
) -> list[dict[str, str]]:
    merged: list[dict[str, str]] = []
    handled: set[str] = set()

    for row in existing_rows:
        url = as_text(row.get("smartlabel_url"))
        scraped = scraped_rows.get(url)
        if scraped:
            merged.append(scraped)
            handled.add(url)
        else:
            merged.append({field: as_text(row.get(field)) for field in CSV_FIELDNAMES})

    for url, row in scraped_rows.items():
        if url in handled:
            continue
        merged.append(row)

    return merged


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    summary_path = Path(args.summary_output)
    hosts = hosts_from_arg(args.hosts)

    existing_rows = load_csv_rows(input_path)
    fieldnames = ensure_fieldnames(existing_rows)
    existing_by_url = {as_text(row.get("smartlabel_url")): dict(row) for row in existing_rows if as_text(row.get("smartlabel_url"))}

    queue, discovered_by_host = build_scrape_queue(
        existing_by_url=existing_by_url,
        hosts=hosts,
        timeout_seconds=args.timeout_seconds,
        max_per_host=args.max_per_host,
        max_total=args.max_total,
        search_api_pages=max(0, args.search_api_pages),
        search_api_hosts=set(hosts_from_arg(args.search_api_hosts)),
    )

    scraped_rows: dict[str, dict[str, str]] = {}
    scrape_stats = Counter()
    total = len(queue)
    print(f"SmartLabel scrape queue: {total} URLs")

    with ThreadPoolExecutor(max_workers=max(1, args.max_workers)) as executor:
        future_map = {executor.submit(scrape_url, url, args.timeout_seconds): url for url in queue}
        completed = 0
        for future in as_completed(future_map):
            url = future_map[future]
            completed += 1
            try:
                row = future.result()
            except Exception as exc:  # pragma: no cover - defensive logging path
                row = build_empty_row(url)
                row["notes"] = "exception"
                row["smartlabel_error"] = str(exc)
            scraped_rows[url] = row

            host = urlparse(url).netloc.lower()
            scrape_stats[f"host::{host}"] += 1
            if row.get("notes") == SAFE_NOTES:
                scrape_stats["ok"] += 1
            if parse_json_list(row.get("ingredients_items_json")):
                scrape_stats["rows_with_ingredients"] += 1
            if row.get("allergens_http_status") == "200":
                declared = parse_json_list(row.get("allergens_declared_json"))
                present = parse_json_list(row.get("allergens_present_json"))
                may_contain = parse_json_list(row.get("allergens_may_contain_json"))
                if not declared and not present and not may_contain:
                    scrape_stats["safe_rows"] += 1
            if completed % 100 == 0 or completed == total:
                print(f"Scraped {completed}/{total} SmartLabel URLs...")

    merged_rows = merge_rows(existing_rows, scraped_rows)
    write_csv_rows(output_path, fieldnames, merged_rows)

    summary = {
        "input_file": str(input_path.resolve()),
        "output_file": str(output_path.resolve()),
        "existing_row_count": len(existing_rows),
        "output_row_count": len(merged_rows),
        "scrape_queue_count": total,
        "sitemap_discovered_by_host": discovered_by_host,
        "scrape_stats": dict(scrape_stats),
    }
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")

    print("SmartLabel scrape complete.")
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
