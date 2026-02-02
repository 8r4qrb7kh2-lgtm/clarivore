CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS allergens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  emoji TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  emoji TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_supported BOOLEAN NOT NULL DEFAULT TRUE,
  is_ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS allergen_aliases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alias TEXT NOT NULL UNIQUE,
  allergen_id UUID NOT NULL REFERENCES allergens(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS diet_aliases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alias TEXT NOT NULL UNIQUE,
  diet_id UUID NOT NULL REFERENCES diets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS diet_allergen_conflicts (
  diet_id UUID NOT NULL REFERENCES diets(id) ON DELETE CASCADE,
  allergen_id UUID NOT NULL REFERENCES allergens(id) ON DELETE CASCADE,
  PRIMARY KEY (diet_id, allergen_id)
);

ALTER TABLE allergens ENABLE ROW LEVEL SECURITY;
ALTER TABLE diets ENABLE ROW LEVEL SECURITY;
ALTER TABLE allergen_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE diet_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE diet_allergen_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read allergens" ON allergens
  FOR SELECT USING (TRUE);
CREATE POLICY "Allow read diets" ON diets
  FOR SELECT USING (TRUE);
CREATE POLICY "Allow read allergen aliases" ON allergen_aliases
  FOR SELECT USING (TRUE);
CREATE POLICY "Allow read diet aliases" ON diet_aliases
  FOR SELECT USING (TRUE);
CREATE POLICY "Allow read diet conflicts" ON diet_allergen_conflicts
  FOR SELECT USING (TRUE);

INSERT INTO allergens (key, label, emoji, sort_order) VALUES
  ('milk', 'Milk', '🥛', 1),
  ('egg', 'Egg', '🥚', 2),
  ('peanut', 'Peanut', '🥜', 3),
  ('tree nut', 'Tree Nut', '🌰', 4),
  ('shellfish', 'Shellfish', '🦐', 5),
  ('fish', 'Fish', '🐟', 6),
  ('soy', 'Soy', '🫛', 7),
  ('sesame', 'Sesame', '🫘', 8),
  ('wheat', 'Wheat', '🌾', 9)
ON CONFLICT (key) DO NOTHING;

INSERT INTO diets (key, label, emoji, sort_order, is_supported, is_ai_enabled) VALUES
  ('vegan', 'Vegan', '🌱', 1, TRUE, TRUE),
  ('vegetarian', 'Vegetarian', '🥬', 2, TRUE, TRUE),
  ('pescatarian', 'Pescatarian', '🐟', 3, TRUE, TRUE),
  ('gluten-free', 'Gluten-free', '🌾', 4, TRUE, FALSE),
  ('halal', 'Halal', '☪️', 10, FALSE, FALSE),
  ('kosher', 'Kosher', '✡️', 11, FALSE, FALSE),
  ('keto', 'Keto', '🥑', 12, FALSE, FALSE),
  ('paleo', 'Paleo', '🦴', 13, FALSE, FALSE)
ON CONFLICT (key) DO NOTHING;

INSERT INTO allergen_aliases (alias, allergen_id)
SELECT v.alias, a.id
FROM (
  VALUES
    ('milk', 'milk'),
    ('lactose', 'milk'),
    ('butter', 'milk'),
    ('cheese', 'milk'),
    ('whey', 'milk'),
    ('casein', 'milk'),
    ('cream', 'milk'),
    ('yogurt', 'milk'),
    ('egg', 'egg'),
    ('eggs', 'egg'),
    ('albumin', 'egg'),
    ('mayonnaise', 'egg'),
    ('meringue', 'egg'),
    ('peanut', 'peanut'),
    ('peanuts', 'peanut'),
    ('peanut butter', 'peanut'),
    ('peanut oil', 'peanut'),
    ('treenut', 'tree nut'),
    ('tree nut', 'tree nut'),
    ('tree nuts', 'tree nut'),
    ('tree_nut', 'tree nut'),
    ('almond', 'tree nut'),
    ('almonds', 'tree nut'),
    ('cashew', 'tree nut'),
    ('cashews', 'tree nut'),
    ('walnut', 'tree nut'),
    ('walnuts', 'tree nut'),
    ('pecan', 'tree nut'),
    ('pecans', 'tree nut'),
    ('pistachio', 'tree nut'),
    ('pistachios', 'tree nut'),
    ('hazelnut', 'tree nut'),
    ('hazelnuts', 'tree nut'),
    ('macadamia', 'tree nut'),
    ('macadamias', 'tree nut'),
    ('shellfish', 'shellfish'),
    ('crustaceans', 'shellfish'),
    ('crustacean', 'shellfish'),
    ('molluscs', 'shellfish'),
    ('shrimp', 'shellfish'),
    ('crab', 'shellfish'),
    ('lobster', 'shellfish'),
    ('clam', 'shellfish'),
    ('clams', 'shellfish'),
    ('oyster', 'shellfish'),
    ('oysters', 'shellfish'),
    ('mussel', 'shellfish'),
    ('mussels', 'shellfish'),
    ('fish', 'fish'),
    ('salmon', 'fish'),
    ('tuna', 'fish'),
    ('anchovy', 'fish'),
    ('anchovies', 'fish'),
    ('cod', 'fish'),
    ('bass', 'fish'),
    ('wheat', 'wheat'),
    ('wheat flour', 'wheat'),
    ('gluten', 'wheat'),
    ('soy', 'soy'),
    ('soya', 'soy'),
    ('soybean', 'soy'),
    ('soybeans', 'soy'),
    ('soy lecithin', 'soy'),
    ('tofu', 'soy'),
    ('edamame', 'soy'),
    ('sesame', 'sesame'),
    ('tahini', 'sesame'),
    ('sesame oil', 'sesame')
) AS v(alias, allergen_key)
JOIN allergens a ON a.key = v.allergen_key
ON CONFLICT (alias) DO NOTHING;

INSERT INTO diet_aliases (alias, diet_id)
SELECT v.alias, d.id
FROM (
  VALUES
    ('gluten free', 'gluten-free'),
    ('gluten-free', 'gluten-free'),
    ('glutenfree', 'gluten-free')
) AS v(alias, diet_key)
JOIN diets d ON d.key = v.diet_key
ON CONFLICT (alias) DO NOTHING;

INSERT INTO diet_allergen_conflicts (diet_id, allergen_id)
SELECT d.id, a.id
FROM diets d
JOIN allergens a ON a.key IN ('milk', 'egg', 'fish', 'shellfish')
WHERE d.key = 'vegan'
ON CONFLICT DO NOTHING;

INSERT INTO diet_allergen_conflicts (diet_id, allergen_id)
SELECT d.id, a.id
FROM diets d
JOIN allergens a ON a.key IN ('fish', 'shellfish')
WHERE d.key = 'vegetarian'
ON CONFLICT DO NOTHING;

INSERT INTO diet_allergen_conflicts (diet_id, allergen_id)
SELECT d.id, a.id
FROM diets d
JOIN allergens a ON a.key IN ('wheat')
WHERE d.key = 'gluten-free'
ON CONFLICT DO NOTHING;
