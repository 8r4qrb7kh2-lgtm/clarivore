import unittest

from scripts.ml.scrape_smartlabel_ground_truth import (
    extract_scanbuy_product_id,
    parse_scanbuy_allergens_html,
    parse_scanbuy_ingredients_html,
    parse_syndigo_allergens_html,
    parse_syndigo_ingredients_html,
)


SCANBUY_LANDING_HTML = """
<html><body>
  <input type="hidden" id="productId" value="9a13951d-adfe-4c48-bd62-67225a9b3591" />
</body></html>
"""

SCANBUY_LANDING_HTML_VALUE_FIRST = """
<html><body>
  <input type="hidden" name="productId" value="be66bd25-cb4d-4656-8547-561d29bec849" id="productId" />
</body></html>
"""

SCANBUY_INGREDIENTS_HTML = """
<div id="ingredient-list">
  <a><span class="list-title">Rice</span></a>
  <a><span class="list-title">Wheat Flour</span></a>
  <a><span class="list-title">Palm Oil</span></a>
</div>
"""

SCANBUY_ALLERGENS_HTML = """
<ul id="allergens-list">
  <li>
    <div class="row">
      <div class="col-xs-8">Milk</div>
      <div class="col-xs-4"><div class="badge">Contains</div></div>
    </div>
  </li>
  <li>
    <div class="row">
      <div class="col-xs-8">Soy</div>
      <div class="col-xs-4"><div class="badge">Contains</div></div>
    </div>
  </li>
</ul>
"""

SYNDIGO_INGREDIENTS_HTML = """
<div data-name="ingredients">
  <ul class="ingredients__list list--width">
    <li><span class="linked-list__text">Cheddar Cheese</span></li>
    <li><span class="linked-list__text">Cultured Pasteurized Milk</span></li>
    <li><span class="linked-list__text">Salt</span></li>
  </ul>
</div>
"""

SYNDIGO_ALLERGENS_HTML = """
<div data-name="allergens">
  <div data-id="allergens__components">
    <ul data-id="allergens__labels_classifications">
      <li>
        <div data-id="classification">Milk|Contains</div>
      </li>
      <li>
        <div data-id="classification">Eggs|Shared Facility</div>
      </li>
    </ul>
  </div>
</div>
"""


class SmartLabelScrapeTests(unittest.TestCase):
    def test_extract_scanbuy_product_id(self):
        self.assertEqual(
            extract_scanbuy_product_id(SCANBUY_LANDING_HTML),
            "9a13951d-adfe-4c48-bd62-67225a9b3591",
        )
        self.assertEqual(
            extract_scanbuy_product_id(SCANBUY_LANDING_HTML_VALUE_FIRST),
            "be66bd25-cb4d-4656-8547-561d29bec849",
        )

    def test_parse_scanbuy_ingredients_html(self):
        ingredients_text, items = parse_scanbuy_ingredients_html(SCANBUY_INGREDIENTS_HTML)
        self.assertEqual(items, ["Rice", "Wheat Flour", "Palm Oil"])
        self.assertIn("Rice", ingredients_text)

    def test_parse_scanbuy_allergens_html(self):
        declared, present, may_contain = parse_scanbuy_allergens_html(SCANBUY_ALLERGENS_HTML)
        self.assertEqual(declared, [])
        self.assertEqual(present, ["Milk", "Soy"])
        self.assertEqual(may_contain, [])

    def test_parse_syndigo_ingredients_html(self):
        ingredients_text, items = parse_syndigo_ingredients_html(SYNDIGO_INGREDIENTS_HTML)
        self.assertEqual(items, ["Cheddar Cheese", "Cultured Pasteurized Milk", "Salt"])
        self.assertIn("Cheddar Cheese", ingredients_text)

    def test_parse_syndigo_allergens_html(self):
        declared, present, may_contain = parse_syndigo_allergens_html(SYNDIGO_ALLERGENS_HTML)
        self.assertEqual(declared, [])
        self.assertEqual(present, ["Milk"])
        self.assertEqual(may_contain, ["Eggs"])


if __name__ == "__main__":
    unittest.main()
