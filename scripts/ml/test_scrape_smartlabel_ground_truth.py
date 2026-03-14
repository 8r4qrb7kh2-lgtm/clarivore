import unittest

from scripts.ml.scrape_smartlabel_ground_truth import (
    extract_bestchoice_upc,
    extract_generalmills_gtin,
    extract_scanbuy_product_id,
    labelinsight_product_id,
    parse_bestchoice_allergens_html,
    parse_bestchoice_ingredients_html,
    parse_generalmills_allergens_html,
    parse_generalmills_ingredients_html,
    parse_hormel_allergens_html,
    parse_hormel_ingredients_html,
    parse_labelinsight_payload,
    parse_pg_product_payload,
    parse_rbnainfo_ingredients_html,
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

SCANBUY_INGREDIENTS_DIV_HTML = """
<div id="ingredient-list">
  <a><div class="list-title">Corn Syrup</div></a>
  <a><div class="list-title">Sugar</div></a>
  <a><div class="list-title">Coconut</div></a>
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

BESTCHOICE_HTML = """
<html><body>
  <div class="product-upc">000-70038665956</div>
  <div id="ingredients">
    <ul>
      <li>Water</li>
      <li>high fructose corn syrup</li>
      <li>contains 2% or less of the following: natural and artificial flavor</li>
      <li>citric acid</li>
    </ul>
  </div>
  <ul class="allergen-list">
    <li><span class="atc">Milk and its derivatives</span><span class="locc">Free From</span></li>
    <li><span class="atc">Soybean and its derivatives</span><span class="locc">Contains</span></li>
    <li><span class="atc">Wheat and its derivatives</span><span class="locc">May Contain</span></li>
    <li><span class="atc">Fish and its derivatives</span><span class="locc"></span></li>
  </ul>
</body></html>
"""

BESTCHOICE_MISSING_ALLERGEN_STATUS_HTML = """
<html><body>
  <div id="ingredients">
    <ul>
      <li>Human Health</li>
      <li>MAY IRRITATE EYES.</li>
    </ul>
  </div>
  <ul class="allergen-list">
    <li><span class="atc">Milk and its derivatives</span><span class="locc"></span></li>
  </ul>
</body></html>
"""

GENERALMILLS_INGREDIENTS_HTML = """
<div class="container-fluid margin-top-20">
  <ul id="ingredients-list">
    <li class="ingredient-li"><div class="list-title header1 ing-head">ORGANIC WHEAT FLOUR</div></li>
    <li class="ingredient-li"><div class="list-title header1 ing-head">WATER</div></li>
    <li class="ingredient-li">
      <div class="list-title header1 ing-head">BAKING POWDER</div>
      <ul class="no-bullet">
        <li><div class="list-title header1 ing-head">SODIUM ACID PYROPHOSPHATE</div></li>
        <li><div class="list-title header1 ing-head">BAKING SODA</div></li>
      </ul>
    </li>
  </ul>
</div>
"""

GENERALMILLS_ALLERGENS_HTML = """
<div class="container-fluid margin-top-20">
  <ul id="allergens-list">
    <li class="allergen-li">
      <div class="list-title header1"><h3>Wheat</h3></div>
      <div class="contain-link"><span>Contains</span></div>
    </li>
    <li class="allergen-li">
      <div class="list-title header1"><h3>Sesame</h3></div>
      <div class="contain-link"><span>May Contain</span></div>
    </li>
  </ul>
</div>
"""

HORMEL_INGREDIENTS_HTML = """
<main id="ingredientsTab" class="tabcontent">
  <ul>
    <li><p>Cashews</p></li>
    <li><p>Peanut Oil</p></li>
    <li><p>Sea Salt</p></li>
  </ul>
</main>
"""

HORMEL_ALLERGENS_HTML = """
<main id="allergensTab" class="tabcontent">
  <div class="allergens-header"><h5>According to the FDA...</h5></div>
  <ul>
    <li><p>Cashew</p><span class="contains-pill">Contains</span></li>
    <li><p>Tree Nut</p><span class="contains-pill">Contains</span></li>
  </ul>
  <ul>
    <li><p>Contains: Cashew. May Contain: Peanuts, Other Tree Nuts.</p></li>
  </ul>
</main>
"""

LABELINSIGHT_PAYLOAD = {
    "upc": "021130174744",
    "marketingImage": "https://example.com/image.jpg",
    "rawIngredients": "WATER (AQUA), ALBUMEN, HYDROLYZED MILK PROTEIN.",
    "ingredientSection": {
        "ingredients": [
            {"name": "Water (Aqua)", "subIngredients": [], "ingredientComponents": []},
            {"name": "Albumen", "subIngredients": [], "ingredientComponents": []},
            {"name": "Hydrolyzed Milk Protein", "subIngredients": [], "ingredientComponents": []},
        ]
    },
    "allergenSection": {
        "allergens": [
            {"name": "Egg", "presence": "Contains"},
            {"name": "Milk", "presence": "Contains"},
            {"name": "Tree Nuts", "presence": None},
            {"name": "Peanuts", "presence": "Shared Facility"},
        ]
    },
}

PG_PAYLOAD = {
    "fields": {
        "ingredientList": [
            {
                "ingredientName": "Water",
                "ingredientType": "INGREDIENTS",
            },
            {
                "ingredientName": "Fragrance",
                "ingredientType": "INGREDIENTS",
                "fragranceIngredients": [
                    {
                        "ingredientName": "ETHYL LINALOOL",
                        "ingredientType": "SUB INGREDIENTS",
                    },
                    {
                        "ingredientName": "LIMONENE",
                        "ingredientType": "SUB INGREDIENTS",
                    },
                ],
            },
        ],
        "allergen": {
            "fields": {
                "allergenStatement": "Salicylate: 261 mg.;",
            }
        },
        "productImage": {
            "fields": {
                "file": {
                    "url": "//images.ctfassets.net/example/product.png",
                }
            }
        },
    }
}

RBNINFO_HTML = """
<section id="ingredients">
  <div id="accordionOuter">
    <div class="card card-blue">
      <div class="card-header"><h3 class="cas-category-head">INTENTIONALLY ADDED</h3></div>
      <div class="accParent collapse">
        <div class="card-body">
          <div class="card" id="intentionally-addedChild">
            <div class="card-header" id="ingred-1Heading"><h3>Water</h3></div>
            <div class="accChild collapse" id="ingred-1"><div class="card-body blueBg">CAS #: 7732-18-5</div></div>
            <div class="card-header" id="ingred-2Heading"><h3>Ethanol</h3></div>
            <div class="accChild collapse" id="ingred-2"><div class="card-body blueBg">CAS #: 64-17-5</div></div>
          </div>
        </div>
      </div>
    </div>
    <div class="card card-blue">
      <div class="card-header"><h3 class="cas-category-head">FRAGRANCE COMPONENT</h3></div>
      <div class="accParent collapse">
        <div class="card-body">
          <div class="card">
            <div class="card-header" id="ingred-3Heading"><h3>Limonene</h3></div>
            <div class="accChild collapse" id="ingred-3"><div class="card-body blueBg">CAS #: 138-86-3</div></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>
"""


class SmartLabelScrapeTests(unittest.TestCase):
    def test_extract_bestchoice_upc(self):
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(BESTCHOICE_HTML, "html.parser")
        self.assertEqual(extract_bestchoice_upc(soup), "00070038665956")

    def test_extract_scanbuy_product_id(self):
        self.assertEqual(
            extract_scanbuy_product_id(SCANBUY_LANDING_HTML),
            "9a13951d-adfe-4c48-bd62-67225a9b3591",
        )
        self.assertEqual(
            extract_scanbuy_product_id(SCANBUY_LANDING_HTML_VALUE_FIRST),
            "be66bd25-cb4d-4656-8547-561d29bec849",
        )
        self.assertEqual(extract_generalmills_gtin("https://smartlabel.generalmills.com/13562472949"), "13562472949")

    def test_parse_scanbuy_ingredients_html(self):
        ingredients_text, items = parse_scanbuy_ingredients_html(SCANBUY_INGREDIENTS_HTML)
        self.assertEqual(items, ["Rice", "Wheat Flour", "Palm Oil"])
        self.assertIn("Rice", ingredients_text)

    def test_parse_scanbuy_ingredients_html_accepts_div_titles(self):
        ingredients_text, items = parse_scanbuy_ingredients_html(SCANBUY_INGREDIENTS_DIV_HTML)
        self.assertEqual(items, ["Corn Syrup", "Sugar", "Coconut"])
        self.assertIn("Corn Syrup", ingredients_text)

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

    def test_parse_bestchoice_ingredients_html(self):
        ingredients_text, items = parse_bestchoice_ingredients_html(BESTCHOICE_HTML)
        self.assertEqual(
            items,
            [
                "Water",
                "high fructose corn syrup",
                "contains 2% or less of the following: natural and artificial flavor",
                "citric acid",
            ],
        )
        self.assertIn("Water", ingredients_text)

    def test_parse_bestchoice_allergens_html(self):
        declared, present, may_contain, explicit_rows = parse_bestchoice_allergens_html(BESTCHOICE_HTML)
        self.assertEqual(declared, [])
        self.assertEqual(present, ["Soybean and its derivatives"])
        self.assertEqual(may_contain, ["Wheat and its derivatives"])
        self.assertEqual(explicit_rows, 3)

    def test_parse_bestchoice_allergens_ignores_blank_status_rows(self):
        declared, present, may_contain, explicit_rows = parse_bestchoice_allergens_html(
            BESTCHOICE_MISSING_ALLERGEN_STATUS_HTML
        )
        self.assertEqual(declared, [])
        self.assertEqual(present, [])
        self.assertEqual(may_contain, [])
        self.assertEqual(explicit_rows, 0)

    def test_parse_generalmills_ingredients_html(self):
        ingredients_text, items = parse_generalmills_ingredients_html(GENERALMILLS_INGREDIENTS_HTML)
        self.assertEqual(
            items,
            ["ORGANIC WHEAT FLOUR", "WATER", "BAKING POWDER", "SODIUM ACID PYROPHOSPHATE", "BAKING SODA"],
        )
        self.assertIn("BAKING POWDER", ingredients_text)

    def test_parse_generalmills_allergens_html(self):
        declared, present, may_contain = parse_generalmills_allergens_html(GENERALMILLS_ALLERGENS_HTML)
        self.assertEqual(declared, [])
        self.assertEqual(present, ["Wheat"])
        self.assertEqual(may_contain, ["Sesame"])

    def test_parse_hormel_ingredients_html(self):
        ingredients_text, items = parse_hormel_ingredients_html(HORMEL_INGREDIENTS_HTML)
        self.assertEqual(items, ["Cashews", "Peanut Oil", "Sea Salt"])
        self.assertIn("Cashews", ingredients_text)

    def test_parse_hormel_allergens_html(self):
        declared, present, may_contain = parse_hormel_allergens_html(HORMEL_ALLERGENS_HTML)
        self.assertEqual(declared, [])
        self.assertEqual(present, ["Cashew", "Tree Nut"])
        self.assertEqual(may_contain, ["Peanuts", "Other Tree Nuts"])

    def test_labelinsight_product_id(self):
        self.assertEqual(
            labelinsight_product_id("https://smartlabel.labelinsight.com/product/11188035/nutrition"),
            "11188035",
        )
        self.assertEqual(
            labelinsight_product_id("https://smartlabel.labelinsight.com/id/13246983"),
            "13246983",
        )

    def test_parse_labelinsight_payload(self):
        ingredients_text, items, declared, present, may_contain, image_url = parse_labelinsight_payload(LABELINSIGHT_PAYLOAD)
        self.assertIn("WATER", ingredients_text)
        self.assertEqual(items, ["Water (Aqua)", "Albumen", "Hydrolyzed Milk Protein"])
        self.assertEqual(declared, [])
        self.assertEqual(present, ["Egg", "Milk"])
        self.assertEqual(may_contain, ["Peanuts"])
        self.assertEqual(image_url, "https://example.com/image.jpg")

    def test_parse_pg_product_payload(self):
        ingredients_text, items, declared, present, may_contain, image_url = parse_pg_product_payload(PG_PAYLOAD)
        self.assertIn("Fragrance", ingredients_text)
        self.assertEqual(items, ["Water", "Fragrance", "ETHYL LINALOOL", "LIMONENE"])
        self.assertEqual(declared, ["Salicylate: 261 mg.;"])
        self.assertEqual(present, [])
        self.assertEqual(may_contain, [])
        self.assertEqual(image_url, "https://images.ctfassets.net/example/product.png")

    def test_parse_rbnainfo_ingredients_html(self):
        ingredients_text, items = parse_rbnainfo_ingredients_html(RBNINFO_HTML)
        self.assertEqual(items, ["Water", "Ethanol", "Limonene"])
        self.assertIn("Ethanol", ingredients_text)


if __name__ == "__main__":
    unittest.main()
