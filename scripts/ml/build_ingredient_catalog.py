#!/usr/bin/env python3
"""Build a seeded ingredient catalog from Clarivore's existing corpora."""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import DefaultDict, Dict, Iterable, Iterator, List, Sequence, Set, Tuple


DEFAULT_LIMIT = 10000
DEFAULT_OUTPUT = "ml/seeds/ingredient_catalog_seed.jsonl"
DEFAULT_SUMMARY_OUTPUT = "ml/seeds/ingredient_catalog_seed_summary.json"

SUPPORTED_DIETS: Tuple[str, ...] = (
    "Vegan",
    "Vegetarian",
    "Pescatarian",
    "Gluten-free",
)

DEFAULT_SOURCES: Sequence[Tuple[str, str]] = (
    ("usda_only_train", "ml/data/processed/usda_only_train.jsonl"),
    ("usda_only_val", "ml/data/processed/usda_only_val.jsonl"),
    ("usda_only_holdout", "ml/data/processed/usda_only_holdout.jsonl"),
    ("openfoodfacts_examples", "ml/data/processed/openfoodfacts_examples.jsonl"),
    ("openfoodfacts_targeted", "ml/data/processed/openfoodfacts_targeted_examples.jsonl"),
    ("dish_ingredient_rows", "ml/data/raw/dish_ingredient_rows.json"),
    ("brand_items", "ml/data/raw/brand_items.json"),
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

GLUTEN_LABEL_TERMS: Tuple[str, ...] = (
    "gluten",
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a seeded ingredient catalog.")
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--summary-output", default=DEFAULT_SUMMARY_OUTPUT)
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument(
        "--alias-limit",
        type=int,
        default=12,
        help="Maximum human-readable aliases stored per ingredient.",
    )
    return parser.parse_args()


def as_text(value: object) -> str:
    return str(value or "").strip()


def ascii_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def normalize_spaces(value: str) -> str:
    return SPACE_RE.sub(" ", value).strip(" .,:;-/")


def strip_disclosure_segments(text: str) -> str:
    safe = text
    for pattern in CONTAINS_PATTERNS:
        safe = pattern.sub("", safe)
    return safe


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
    tokens = base.split()

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
    if "(" in safe or ")" in safe:
        return False
    if safe.startswith(("(", ")", "-", "*")):
        return False
    if len(safe.split()) > 18:
        return False
    return True


def normalize_lookup_term(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", ascii_text(value).lower()).strip()


def iter_source_rows(source_name: str, path: Path) -> Iterator[str]:
    if not path.exists():
        print(f"[warn] missing source: {path}", file=sys.stderr)
        return

    if path.suffix == ".jsonl":
        with path.open("r", encoding="utf-8") as handle:
            for index, raw_line in enumerate(handle, start=1):
                line = raw_line.strip()
                if not line:
                    continue
                payload = json.loads(line)
                text = as_text(payload.get("text"))
                if text:
                    yield text
                if index % 100000 == 0:
                    print(f"[progress] {source_name}: {index} rows", file=sys.stderr)
        return

    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("rows") if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        return

    for row in rows:
        if not isinstance(row, dict):
            continue
        if source_name == "dish_ingredient_rows":
            text = as_text(row.get("row_text"))
            if text:
                yield text
            continue

        if source_name == "brand_items":
            ingredient_list = as_text(row.get("ingredient_list"))
            if ingredient_list:
                yield ingredient_list
            ingredients_list = row.get("ingredients_list")
            if isinstance(ingredients_list, list) and ingredients_list:
                merged = ", ".join(as_text(item) for item in ingredients_list if as_text(item))
                if merged:
                    yield merged


def extract_candidates(text: str) -> List[str]:
    safe = strip_disclosure_segments(text or "")
    safe = ascii_text(safe).replace("\n", ", ")
    out: List[str] = []

    def walk(segment: str) -> None:
        for part in split_top_level(segment):
            cleaned = clean_candidate(part)
            if not cleaned or cleaned in NOISE_TERMS:
                continue
            if cleaned.endswith("(") or cleaned == ")":
                continue
            out.append(cleaned)
            for inner in PAREN_CONTENT_RE.findall(cleaned):
                walk(inner)

    walk(safe)
    return out


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


def plant_dairy_exception(text: str) -> bool:
    for base in PLANT_BASES:
        safe_base = normalize_lookup_term(base)
        for suffix in (" milk ", " cream ", " cheese ", " yogurt ", " yoghurt ", " butter "):
            if f" {safe_base}{suffix}" in text:
                return True
    if " non dairy " in text or " nondairy " in text or " dairy free " in text:
        return True
    if " vegan butter " in text or " vegan cheese " in text or " vegan yogurt " in text:
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
GLUTEN_LABEL_MATCHERS = compile_matchers(GLUTEN_LABEL_TERMS)


def surface_form_support(
    surface_forms: Sequence[Dict[str, object]],
    matchers: Sequence[Tuple[str, re.Pattern[str]]],
    *,
    skip_plant_dairy: bool = False,
) -> Tuple[int, int]:
    matched_count = 0
    total_count = 0

    for surface_form in surface_forms:
        if not isinstance(surface_form, dict):
            continue
        label = normalize_lookup_term(as_text(surface_form.get("name")))
        if not label:
            continue
        count = int(surface_form.get("count") or 0)
        if count <= 0:
            count = 1
        total_count += count
        normalized = f" {label} "
        if skip_plant_dairy and plant_dairy_exception(normalized):
            continue
        if match_any(normalized, matchers):
            matched_count += count

    return matched_count, total_count


def has_strong_surface_support(
    surface_forms: Sequence[Dict[str, object]],
    matchers: Sequence[Tuple[str, re.Pattern[str]]],
    *,
    skip_plant_dairy: bool = False,
    min_count: int = 4,
    min_ratio: float = 0.25,
) -> bool:
    matched_count, total_count = surface_form_support(
        surface_forms,
        matchers,
        skip_plant_dairy=skip_plant_dairy,
    )
    if matched_count < min_count or total_count <= 0:
        return False
    return (matched_count / total_count) >= min_ratio


def is_product_style_name(name: str) -> bool:
    if name in READY_EXACT_EXCEPTIONS:
        return False
    if name in PRODUCT_STYLE_EXACT_TERMS:
        return True
    return any(name.endswith(suffix) for suffix in PRODUCT_STYLE_SUFFIX_TERMS)


def classify_catalog_entry(name: str, surface_forms: Sequence[Dict[str, object]]) -> Dict[str, object]:
    normalized = f" {normalize_lookup_term(name)} "
    has_gluten_free_claim = " gluten free " in normalized
    allergens: Set[str] = set()
    blocked_diets: Set[str] = set()
    reason_codes: List[str] = []
    used_surface_evidence = False

    if match_any(normalized, PEANUT_MATCHERS):
        allergens.add("peanut")
        reason_codes.append("allergen:peanut")

    if match_any(normalized, TREE_NUT_MATCHERS):
        allergens.add("tree nut")
        reason_codes.append("allergen:tree_nut")

    if match_any(normalized, SOY_MATCHERS):
        allergens.add("soy")
        reason_codes.append("allergen:soy")

    if match_any(normalized, SESAME_MATCHERS):
        allergens.add("sesame")
        reason_codes.append("allergen:sesame")

    if match_any(normalized, FISH_MATCHERS):
        allergens.add("fish")
        reason_codes.append("allergen:fish")

    if match_any(normalized, SHELLFISH_MATCHERS):
        allergens.add("shellfish")
        reason_codes.append("allergen:shellfish")

    if match_any(normalized, EGG_MATCHERS):
        allergens.add("egg")
        reason_codes.append("allergen:egg")

    if (
        name not in MILK_FALSE_POSITIVE_EXACT_TERMS
        and match_any(normalized, MILK_MATCHERS)
        and not plant_dairy_exception(normalized)
    ):
        allergens.add("milk")
        reason_codes.append("allergen:milk")

    if match_any(normalized, GLUTEN_MATCHERS) or (
        match_any(normalized, GLUTEN_LABEL_MATCHERS) and not has_gluten_free_claim
    ):
        allergens.add("wheat")
        blocked_diets.add("Gluten-free")
        reason_codes.append("diet_block:gluten_free")

    if "peanut" not in allergens and has_strong_surface_support(surface_forms, PEANUT_MATCHERS):
        allergens.add("peanut")
        reason_codes.extend(("allergen:peanut", "evidence:surface_form"))
        used_surface_evidence = True

    if "tree nut" not in allergens and has_strong_surface_support(surface_forms, TREE_NUT_MATCHERS):
        allergens.add("tree nut")
        reason_codes.extend(("allergen:tree_nut", "evidence:surface_form"))
        used_surface_evidence = True

    if "soy" not in allergens and has_strong_surface_support(surface_forms, SOY_MATCHERS):
        allergens.add("soy")
        reason_codes.extend(("allergen:soy", "evidence:surface_form"))
        used_surface_evidence = True

    if "sesame" not in allergens and has_strong_surface_support(surface_forms, SESAME_MATCHERS):
        allergens.add("sesame")
        reason_codes.extend(("allergen:sesame", "evidence:surface_form"))
        used_surface_evidence = True

    if "fish" not in allergens and has_strong_surface_support(surface_forms, FISH_MATCHERS):
        allergens.add("fish")
        reason_codes.extend(("allergen:fish", "evidence:surface_form"))
        used_surface_evidence = True

    if "shellfish" not in allergens and has_strong_surface_support(surface_forms, SHELLFISH_MATCHERS):
        allergens.add("shellfish")
        reason_codes.extend(("allergen:shellfish", "evidence:surface_form"))
        used_surface_evidence = True

    if "egg" not in allergens and has_strong_surface_support(surface_forms, EGG_MATCHERS):
        allergens.add("egg")
        reason_codes.extend(("allergen:egg", "evidence:surface_form"))
        used_surface_evidence = True

    if (
        "milk" not in allergens
        and name not in MILK_FALSE_POSITIVE_EXACT_TERMS
        and has_strong_surface_support(surface_forms, MILK_MATCHERS, skip_plant_dairy=True)
    ):
        allergens.add("milk")
        reason_codes.extend(("allergen:milk", "evidence:surface_form"))
        used_surface_evidence = True

    if "Gluten-free" not in blocked_diets and has_strong_surface_support(surface_forms, GLUTEN_MATCHERS):
        allergens.add("wheat")
        blocked_diets.add("Gluten-free")
        reason_codes.extend(("diet_block:gluten_free", "evidence:surface_form"))
        used_surface_evidence = True

    if (
        "Gluten-free" not in blocked_diets
        and not has_gluten_free_claim
        and has_strong_surface_support(surface_forms, GLUTEN_LABEL_MATCHERS)
    ):
        allergens.add("wheat")
        blocked_diets.add("Gluten-free")
        reason_codes.extend(("diet_block:gluten_free", "evidence:surface_form"))
        used_surface_evidence = True

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

    if has_strong_surface_support(surface_forms, MEAT_MATCHERS):
        blocked_diets.update({"Vegan", "Vegetarian", "Pescatarian"})
        reason_codes.extend(("diet_block:meat", "evidence:surface_form"))
        used_surface_evidence = True

    if has_strong_surface_support(surface_forms, VEGAN_ONLY_MATCHERS):
        blocked_diets.add("Vegan")
        reason_codes.extend(("diet_block:vegan_only", "evidence:surface_form"))
        used_surface_evidence = True

    if has_strong_surface_support(surface_forms, ALL_DIET_BLOCKER_MATCHERS):
        blocked_diets.update({"Vegan", "Vegetarian", "Pescatarian"})
        reason_codes.extend(("diet_block:animal_derivative", "evidence:surface_form"))
        used_surface_evidence = True

    compatible_diets = [diet for diet in SUPPORTED_DIETS if diet not in blocked_diets]
    is_ready = True
    if name in AMBIGUOUS_EXACT_TERMS or any(
        name.startswith(prefix) for prefix in AMBIGUOUS_PREFIX_TERMS
    ) or any(name.endswith(suffix) for suffix in AMBIGUOUS_SUFFIX_TERMS):
        is_ready = False
        reason_codes.append("review:ambiguous_generic")
    if " extract " in normalized and not allergens:
        is_ready = False
        reason_codes.append("review:generic_extract")
    if name.endswith(" oil") and "soybean oil" not in name and name == "vegetable oil":
        is_ready = False
        reason_codes.append("review:generic_oil")
    if is_product_style_name(name):
        is_ready = False
        reason_codes.append("review:product_style")
    if used_surface_evidence and is_product_style_name(name):
        reason_codes.append("review:surface_form_composite")

    return {
        "allergens": sorted(allergens),
        "blocked_diets": sorted(blocked_diets),
        "diets": compatible_diets,
        "is_ready": is_ready,
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


def write_jsonl(path: Path, rows: Sequence[Dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False))
            handle.write("\n")


def write_json(path: Path, payload: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    limit = max(1, int(args.limit))
    alias_limit = max(1, int(args.alias_limit))

    term_counts: Counter[str] = Counter()
    alias_counts: DefaultDict[str, Counter[str]] = defaultdict(Counter)
    dataset_counts: DefaultDict[str, Counter[str]] = defaultdict(Counter)

    for source_name, source_path in DEFAULT_SOURCES:
        print(f"[source] {source_name} -> {source_path}", file=sys.stderr)
        for raw_text in iter_source_rows(source_name, Path(source_path)):
            for candidate in extract_candidates(raw_text):
                canonical_name = canonicalize_name(candidate)
                if len(canonical_name) < 2:
                    continue
                if canonical_name in NOISE_TERMS:
                    continue
                if not should_keep_catalog_name(canonical_name):
                    continue
                lookup_term = normalize_lookup_term(canonical_name)
                if len(lookup_term) < 2:
                    continue
                term_counts[canonical_name] += 1
                alias_counts[canonical_name][candidate] += 1
                dataset_counts[canonical_name][source_name] += 1

    catalog_rows: List[Dict[str, object]] = []
    allergen_counter: Counter[str] = Counter()
    ready_counter = 0

    for canonical_name, lookup_count in term_counts.most_common(limit):
        aliases = [
            alias
            for alias, _ in alias_counts[canonical_name].most_common(alias_limit * 3)
            if is_reasonable_alias(canonical_name, alias)
        ][:alias_limit]
        top_surface_forms = [
            {"name": alias, "count": count}
            for alias, count in alias_counts[canonical_name].most_common(alias_limit * 3)
        ]
        alias_set = [canonical_name]
        for alias in aliases:
            if alias not in alias_set:
                alias_set.append(alias)

        lookup_terms = sorted(
            {
                normalize_lookup_term(canonical_name),
                *(normalize_lookup_term(alias) for alias in alias_set),
            }
        )

        classification = classify_catalog_entry(canonical_name, top_surface_forms)
        if classification["is_ready"]:
            ready_counter += 1
        for allergen in classification["allergens"]:
            allergen_counter[allergen] += 1

        metadata = {
            "blocked_diets": classification["blocked_diets"],
            "datasets": [
                {"name": dataset_name, "count": count}
                for dataset_name, count in dataset_counts[canonical_name].most_common()
            ],
            "reason_codes": classification["reason_codes"],
            "surface_forms": top_surface_forms[:alias_limit],
        }

        catalog_rows.append(
            {
                "canonical_name": canonical_name,
                "normalized_name": normalize_lookup_term(canonical_name),
                "aliases": alias_set,
                "lookup_terms": lookup_terms,
                "lookup_count": lookup_count,
                "allergens": classification["allergens"],
                "diets": classification["diets"],
                "is_ready": bool(classification["is_ready"]),
                "seed_source": "corpus_seed",
                "metadata": metadata,
            }
        )

    output_path = Path(args.output)
    summary_path = Path(args.summary_output)
    write_jsonl(output_path, catalog_rows)
    write_json(
        summary_path,
        {
            "alias_limit": alias_limit,
            "limit": limit,
            "ready_entries": ready_counter,
            "seeded_entries": len(catalog_rows),
            "top_allergens": allergen_counter.most_common(),
            "top_examples": [
                {
                    "canonical_name": row["canonical_name"],
                    "lookup_count": row["lookup_count"],
                    "allergens": row["allergens"],
                    "diets": row["diets"],
                    "is_ready": row["is_ready"],
                }
                for row in catalog_rows[:25]
            ],
        },
    )
    print(
        f"[done] wrote {len(catalog_rows)} catalog rows to {output_path}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
