import csv
import gzip
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("build_ingredient_catalog.py")
SPEC = importlib.util.spec_from_file_location("build_ingredient_catalog", MODULE_PATH)
build_ingredient_catalog = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(build_ingredient_catalog)


class BuildIngredientCatalogTests(unittest.TestCase):
    def write_snapshot(self, rows):
        tmpdir = tempfile.TemporaryDirectory()
        snapshot_path = Path(tmpdir.name) / "openfoodfacts-products.jsonl.gz"
        with gzip.open(snapshot_path, "wt", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row))
                handle.write("\n")
        return tmpdir, snapshot_path

    def build_rows(self, rows, **overrides):
        tmpdir, snapshot_path = self.write_snapshot(rows)
        self.addCleanup(tmpdir.cleanup)
        catalog_rows, summary = build_ingredient_catalog.build_catalog_rows(
            input_path=snapshot_path,
            alias_limit=12,
            limit=0,
            min_support=2,
            country_tag="en:united-states",
            min_text_len=12,
            sample_limit=5,
            **overrides,
        )
        return catalog_rows, summary

    def write_csv_snapshot(self, rows):
        tmpdir = tempfile.TemporaryDirectory()
        snapshot_path = Path(tmpdir.name) / "en.openfoodfacts.org.products.csv.gz"
        fieldnames = sorted({key for row in rows for key in row.keys()})
        with gzip.open(snapshot_path, "wt", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames, delimiter="\t")
            writer.writeheader()
            for row in rows:
                writer.writerow(row)
        return tmpdir, snapshot_path

    def test_extract_top_level_candidates_keeps_parenthetical_phrase_intact(self):
        candidates = build_ingredient_catalog.extract_top_level_candidates(
            "Tomato Puree (Water, Tomato Paste), Salt"
        )
        self.assertEqual(
            candidates,
            ["tomato puree (water, tomato paste)", "salt"],
        )

    def test_build_merges_aggressive_variants_and_counts_distinct_products(self):
        rows = [
            {
                "code": "1001",
                "countries_tags": ["en:united-states"],
                "ingredients_text_en": "Organic Carrots, Salt",
                "allergens_tags": [],
                "traces_tags": [],
                "ingredients_analysis_tags": ["en:vegan", "en:vegetarian"],
                "product_name": "Carrots One",
                "brands": "Brand A",
            },
            {
                "code": "1002",
                "countries_tags": ["en:united-states"],
                "ingredients_text_en": "Fresh Carrot, Salt",
                "allergens_tags": [],
                "traces_tags": [],
                "ingredients_analysis_tags": ["en:vegan", "en:vegetarian"],
                "product_name": "Carrots Two",
                "brands": "Brand B",
            },
            {
                "code": "1003",
                "countries_tags": ["en:united-states"],
                "ingredients_text_en": "Carrots, Salt, Salt",
                "allergens_tags": [],
                "traces_tags": [],
                "ingredients_analysis_tags": ["en:vegan", "en:vegetarian"],
                "product_name": "Carrots Three",
                "brands": "Brand C",
            },
        ]

        catalog_rows, _summary = self.build_rows(rows)
        rows_by_name = {
            row["canonical_name"]: row
            for row in catalog_rows
        }

        self.assertIn("carrot", rows_by_name)
        self.assertEqual(rows_by_name["carrot"]["lookup_count"], 3)
        self.assertIn("salt", rows_by_name)
        self.assertEqual(rows_by_name["salt"]["lookup_count"], 3)
        self.assertIn("organic carrots", rows_by_name["carrot"]["aliases"])
        self.assertIn("fresh carrot", rows_by_name["carrot"]["aliases"])

    def test_build_collapses_duplicate_normalized_names(self):
        rows = [
            {
                "code": "1501",
                "countries_tags": ["en:united-states"],
                "ingredients_text_en": "Agar-Agar, Water",
                "allergens_tags": [],
                "traces_tags": [],
                "ingredients_analysis_tags": ["en:vegan", "en:vegetarian"],
            },
            {
                "code": "1502",
                "countries_tags": ["en:united-states"],
                "ingredients_text_en": "Agar Agar, Water",
                "allergens_tags": [],
                "traces_tags": [],
                "ingredients_analysis_tags": ["en:vegan", "en:vegetarian"],
            },
        ]

        catalog_rows, _summary = self.build_rows(rows)
        agar_rows = [row for row in catalog_rows if row["normalized_name"] == "agar agar"]

        self.assertEqual(len(agar_rows), 1)
        self.assertEqual(agar_rows[0]["lookup_count"], 2)
        self.assertIn("agar-agar", agar_rows[0]["aliases"])
        self.assertIn("agar agar", agar_rows[0]["aliases"])

    def test_rejects_source_filtered_rows(self):
        rows = [
            {
                "code": "2001",
                "countries_tags": ["en:united-states"],
                "ingredients_text_en": "Chamomile Flowers, Water",
                "allergens_tags": [],
                "traces_tags": [],
                "ingredients_analysis_tags": ["en:vegan", "en:vegetarian"],
                "product_name": "Tea One",
                "brands": "Brand A",
            },
            {
                "code": "2002",
                "countries_tags": ["en:united-states"],
                "ingredients_text_en": "Chamomile Flowers, Water",
                "allergens_tags": [],
                "traces_tags": [],
                "ingredients_analysis_tags": ["en:vegan", "en:vegetarian"],
                "product_name": "Tea Two",
                "brands": "Brand B",
            },
            {
                "code": "2003",
                "countries_tags": ["en:united-states"],
                "ingredients_text_en": "Chamomile Flowers, Water",
                "allergens_tags": [],
                "traces_tags": ["en:milk"],
                "ingredients_analysis_tags": ["en:vegan"],
            },
            {
                "code": "2004",
                "countries_tags": ["en:united-states"],
                "ingredients_text_en": "Chamomile Flowers, Water",
                "allergens_tags": [],
                "traces_tags": [],
                "ingredients_analysis_tags": ["en:non-vegan"],
            },
            {
                "code": "2005",
                "countries_tags": ["en:france"],
                "ingredients_text_en": "Chamomile Flowers, Water",
                "allergens_tags": [],
                "traces_tags": [],
                "ingredients_analysis_tags": ["en:vegan"],
            },
            {
                "code": "2006",
                "countries_tags": ["en:united-states"],
                "ingredients_text_en": "",
                "ingredients_text": "ماء مصفى، أملاح معدنية",
                "allergens_tags": [],
                "traces_tags": [],
                "ingredients_analysis_tags": ["en:vegan"],
            },
        ]

        catalog_rows, summary = self.build_rows(rows)
        rows_by_name = {row["canonical_name"]: row for row in catalog_rows}

        self.assertEqual(summary["safe_products_admitted"], 2)
        self.assertEqual(summary["rejection_counts"]["traces_tags_present"], 1)
        self.assertEqual(summary["rejection_counts"]["blocked_analysis_tags"], 1)
        self.assertEqual(summary["rejection_counts"]["missing_country_tag"], 1)
        self.assertEqual(summary["rejection_counts"]["unusable_ingredient_text"], 1)
        self.assertIn("chamomile flower", rows_by_name)
        self.assertIn("water", rows_by_name)

    def test_rejects_ambiguous_phrase_products(self):
        rows = [
            {
                "code": "3001",
                "countries_tags": ["en:united-states"],
                "ingredients_text_en": "Water, Natural Flavors",
                "allergens_tags": [],
                "traces_tags": [],
                "ingredients_analysis_tags": ["en:vegan", "en:vegetarian"],
            },
            {
                "code": "3002",
                "countries_tags": ["en:united-states"],
                "ingredients_text_en": "Water, Natural Flavors",
                "allergens_tags": [],
                "traces_tags": [],
                "ingredients_analysis_tags": ["en:vegan", "en:vegetarian"],
            },
        ]

        catalog_rows, summary = self.build_rows(rows)
        self.assertEqual(catalog_rows, [])
        self.assertEqual(summary["safe_products_admitted"], 0)
        self.assertEqual(summary["rejection_counts"]["review:ambiguous_generic"], 2)

    def test_build_accepts_off_csv_export_shape(self):
        rows = [
            {
                "code": "4001",
                "countries_tags": "en:united-states,en:canada",
                "ingredients_text": "Organic Carrots, Water",
                "allergens": "",
                "traces_tags": "",
                "ingredients_analysis_tags": "en:vegan,en:vegetarian",
                "product_name": "Carrots One",
                "brands": "Brand A",
            },
            {
                "code": "4002",
                "countries_tags": "en:united-states",
                "ingredients_text": "Fresh Carrot, Water",
                "allergens": "",
                "traces_tags": "",
                "ingredients_analysis_tags": "en:vegan,en:vegetarian",
                "product_name": "Carrots Two",
                "brands": "Brand B",
            },
            {
                "code": "4003",
                "countries_tags": "en:united-states",
                "ingredients_text": "Carrot, Water",
                "allergens": "en:milk",
                "traces_tags": "",
                "ingredients_analysis_tags": "en:vegan,en:vegetarian",
                "product_name": "Rejected",
                "brands": "Brand C",
            },
        ]

        tmpdir, snapshot_path = self.write_csv_snapshot(rows)
        self.addCleanup(tmpdir.cleanup)
        catalog_rows, summary = build_ingredient_catalog.build_catalog_rows(
            input_path=snapshot_path,
            alias_limit=12,
            limit=0,
            min_support=2,
            country_tag="en:united-states",
            min_text_len=12,
            sample_limit=5,
        )

        rows_by_name = {row["canonical_name"]: row for row in catalog_rows}
        self.assertEqual(summary["safe_products_admitted"], 2)
        self.assertEqual(summary["rejection_counts"]["allergens_tags_present"], 1)
        self.assertEqual(rows_by_name["carrot"]["lookup_count"], 2)
        self.assertEqual(rows_by_name["water"]["lookup_count"], 2)


if __name__ == "__main__":
    unittest.main()
