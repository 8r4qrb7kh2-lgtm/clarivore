#!/usr/bin/env python3
"""Build a safe-only ingredient catalog from the Open Food Facts bulk export."""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import DefaultDict, Dict, Iterable, Iterator, List, Sequence, Set, Tuple


DEFAULT_DOWNLOAD_URL = "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz"
DEFAULT_INPUT = "ml/data/raw/en.openfoodfacts.org.products.csv.gz"
DEFAULT_OUTPUT = "ml/seeds/ingredient_catalog_seed.jsonl"
DEFAULT_SUMMARY_OUTPUT = "ml/seeds/ingredient_catalog_seed_summary.json"
DEFAULT_LIMIT = 0
DEFAULT_ALIAS_LIMIT = 12
DEFAULT_MIN_SUPPORT = 2
DEFAULT_COUNTRY_TAG = "en:united-states"
DEFAULT_USER_AGENT = "Clarivore/1.0 (ingredient catalog rebuild; matt@clarivore.app)"
DEFAULT_TIMEOUT = 120.0

SEED_SOURCE = "openfoodfacts_safe_only_v1"
EXTRACTION_VERSION = "off_safe_only_v1"

SUPPORTED_DIETS: Tuple[str, ...] = (
    "Vegan",
    "Vegetarian",
    "Pescatarian",
    "Gluten-free",
)

SPACE_RE = re.compile(r"\s+")
PERCENT_RE = re.compile(r"\b\d+(?:\.\d+)?%\b")
BRACKET_RE = re.compile(r"[\[\]{}]")
PAREN_CONTENT_RE = re.compile(r"\(([^()]*)\)")
BOUNDARY_RE_TEMPLATE = r"(?<![a-z0-9]){value}(?![a-z0-9])"

CONTAINS_PATTERNS: Sequence[re.Pattern[str]] = (
    re.compile(r"\bcontains\b\s*[:\-]?\s*([^.;\n]+)", re.IGNORECASE),
    re.compile(r"\bmay contain\b\s*[:\-]?\s*([^.;\n]+)", re.IGNORECASE),
    re.compile(
        r"\bcontains one or more of the following\b\s*[:\-]?\s*([^.;\n]+)",
        re.IGNORECASE,
    ),
    re.compile(r"\btraces of\b\s*[:\-]?\s*([^.;\n]+)", re.IGNORECASE),
    re.compile(
        r"\bprocessed in a facility(?: that)? (?:also )?(?:processes|handles)\b\s*[:\-]?\s*([^.;\n]+)",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bmanufactured on shared equipment with\b\s*[:\-]?\s*([^.;\n]+)",
        re.IGNORECASE,
    ),
)

STOP_PREFIXES: Sequence[str] = (
    "ingredients",
    "ingredient",
    "contains 2% or less of",
    "contains less than 2% of",
    "less than 2% of",
    "2% or less of",
    "one or more of the following",
    "allergen information",
    "made with",
)

NOISE_TERMS: Set[str] = {
    "and",
    "or",
    "of",
    "the",
    "for freshness",
    "to preserve freshness",
    "to retain freshness",
}

QUALIFIER_PREFIXES: Tuple[str, ...] = (
    "organic",
    "fresh",
    "raw",
    "dry",
    "dried",
    "dehydrated",
    "freeze dried",
    "frozen",
    "pasteurized",
    "cultured",
)

IRREGULAR_SINGULARS: Dict[str, str] = {
    "berries": "berry",
    "carrots": "carrot",
    "cultures": "culture",
    "eggs": "egg",
    "flowers": "flower",
    "leaves": "leaf",
    "onions": "onion",
    "potatoes": "potato",
    "tomatoes": "tomato",
}

PLURAL_EXCEPTIONS: Set[str] = {
    "couscous",
    "cress",
    "glass",
    "grass",
    "hummus",
    "molasses",
}

AMBIGUOUS_EXACT_TERMS: Set[str] = {
    "artificial flavor",
    "artificial flavors",
    "color",
    "colors",
    "culture",
    "cultures",
    "enzyme",
    "enzymes",
    "extract",
    "extracts",
    "flavor",
    "flavoring",
    "leavening",
    "natural and artificial flavor",
    "natural and artificial flavors",
    "natural flavor",
    "natural flavors",
    "preservative",
    "preservatives",
    "seasoning",
    "seasonings",
    "spice",
    "spices",
    "starch",
    "vegetable oil",
    "vegetable shortening",
}

AMBIGUOUS_PREFIX_TERMS: Tuple[str, ...] = (
    "flavor ",
    "flavoring ",
    "seasoning ",
    "seasonings ",
    "spice ",
    "spices ",
)

AMBIGUOUS_SUFFIX_TERMS: Tuple[str, ...] = (
    " flavor",
    " flavors",
)

READY_EXACT_EXCEPTIONS: Set[str] = {
    "fish sauce",
}

PRODUCT_STYLE_EXACT_TERMS: Set[str] = {
    "animal cracker",
    "batter",
    "biscuit",
    "bread",
    "cake",
    "cornbread",
    "cookie",
    "cracker",
    "dressing",
    "dumpling",
    "english muffin",
    "flatbread",
    "flour tortilla",
    "imitation crabmeat",
    "mix",
    "pita bread",
    "pizza crust",
    "ravioli",
    "rotini pasta",
    "sauce",
    "seafood stuffing",
    "seasoned crouton",
    "surimi",
}

PRODUCT_STYLE_SUFFIX_TERMS: Tuple[str, ...] = (
    " batter",
    " bread",
    " brownie",
    " brownie mix",
    " cake",
    " cake mix",
    " cookie",
    " cracker",
    " crouton",
    " crust",
    " dressing",
    " dumpling",
    " english muffin",
    " flatbread",
    " flour tortilla",
    " granola",
    " mix",
    " muffin",
    " pasta",
    " pita bread",
    " pizza crust",
    " ravioli",
    " roll",
    " salad",
    " sauce",
    " stuffing",
    " surimi",
    " tortilla",
    " wrap",
)

REJECT_SUBSTRINGS: Tuple[str, ...] = (
    "added to preserve freshness",
    "carefully chosen ingredients",
    "ingredients not in regular",
    "preserve freshness",
    "to preserve freshness",
    "www.",
    "http://",
    "https://",
)

SHORT_CODE_RE = re.compile(r"^[a-z]\d{1,2}$", re.IGNORECASE)

MEAT_TERMS: Tuple[str, ...] = (
    "bacon",
    "beef",
    "beef stock",
    "beef broth",
    "bone broth",
    "broth concentrate",
    "chicken",
    "chicken stock",
    "chicken broth",
    "duck",
    "ham",
    "lamb",
    "meat",
    "pork",
    "pork stock",
    "poultry",
    "sausage",
    "turkey",
    "veal",
)

VEGAN_ONLY_BLOCKERS: Tuple[str, ...] = (
    "beeswax",
    "carmine",
    "honey",
    "lanolin",
    "royal jelly",
    "shellac",
)

ALL_DIET_BLOCKERS: Tuple[str, ...] = (
    "animal fat",
    "animal shortening",
    "collagen",
    "gelatin",
    "lard",
    "rennet",
    "suet",
    "tallow",
)

GLUTEN_BLOCKERS: Tuple[str, ...] = (
    "barley",
    "brewer's yeast",
    "brewers yeast",
    "bulgur",
    "couscous",
    "durum",
    "einkorn",
    "emmer",
    "farina",
    "farro",
    "graham",
    "kamut",
    "malt",
    "matzo",
    "rye",
    "seitan",
    "semolina",
    "spelt",
    "triticale",
    "wheat",
)

MILK_TERMS: Tuple[str, ...] = (
    "butter",
    "buttermilk",
    "casein",
    "caseinate",
    "cheese",
    "cream",
    "curd",
    "ghee",
    "half and half",
    "half-and-half",
    "kefir",
    "lactose",
    "milk",
    "milkfat",
    "milk solids",
    "nonfat dry milk",
    "skim milk",
    "sour cream",
    "whey",
    "yogurt",
    "yoghurt",
)

MILK_FALSE_POSITIVE_EXACT_TERMS: Set[str] = {
    "cream corn",
    "cream of tartar",
}

SAFE_ONLY_EXACT_EXCEPTIONS: Set[str] = {
    "cream of tartar",
    "eggplant",
    "eggplants",
}

SAFE_ONLY_COMPACT_EXCEPTIONS: Tuple[str, ...] = (
    "buckwheat",
    "wheatgrass",
)

EGG_TERMS: Tuple[str, ...] = (
    "aioli",
    "albumen",
    "albumin",
    "egg",
    "lysozyme",
    "mayonnaise",
    "meringue",
    "ovalbumin",
)

PEANUT_TERMS: Tuple[str, ...] = (
    "groundnut",
    "peanut",
)

TREE_NUT_TERMS: Tuple[str, ...] = (
    "almond",
    "brazil nut",
    "cashew",
    "chestnut",
    "coconut",
    "hazelnut",
    "macadamia",
    "marzipan",
    "pecan",
    "pine nut",
    "pistachio",
    "praline",
    "tree nut",
    "walnut",
)

SOY_TERMS: Tuple[str, ...] = (
    "bean curd",
    "edamame",
    "miso",
    "natto",
    "shoyu",
    "soy",
    "soya",
    "soybean",
    "tamari",
    "tempeh",
    "textured vegetable protein",
    "tofu",
)

SESAME_TERMS: Tuple[str, ...] = (
    "benne",
    "gingelly",
    "sesame",
    "tahini",
    "til",
)

FISH_TERMS: Tuple[str, ...] = (
    "anchovy",
    "anchovies",
    "bass",
    "bonito",
    "cod",
    "fish",
    "haddock",
    "mackerel",
    "mahi",
    "pollock",
    "sardine",
    "salmon",
    "snapper",
    "surimi",
    "tilapia",
    "trout",
    "tuna",
    "worcestershire",
)

SHELLFISH_TERMS: Tuple[str, ...] = (
    "abalone",
    "clam",
    "crab",
    "crawfish",
    "crayfish",
    "cuttlefish",
    "krill",
    "lobster",
    "mollusk",
    "mollusc",
    "mussel",
    "octopus",
    "oyster",
    "prawn",
    "scallop",
    "shellfish",
    "shrimp",
    "squid",
)

PLANT_BASES: Tuple[str, ...] = (
    "almond",
    "apple",
    "cashew",
    "cocoa",
    "coconut",
    "cookie",
    "hazelnut",
    "hemp",
    "macadamia",
    "oat",
    "pea",
    "peanut",
    "pecan",
    "pistachio",
    "pumpkin seed",
    "rice",
    "sesame",
    "soy",
    "sunflower",
    "walnut",
)

TREE_NUT_COMPACT_TERMS: Tuple[str, ...] = (
    "almond",
    "brazilnut",
    "cashew",
    "chestnut",
    "coconut",
    "hazelnut",
    "macadamia",
    "nutmilk",
    "pecan",
    "pinenut",
    "pistachio",
    "praline",
    "treenut",
    "walnut",
)

PEANUT_COMPACT_TERMS: Tuple[str, ...] = (
    "groundnut",
    "peanut",
)

SOY_COMPACT_TERMS: Tuple[str, ...] = (
    "edamame",
    "miso",
    "natto",
    "shoyu",
    "soy",
    "soya",
    "soybean",
    "tamari",
    "tempeh",
    "tofu",
)

SESAME_COMPACT_TERMS: Tuple[str, ...] = (
    "benne",
    "gingelly",
    "sesame",
    "tahini",
)

EGG_COMPACT_TERMS: Tuple[str, ...] = (
    "aioli",
    "albumen",
    "albumin",
    "egg",
    "lysozyme",
    "mayonnaise",
    "meringue",
    "ovalbumin",
)

FISH_COMPACT_TERMS: Tuple[str, ...] = (
    "anchovy",
    "bass",
    "bonito",
    "catfish",
    "cod",
    "fish",
    "haddock",
    "lumpfish",
    "mahi",
    "mackerel",
    "pollock",
    "salmon",
    "sardine",
    "snapper",
    "surimi",
    "swordfish",
    "tilapia",
    "trout",
    "tuna",
    "whitefish",
)

SHELLFISH_COMPACT_TERMS: Tuple[str, ...] = (
    "abalone",
    "clam",
    "crab",
    "crawfish",
    "crayfish",
    "cuttlefish",
    "krill",
    "lobster",
    "mollusc",
    "mollusk",
    "mussel",
    "octopus",
    "oyster",
    "prawn",
    "scallop",
    "shellfish",
    "shrimp",
    "squid",
)

GLUTEN_COMPACT_TERMS: Tuple[str, ...] = (
    "barley",
    "gluten",
    "rye",
    "spelt",
    "triticale",
    "wheat",
)

MILK_COMPACT_TERMS: Tuple[str, ...] = (
    "buttermilk",
    "casein",
    "caseinate",
    "cheese",
    "curd",
    "dairy",
    "ghee",
    "kefir",
    "lactose",
    "milk",
    "milkfat",
    "milksolid",
    "whey",
    "yoghurt",
    "yogurt",
)

BLOCKED_ANALYSIS_TAGS: Tuple[str, ...] = (
    "en:non-vegan",
    "en:non-vegetarian",
    "en:non-pescatarian",
)

NOISY_SUBSTRINGS: Tuple[str, ...] = (
    " agr",
    " ajr ",
    " www.",
    " http",
    " // ",
)

def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a safe-only ingredient catalog from OFF.")
    parser.add_argument("--input", default=DEFAULT_INPUT)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--summary-output", default=DEFAULT_SUMMARY_OUTPUT)
    parser.add_argument("--download-url", default=DEFAULT_DOWNLOAD_URL)
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--alias-limit", type=int, default=DEFAULT_ALIAS_LIMIT)
    parser.add_argument("--min-support", type=int, default=DEFAULT_MIN_SUPPORT)
    parser.add_argument("--country-tag", default=DEFAULT_COUNTRY_TAG)
    parser.add_argument("--min-text-len", type=int, default=12)
    parser.add_argument("--sample-limit", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT)
    parser.add_argument("--force-download", action="store_true")
    parser.add_argument(
        "--no-download",
        action="store_true",
        help="Fail if --input is missing instead of downloading the official OFF export.",
    )
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    return parser.parse_args(argv)


def as_text(value: object) -> str:
    return str(value or "").strip()


def ascii_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def normalize_spaces(value: str) -> str:
    return SPACE_RE.sub(" ", value).strip(" .,:;-/")


def normalize_lookup_term(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", ascii_text(value).lower()).strip()


def compact_lookup_term(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", ascii_text(value).lower())


def stable_unique(values: Iterable[object]) -> List[str]:
    out: List[str] = []
    seen: Set[str] = set()
    for value in values:
        safe = as_text(value)
        if not safe or safe in seen:
            continue
        seen.add(safe)
        out.append(safe)
    return out


def write_jsonl(path: Path, rows: Sequence[Dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False))
            handle.write("\n")


def write_json(path: Path, payload: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def maybe_download_file(
    *,
    url: str,
    output_path: Path,
    timeout: float,
    force_download: bool,
    skip_download: bool,
    user_agent: str,
) -> Dict[str, object]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists() and not force_download:
        return {"downloaded": False, "bytes_written": int(output_path.stat().st_size)}

    if skip_download:
        raise RuntimeError(f"OFF snapshot missing: {output_path}")

    temp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    if temp_path.exists():
        temp_path.unlink()

    request = urllib.request.Request(
        url,
        method="GET",
        headers={"User-Agent": user_agent},
    )

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
        raise RuntimeError(f"OFF download failed: {error}") from error

    os.replace(temp_path, output_path)
    return {"downloaded": True, "bytes_written": bytes_written}


def iter_off_rows(path: Path) -> Iterator[Dict[str, object]]:
    path_name = path.name.lower()
    opener = gzip.open if path.suffix == ".gz" else open

    if path_name.endswith(".jsonl") or path_name.endswith(".jsonl.gz"):
        with opener(path, "rt", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line:
                    continue
                payload = json.loads(line)
                if isinstance(payload, dict):
                    yield payload
        return

    if path_name.endswith(".csv") or path_name.endswith(".csv.gz"):
        field_limit = sys.maxsize
        while True:
            try:
                csv.field_size_limit(field_limit)
                break
            except OverflowError:
                field_limit //= 10
        with opener(path, "rt", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            for row in reader:
                if isinstance(row, dict):
                    yield row
        return

    raise RuntimeError(f"Unsupported OFF input format: {path}")


def split_field_values(value: object) -> List[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return stable_unique(value)
    safe = as_text(value)
    if not safe:
        return []
    return stable_unique(part.strip() for part in safe.split(","))


def first_present_field(product: Dict[str, object], *field_names: str) -> List[str]:
    for field_name in field_names:
        values = split_field_values(product.get(field_name))
        if values:
            return values
    return []


def split_top_level(text: str) -> List[str]:
    parts: List[str] = []
    current: List[str] = []
    depth = 0

    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")" and depth > 0:
            depth -= 1

        if depth == 0 and ch in ",;":
            part = "".join(current).strip()
            if part:
                parts.append(part)
            current = []
            continue

        current.append(ch)

    tail = "".join(current).strip()
    if tail:
        parts.append(tail)
    return parts


def clean_candidate(part: str) -> str:
    cleaned = ascii_text(part).lower()
    cleaned = PERCENT_RE.sub("", cleaned)
    cleaned = BRACKET_RE.sub(" ", cleaned)
    cleaned = cleaned.replace("&", " and ")
    cleaned = normalize_spaces(cleaned)

    for prefix in STOP_PREFIXES:
        with_colon = f"{prefix}:"
        with_space = f"{prefix} "
        if cleaned.startswith(with_colon):
            cleaned = cleaned[len(with_colon) :].strip()
        elif cleaned.startswith(with_space):
            cleaned = cleaned[len(with_space) :].strip()

    cleaned = re.sub(r"^\b(?:made from|derived from|with)\b\s+", "", cleaned)
    cleaned = re.sub(r"\bfor color\b", "", cleaned)
    cleaned = re.sub(r"\bfor freshness\b", "", cleaned)
    cleaned = normalize_spaces(cleaned)
    return cleaned


def strip_disclosure_segments(text: str) -> str:
    safe = as_text(text)
    for pattern in CONTAINS_PATTERNS:
        safe = pattern.sub("", safe)
    return safe


def extract_top_level_candidates(text: str) -> List[str]:
    safe = strip_disclosure_segments(text or "")
    safe = ascii_text(safe).replace("\n", ", ")
    out: List[str] = []
    for part in split_top_level(safe):
        cleaned = clean_candidate(part)
        if not cleaned or cleaned in NOISE_TERMS:
            continue
        if cleaned.endswith("(") or cleaned == ")":
            continue
        out.append(cleaned)
    return out


def singularize(token: str) -> str:
    if token in IRREGULAR_SINGULARS:
        return IRREGULAR_SINGULARS[token]
    if token in PLURAL_EXCEPTIONS or len(token) <= 3:
        return token
    if token.endswith("ies") and len(token) > 4:
        return token[:-3] + "y"
    if token.endswith("oes") and len(token) > 4:
        return token[:-2]
    if token.endswith("s") and not token.endswith(("ss", "us", "is")):
        return token[:-1]
    return token


def canonicalize_name(value: str) -> str:
    base = PAREN_CONTENT_RE.sub("", value)
    base = re.sub(r"\([^)]*$", " ", base)
    base = base.replace("(", " ").replace(")", " ")
    base = base.replace("*", " ")
    base = normalize_spaces(base)
    tokens = [token for token in base.split() if any(ch.isalnum() for ch in token)]

    for prefix in sorted(QUALIFIER_PREFIXES, key=len, reverse=True):
        prefix_tokens = prefix.split()
        if tokens[: len(prefix_tokens)] == prefix_tokens:
            tokens = tokens[len(prefix_tokens) :]
            break

    if tokens:
        tokens[-1] = singularize(tokens[-1])

    normalized = normalize_spaces(" ".join(tokens))
    return normalized


def should_keep_catalog_name(value: str) -> bool:
    safe = as_text(value)
    if len(safe) < 2:
        return False
    lowered = safe.lower()
    if SHORT_CODE_RE.match(safe):
        return False
    if lowered.startswith("ingredients "):
        return False
    if ":" in safe:
        return False
    if ". " in safe:
        return False
    if any(token in lowered for token in REJECT_SUBSTRINGS):
        return False
    if safe.startswith(("(", ")", "-", "*")):
        return False
    if len(safe.split()) > 18:
        return False
    return True


def compile_matchers(phrases: Iterable[str]) -> List[Tuple[str, re.Pattern[str]]]:
    compiled: List[Tuple[str, re.Pattern[str]]] = []
    for phrase in phrases:
        safe = normalize_lookup_term(phrase)
        if not safe:
            continue
        pattern = re.compile(
            BOUNDARY_RE_TEMPLATE.format(value=re.escape(safe)),
            re.IGNORECASE,
        )
        compiled.append((phrase, pattern))
    return compiled


def match_any(text: str, matchers: Sequence[Tuple[str, re.Pattern[str]]]) -> bool:
    return any(pattern.search(text) for _, pattern in matchers)


def contains_any_compact_term(text: str, terms: Sequence[str]) -> bool:
    compact = compact_lookup_term(text)
    return any(compact_lookup_term(term) in compact for term in terms)


def plant_dairy_exception(text: str) -> bool:
    compact = compact_lookup_term(text)
    for base in PLANT_BASES:
        safe_base = normalize_lookup_term(base)
        for suffix in (" milk ", " cream ", " cheese ", " yogurt ", " yoghurt ", " butter "):
            if f" {safe_base}{suffix}" in text:
                return True
        compact_base = compact_lookup_term(base)
        for suffix in ("milk", "cream", "cheese", "yogurt", "yoghurt", "butter"):
            if f"{compact_base}{suffix}" in compact:
                return True
    if (
        " non dairy " in text
        or " nondairy " in text
        or " dairy free " in text
        or "nondairy" in compact
        or "dairyfree" in compact
    ):
        return True
    if (
        " vegan butter " in text
        or " vegan cheese " in text
        or " vegan yogurt " in text
        or "veganbutter" in compact
        or "vegancheese" in compact
        or "veganyogurt" in compact
    ):
        return True
    return False


MILK_MATCHERS = compile_matchers(MILK_TERMS)
EGG_MATCHERS = compile_matchers(EGG_TERMS)
PEANUT_MATCHERS = compile_matchers(PEANUT_TERMS)
TREE_NUT_MATCHERS = compile_matchers(TREE_NUT_TERMS)
SOY_MATCHERS = compile_matchers(SOY_TERMS)
SESAME_MATCHERS = compile_matchers(SESAME_TERMS)
FISH_MATCHERS = compile_matchers(FISH_TERMS)
SHELLFISH_MATCHERS = compile_matchers(SHELLFISH_TERMS)
MEAT_MATCHERS = compile_matchers(MEAT_TERMS)
VEGAN_ONLY_MATCHERS = compile_matchers(VEGAN_ONLY_BLOCKERS)
ALL_DIET_BLOCKER_MATCHERS = compile_matchers(ALL_DIET_BLOCKERS)
GLUTEN_MATCHERS = compile_matchers(GLUTEN_BLOCKERS)

def is_product_style_name(name: str) -> bool:
    if name in READY_EXACT_EXCEPTIONS:
        return False
    if name in PRODUCT_STYLE_EXACT_TERMS:
        return True
    return any(name.endswith(suffix) for suffix in PRODUCT_STYLE_SUFFIX_TERMS)


def classify_candidate(name: str) -> Dict[str, object]:
    normalized = f" {normalize_lookup_term(name)} "
    compact = compact_lookup_term(name)
    allergens: Set[str] = set()
    blocked_diets: Set[str] = set()
    reason_codes: List[str] = []
    has_gluten_free_claim = " gluten free " in normalized or "glutenfree" in compact
    has_compact_exception = any(token in compact for token in SAFE_ONLY_COMPACT_EXCEPTIONS)

    if (
        (
            match_any(normalized, MILK_MATCHERS)
            or contains_any_compact_term(compact, MILK_COMPACT_TERMS)
        )
        and name not in MILK_FALSE_POSITIVE_EXACT_TERMS
        and name not in SAFE_ONLY_EXACT_EXCEPTIONS
        and not plant_dairy_exception(normalized)
    ):
        allergens.add("milk")
        blocked_diets.add("Vegan")
        reason_codes.append("allergen:milk")

    if (
        not compact.startswith("eggplant")
        and (
            match_any(normalized, EGG_MATCHERS)
            or contains_any_compact_term(compact, EGG_COMPACT_TERMS)
        )
    ):
        allergens.add("egg")
        blocked_diets.add("Vegan")
        reason_codes.append("allergen:egg")

    if match_any(normalized, PEANUT_MATCHERS) or contains_any_compact_term(
        compact, PEANUT_COMPACT_TERMS
    ):
        allergens.add("peanut")
        reason_codes.append("allergen:peanut")

    if match_any(normalized, TREE_NUT_MATCHERS) or contains_any_compact_term(
        compact, TREE_NUT_COMPACT_TERMS
    ):
        allergens.add("tree nut")
        reason_codes.append("allergen:tree_nut")

    if match_any(normalized, SOY_MATCHERS) or contains_any_compact_term(
        compact, SOY_COMPACT_TERMS
    ):
        allergens.add("soy")
        reason_codes.append("allergen:soy")

    if match_any(normalized, SESAME_MATCHERS) or contains_any_compact_term(
        compact, SESAME_COMPACT_TERMS
    ):
        allergens.add("sesame")
        reason_codes.append("allergen:sesame")

    if match_any(normalized, FISH_MATCHERS) or contains_any_compact_term(
        compact, FISH_COMPACT_TERMS
    ):
        allergens.add("fish")
        reason_codes.append("allergen:fish")

    if match_any(normalized, SHELLFISH_MATCHERS) or contains_any_compact_term(
        compact, SHELLFISH_COMPACT_TERMS
    ):
        allergens.add("shellfish")
        reason_codes.append("allergen:shellfish")

    if (
        not has_compact_exception
        and (
            match_any(normalized, GLUTEN_MATCHERS)
            or contains_any_compact_term(compact, GLUTEN_COMPACT_TERMS)
        )
        and not has_gluten_free_claim
    ):
        allergens.add("wheat")
        blocked_diets.add("Gluten-free")
        reason_codes.append("diet_block:gluten_free")

    if allergens.intersection({"milk", "egg", "fish", "shellfish"}):
        blocked_diets.add("Vegan")

    if allergens.intersection({"fish", "shellfish"}):
        blocked_diets.add("Vegetarian")

    if match_any(normalized, MEAT_MATCHERS):
        blocked_diets.update({"Vegan", "Vegetarian", "Pescatarian"})
        reason_codes.append("diet_block:meat")

    if match_any(normalized, VEGAN_ONLY_MATCHERS):
        blocked_diets.add("Vegan")
        reason_codes.append("diet_block:vegan_only")

    if match_any(normalized, ALL_DIET_BLOCKER_MATCHERS):
        blocked_diets.update({"Vegan", "Vegetarian", "Pescatarian"})
        reason_codes.append("diet_block:animal_derivative")

    if name in AMBIGUOUS_EXACT_TERMS or any(
        name.startswith(prefix) for prefix in AMBIGUOUS_PREFIX_TERMS
    ) or any(name.endswith(suffix) for suffix in AMBIGUOUS_SUFFIX_TERMS):
        reason_codes.append("review:ambiguous_generic")

    if " extract " in normalized and not allergens:
        reason_codes.append("review:generic_extract")

    if name.endswith(" oil") and name == "vegetable oil":
        reason_codes.append("review:generic_oil")

    if is_product_style_name(name):
        reason_codes.append("review:product_style")

    compatible_diets = [diet for diet in SUPPORTED_DIETS if diet not in blocked_diets]
    is_safe = not allergens and not blocked_diets and not reason_codes
    return {
        "allergens": sorted(allergens),
        "blocked_diets": sorted(blocked_diets),
        "diets": compatible_diets,
        "is_safe": is_safe,
        "reason_codes": sorted(set(reason_codes)),
    }


def is_reasonable_alias(canonical_name: str, alias: str) -> bool:
    if not alias:
        return False
    if alias.startswith("(") or len(alias) > 120:
        return False
    if alias.count(",") > 3 or alias.count(":") > 1:
        return False
    if alias == canonical_name:
        return True
    if alias.startswith(f"{canonical_name} "):
        return True
    if alias.startswith(f"{canonical_name}("):
        return True
    if any(alias.startswith(f"{prefix} {canonical_name}") for prefix in QUALIFIER_PREFIXES):
        return True
    normalized_alias = normalize_lookup_term(alias)
    normalized_canonical = normalize_lookup_term(canonical_name)
    if normalized_alias == normalized_canonical:
        return True
    if normalized_alias.endswith(f" {normalized_canonical}"):
        prefix = normalized_alias[: -len(normalized_canonical)].strip()
        if len(prefix.split()) <= 2:
            return True
    return False


def canonical_display_name_sort_key(
    name: str,
    *,
    support_count: int,
) -> Tuple[int, int, int, str]:
    punctuation_penalty = sum(
        1
        for ch in ascii_text(name)
        if not (ch.isalnum() or ch.isspace() or ch == "-")
    )
    return (-support_count, punctuation_penalty, len(name), name)


def product_has_country_tag(product: Dict[str, object], country_tag: str) -> bool:
    safe_tag = as_text(country_tag).lower()
    if not safe_tag:
        return True
    countries = [as_text(value).lower() for value in split_field_values(product.get("countries_tags"))]
    return safe_tag in countries


def has_blocked_analysis_tags(product: Dict[str, object]) -> bool:
    tags = {
        as_text(value).lower()
        for value in split_field_values(product.get("ingredients_analysis_tags"))
    }
    return any(tag in tags for tag in BLOCKED_ANALYSIS_TAGS)


def is_usable_english_like_text(text: str, *, min_text_len: int) -> bool:
    safe = as_text(text)
    if len(safe) < min_text_len:
        return False

    if any(token in safe.lower() for token in NOISY_SUBSTRINGS):
        return False

    alpha_count = sum(ch.isalpha() for ch in safe)
    if alpha_count < 3:
        return False

    ascii_alpha = sum(ch.isascii() and ch.isalpha() for ch in safe)
    if ascii_alpha / max(1, alpha_count) < 0.88:
        return False

    allowed_count = sum(
        ch.isascii()
        and (ch.isalnum() or ch.isspace() or ch in ".,;:%()[]/&-+'\"")
        for ch in safe
    )
    if allowed_count / max(1, len(safe)) < 0.85:
        return False

    digits = sum(ch.isdigit() for ch in safe)
    if digits / max(1, len(safe)) > 0.2:
        return False

    tokens = re.findall(r"[A-Za-z][A-Za-z'\-]*", safe)
    if not tokens:
        return False

    short_token_ratio = sum(1 for token in tokens if len(token) == 1) / max(1, len(tokens))
    if short_token_ratio > 0.25:
        return False

    return True


def choose_ingredient_text(
    product: Dict[str, object],
    *,
    min_text_len: int,
) -> Tuple[str, str]:
    english_text = as_text(product.get("ingredients_text_en"))
    if english_text and is_usable_english_like_text(english_text, min_text_len=min_text_len):
        return english_text, "ingredients_text_en"

    fallback_text = as_text(product.get("ingredients_text"))
    if fallback_text and is_usable_english_like_text(fallback_text, min_text_len=min_text_len):
        return fallback_text, "ingredients_text"

    return "", ""


def safe_product_name(product: Dict[str, object]) -> str:
    return as_text(product.get("product_name_en")) or as_text(product.get("product_name"))


def build_catalog_rows(
    *,
    input_path: Path,
    alias_limit: int,
    limit: int,
    min_support: int,
    country_tag: str,
    min_text_len: int,
    sample_limit: int,
) -> Tuple[List[Dict[str, object]], Dict[str, object]]:
    product_support: DefaultDict[str, Set[str]] = defaultdict(set)
    alias_support: DefaultDict[str, DefaultDict[str, Set[str]]] = defaultdict(
        lambda: defaultdict(set)
    )
    product_samples: DefaultDict[str, Dict[str, Dict[str, str]]] = defaultdict(dict)

    processed_rows = 0
    safe_products = 0
    rejection_counts: Counter[str] = Counter()

    for product in iter_off_rows(input_path):
        processed_rows += 1

        code = as_text(product.get("code")) or as_text(product.get("_id"))
        if not code:
            rejection_counts["missing_code"] += 1
            continue

        if not product_has_country_tag(product, country_tag):
            rejection_counts["missing_country_tag"] += 1
            continue

        allergens_tags = first_present_field(product, "allergens_tags", "allergens")
        if allergens_tags:
            rejection_counts["allergens_tags_present"] += 1
            continue

        traces_tags = first_present_field(product, "traces_tags", "traces")
        if traces_tags:
            rejection_counts["traces_tags_present"] += 1
            continue

        if has_blocked_analysis_tags(product):
            rejection_counts["blocked_analysis_tags"] += 1
            continue

        ingredient_text, text_source = choose_ingredient_text(
            product,
            min_text_len=min_text_len,
        )
        if not ingredient_text:
            rejection_counts["unusable_ingredient_text"] += 1
            continue

        candidates = extract_top_level_candidates(ingredient_text)
        if not candidates:
            rejection_counts["no_candidates"] += 1
            continue

        accepted_terms: Dict[str, Set[str]] = defaultdict(set)
        rejected_reason = ""

        for candidate in candidates:
            canonical_name = canonicalize_name(candidate)
            if not should_keep_catalog_name(canonical_name):
                rejected_reason = "invalid_candidate_shape"
                break
            if canonical_name in NOISE_TERMS or len(normalize_lookup_term(canonical_name)) < 2:
                rejected_reason = "invalid_candidate_shape"
                break

            classification = classify_candidate(canonical_name)
            if not classification["is_safe"]:
                rejected_reason = classification["reason_codes"][0] if classification["reason_codes"] else "unsafe_candidate"
                break

            accepted_terms[canonical_name].add(candidate)

        if rejected_reason:
            rejection_counts[rejected_reason] += 1
            continue

        if not accepted_terms:
            rejection_counts["no_safe_candidates"] += 1
            continue

        safe_products += 1
        sample = {
            "code": code,
            "product_name": safe_product_name(product),
            "brand": as_text(product.get("brands")),
            "text_source": text_source,
        }

        for canonical_name, aliases in accepted_terms.items():
            product_support[canonical_name].add(code)
            for alias in aliases:
                alias_support[canonical_name][alias].add(code)
            if len(product_samples[canonical_name]) < sample_limit or code in product_samples[canonical_name]:
                product_samples[canonical_name][code] = sample

        if processed_rows % 100000 == 0:
            print(f"[progress] processed={processed_rows} safe_products={safe_products}", file=sys.stderr)

    grouped_names: DefaultDict[str, List[str]] = defaultdict(list)
    for canonical_name in product_support.keys():
        normalized_name = normalize_lookup_term(canonical_name)
        if normalized_name:
            grouped_names[normalized_name].append(canonical_name)

    catalog_rows: List[Dict[str, object]] = []
    skipped_low_support = 0

    ranked_groups = sorted(
        grouped_names.items(),
        key=lambda item: (
            -max(len(product_support[name]) for name in item[1]),
            item[0],
        ),
    )

    for normalized_name, canonical_names in ranked_groups:
        supporting_codes: Set[str] = set()
        merged_alias_support: DefaultDict[str, Set[str]] = defaultdict(set)
        merged_samples: Dict[str, Dict[str, str]] = {}

        for canonical_name in canonical_names:
            supporting_codes.update(product_support[canonical_name])
            for alias, codes in alias_support[canonical_name].items():
                merged_alias_support[alias].update(codes)
            for code, sample in product_samples[canonical_name].items():
                if len(merged_samples) < sample_limit or code in merged_samples:
                    merged_samples[code] = sample

        lookup_count = len(supporting_codes)
        if lookup_count < min_support:
            skipped_low_support += 1
            continue

        preferred_canonical_name = sorted(
            canonical_names,
            key=lambda name: canonical_display_name_sort_key(
                name,
                support_count=len(product_support[name]),
            ),
        )[0]

        surface_forms = sorted(
            (
                {"name": alias, "count": len(codes)}
                for alias, codes in merged_alias_support.items()
            ),
            key=lambda item: (-int(item["count"]), as_text(item["name"])),
        )
        aliases = [
            item["name"]
            for item in surface_forms[: alias_limit * 3]
            if is_reasonable_alias(preferred_canonical_name, as_text(item["name"]))
        ][:alias_limit]
        alias_set = [preferred_canonical_name]
        for alias in aliases:
            if alias not in alias_set:
                alias_set.append(alias)

        lookup_terms = sorted(
            {
                normalized_name,
                *(normalize_lookup_term(alias) for alias in alias_set),
            }
        )

        metadata = {
            "catalog_type": "safe_only",
            "country_tag": as_text(country_tag),
            "extraction_version": EXTRACTION_VERSION,
            "off_snapshot": {
                "input_path": str(input_path),
            },
            "reason_codes": [],
            "source": "openfoodfacts",
            "source_product_count": lookup_count,
            "supporting_products": list(merged_samples.values())[:sample_limit],
            "supported_diets": list(SUPPORTED_DIETS),
            "surface_forms": surface_forms[:alias_limit],
        }

        catalog_rows.append(
            {
                "canonical_name": preferred_canonical_name,
                "normalized_name": normalized_name,
                "aliases": alias_set,
                "lookup_terms": lookup_terms,
                "lookup_count": lookup_count,
                "allergens": [],
                "diets": list(SUPPORTED_DIETS),
                "is_ready": True,
                "seed_source": SEED_SOURCE,
                "metadata": metadata,
            }
        )

        if limit and len(catalog_rows) >= limit:
            break

    summary = {
        "country_tag": as_text(country_tag),
        "processed_rows": processed_rows,
        "safe_products_admitted": safe_products,
        "unique_safe_phrases": len(grouped_names),
        "min_support": min_support,
        "rows_below_support_threshold": skipped_low_support,
        "seeded_entries": len(catalog_rows),
        "rejection_counts": dict(sorted(rejection_counts.items())),
        "top_examples": [
            {
                "canonical_name": row["canonical_name"],
                "lookup_count": row["lookup_count"],
                "diets": row["diets"],
            }
            for row in catalog_rows[:25]
        ],
    }
    return catalog_rows, summary


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    alias_limit = max(1, int(args.alias_limit))
    limit = max(0, int(args.limit))
    min_support = max(1, int(args.min_support))
    min_text_len = max(1, int(args.min_text_len))
    sample_limit = max(1, int(args.sample_limit))

    input_path = Path(args.input)
    output_path = Path(args.output)
    summary_path = Path(args.summary_output)

    download_meta = maybe_download_file(
        url=as_text(args.download_url),
        output_path=input_path,
        timeout=float(args.timeout),
        force_download=bool(args.force_download),
        skip_download=bool(args.no_download),
        user_agent=as_text(args.user_agent) or DEFAULT_USER_AGENT,
    )

    catalog_rows, summary = build_catalog_rows(
        input_path=input_path,
        alias_limit=alias_limit,
        limit=limit,
        min_support=min_support,
        country_tag=as_text(args.country_tag),
        min_text_len=min_text_len,
        sample_limit=sample_limit,
    )

    write_jsonl(output_path, catalog_rows)
    summary.update(
        {
            "download_bytes": int(download_meta.get("bytes_written", 0)),
            "download_url": as_text(args.download_url),
            "downloaded": bool(download_meta.get("downloaded")),
            "input_path": str(input_path),
            "output_path": str(output_path),
            "seed_source": SEED_SOURCE,
        }
    )
    write_json(summary_path, summary)
    print(f"[done] wrote {len(catalog_rows)} catalog rows to {output_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
