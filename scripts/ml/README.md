# Clarivore Fast Model Training

This folder contains a low-cost, fast multi-label training pipeline for ingredient text classification:

- `fetch_openfoodfacts_data.py`: automatically gathers real ingredient-label text + allergen/diet tags from Open Food Facts.
- `fetch_openfoodfacts_targeted.py`: high-yield allergen-tag harvesting from Open Food Facts (balanced positives by allergen class).
- `fetch_usda_fdc_data.py`: fetches USDA Branded ingredient labels and extracts high-confidence allergen labels from explicit contains/may-contain statements.
- `fetch_usda_fdc_bulk.py`: downloads USDA Branded CSV ZIP and generates large-scale train/holdout JSONL from real branded labels.
- `prepare_usda_only_data.py`: builds USDA-only train/val/holdout files and restricts diet label space.
- `build_ingredient_catalog.py`: legacy Open Food Facts catalog tooling for offline audit/review workflows. Runtime inference does not consult this catalog.
- `build_ingredient_catalog_review_queue.py`: builds a CSV queue to manually verify and correct catalog rows.
- `build_ingredient_catalog_review_shards.py`: splits the review queue into parallel audit lanes like extracts, sauces, flavors, and composite product rows.
- `build_ingredient_catalog_review_packets.py`: builds Codex-friendly packet directories so multiple Codex chats can manually review disjoint row batches in parallel.
- `summarize_ingredient_catalog_review_packets.py`: reports pending, submitted, and merged packet counts for the local packet workspace.
- `merge_ingredient_catalog_review_packets.py`: merges reviewed packet submissions into the master manual review override file.
- `distill_with_anthropic.py`: asks a teacher model to relabel hard student examples for distillation.
- `apply_distilled_labels.py`: merges teacher-distilled labels into student train rows.
- `export_training_data.py`: pulls labeled ingredient text from Supabase and writes JSONL train/val splits.
- `train_fast_model.py`: trains a lightweight hashed-feature PyTorch model for allergen and diet-violation flags.
- `evaluate_model.py`: evaluates a trained run and writes metrics JSON.
- `tune_thresholds.py`: sweeps decision thresholds and recommends recall-priority vs F1-priority operating points.

## Quick start

```bash
python3 scripts/ml/export_training_data.py
python3 scripts/ml/train_fast_model.py
python3 scripts/ml/evaluate_model.py
python3 scripts/ml/tune_thresholds.py
# Evaluate using tuned per-label thresholds:
# python3 scripts/ml/evaluate_model.py --threshold-file ml/artifacts/run-*/threshold_tuning.json
```

Legacy OFF ingredient catalog tooling:

```bash
python3 scripts/ml/build_ingredient_catalog.py
node scripts/sync-ingredient-catalog.mjs
```

The legacy catalog builder:

- uses the official Open Food Facts bulk CSV export by default, while still accepting the bulk `jsonl.gz` snapshot if you point `--input` at it
- keeps only U.S.-tagged products with usable English-biased ingredient text
- rejects products with allergen tags, trace tags, non-vegan/non-vegetarian/non-pescatarian analysis tags, or ambiguous/unsafe ingredient phrases
- seeds only ingredient phrases that appear in at least two distinct safe products

Online ingestion + train:

```bash
python3 scripts/ml/fetch_openfoodfacts_data.py --max-pages 10 --include-traces
python3 scripts/ml/fetch_openfoodfacts_targeted.py --pages-per-tag 6 --include-traces
python3 scripts/ml/fetch_usda_fdc_data.py --max-pages 40 --page-size 200
python3 scripts/ml/export_training_data.py \
  --manual-labels scripts/ml/manual_hidden_alias_seed.jsonl \
  --manual-labels ml/data/processed/openfoodfacts_examples.jsonl \
  --manual-labels ml/data/processed/openfoodfacts_targeted_examples.jsonl \
  --manual-labels ml/data/processed/usda_fdc_examples.jsonl
python3 scripts/ml/train_fast_model.py
python3 scripts/ml/evaluate_model.py
python3 scripts/ml/tune_thresholds.py
```

USDA bulk ingestion + external holdout validation:

```bash
python3 scripts/ml/fetch_usda_fdc_bulk.py --require-contains
python3 scripts/ml/export_training_data.py \
  --manual-labels scripts/ml/manual_hidden_alias_seed.jsonl \
  --manual-labels ml/data/processed/openfoodfacts_targeted_examples.jsonl \
  --manual-labels ml/data/processed/usda_fdc_bulk_train_examples.jsonl
python3 scripts/ml/train_fast_model.py
python3 scripts/ml/tune_thresholds.py
python3 scripts/ml/evaluate_model.py \
  --dataset ml/data/processed/usda_fdc_bulk_holdout_examples.jsonl
```

USDA-only (disclosure segments stripped from model input):

```bash
python3 scripts/ml/fetch_usda_fdc_bulk.py --require-contains
python3 scripts/ml/prepare_usda_only_data.py
python3 scripts/ml/train_fast_model.py \
  --train-file ml/data/processed/usda_only_train.jsonl \
  --val-file ml/data/processed/usda_only_val.jsonl \
  --label-space-file ml/data/processed/label_space_usda_only.json
python3 scripts/ml/tune_thresholds.py
python3 scripts/ml/evaluate_model.py \
  --dataset ml/data/processed/usda_only_holdout.jsonl
```

Teacher-student distillation (Anthropic teacher):

```bash
python3 scripts/ml/distill_with_anthropic.py \
  --input ml/data/processed/usda_only_train.jsonl \
  --artifact-dir ml/artifacts/run-<student-run> \
  --max-examples 1200 \
  --model claude-haiku-4-5-20251001
python3 scripts/ml/apply_distilled_labels.py \
  --train-input ml/data/processed/usda_only_train.jsonl \
  --distilled-input ml/data/processed/usda_teacher_distilled.jsonl \
  --train-output ml/data/processed/usda_only_train_distilled.jsonl
python3 scripts/ml/train_fast_model.py \
  --train-file ml/data/processed/usda_only_train_distilled.jsonl \
  --val-file ml/data/processed/usda_only_val.jsonl \
  --label-space-file ml/data/processed/label_space_usda_only.json
```

Outputs:

- Processed data: `ml/data/processed/`
- Raw source snapshots: `ml/data/raw/`
- Model artifacts: `ml/artifacts/run-<timestamp>/`
- Ingredient catalog seed: `ml/seeds/ingredient_catalog_seed.jsonl`
- Ingredient catalog summary: `ml/seeds/ingredient_catalog_seed_summary.json`
- Ingredient catalog review queue: `ml/review/ingredient_catalog_review_queue.csv`
- Ingredient catalog manual review overrides: `ml/review/ingredient_catalog_manual_review.jsonl`
- Ingredient catalog review shards: `ml/review/shards/*.csv`
- Ingredient catalog local review packets: `ml/review/packets/`

## Codex-only parallel review workflow

Use this when you want multiple Codex chats to manually review rows without spending external AI API credits.

1. Build or refresh the queue:

```bash
npm run ml:review:ingredient-catalog
npm run ml:review:ingredient-catalog:shards
```

2. Generate review packets:

```bash
npm run ml:review:ingredient-catalog:packets
```

This creates local packet folders under `ml/review/packets/<lane>/<packet-id>/` with:

- `input.jsonl`: the rows to review
- `prompt.md`: packet-specific review instructions
- `submission.jsonl`: where that Codex chat writes its decisions

3. Assign different packet directories to different Codex chats. Each chat should only work inside its assigned packet directory so reviews do not overlap.

4. Check progress at any time:

```bash
npm run ml:review:ingredient-catalog:packets:status
```

5. Merge completed packet submissions:

```bash
npm run ml:review:ingredient-catalog:merge
```

The merge step archives each merged `submission.jsonl` to `submission.merged.jsonl` so repeated merges stay clean.

6. Rebuild the queue and shard summaries after merging:

```bash
npm run ml:review:ingredient-catalog
npm run ml:review:ingredient-catalog:shards
npm run ml:review:ingredient-catalog:packets:status
```

Notes:

- `ml/review/packets/` is local-only and ignored by git.
- Generate packets once, fan them out across Codex chats, then merge completed packets as they come back.
- If you want to discard an old packet workspace and rebuild from scratch, run `python3 scripts/ml/build_ingredient_catalog_review_packets.py --clean`.

## Lexicon expansion workflow

Use `build_allergen_lexicon_v2.py` to expand allergen aliases with a review loop:

```bash
python3 scripts/ml/build_allergen_lexicon_v2.py \
  --workbook-input /path/to/allergen_ingredient_database.xlsx \
  --workbook-output /path/to/allergen_ingredient_database_lexicon_v2.xlsx \
  --output-dir ml/data/analysis/lexicon_v2
```

What it now does:

- applies alias policy controls (`allow` / `deny` / `review`) from `Lexicon Alias Policy` sheet and optional `--denylist-csv`
- auto-demotes noisy aliases by support + precision + exclusivity thresholds
- mines new candidates from unmatched positive rows, then scores by support * precision * exclusivity
- emits review outputs:
  - `allergen_lexicon_alias_actions.csv`
  - `allergen_lexicon_coverage_gaps.csv`
  - workbook tabs: `Lexicon Alias Actions`, `Lexicon Coverage Gaps`, `Lexicon Alias Policy`

## Notes

- This pipeline is model-first and does not depend on deterministic synonym dictionaries in runtime inference.
- Runtime inference does not consult the Open Food Facts ingredient catalog. Ingredient/allergen decisions come from explicit declaration resolution plus model analysis.
- Brand-item diet arrays in current schema represent compatibility labels, not violations, so they are excluded from diet-violation targets.
- Open Food Facts API search has a published rate limit (10 requests/minute). Keep `--throttle-seconds` at ~6+ for large pulls.
- `build_ingredient_catalog.py` uses the official OFF bulk export and may download `ml/data/raw/en.openfoodfacts.org.products.csv.gz` if it is missing.
- USDA `DEMO_KEY` is heavily rate-limited. Set `USDA_API_KEY` for large-scale pulls.
- USDA bulk CSV download avoids API throttling and is preferable for large-scale training/validation.
- `fetch_usda_fdc_bulk.py` uses disclosure segments only to derive ground-truth allergen labels and strips those segments from `text` before saving rows.
- `model_utils.py` tokenization is unit-aware and phrase-aware (e.g., treats plant-milk compounds like `coconut milk` as one semantic unit).
- `prepare_usda_only_data.py` adds optional semantic augmentation rows for plant-milk/plant-butter compounds to improve phrase-level allergen behavior.
