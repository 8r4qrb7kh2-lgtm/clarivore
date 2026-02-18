"use client";

export function DishPreviewPanel({ previewAllergenRows, previewDietRows }) {
  return (
    <div className="restaurant-legacy-editor-dish-preview">
      <h3>Preview: What customers will see</h3>
      <div className="restaurant-legacy-editor-dish-preview-panel">
        {/* Allergen rows reflect saved contains + cross-contamination state. */}
        <h4>Allergens:</h4>
        <div className="restaurant-legacy-dish-popover-section">
          {previewAllergenRows.length ? (
            previewAllergenRows.map((row) => (
              <div key={row.key} className={`dish-row ${row.tone}`}>
                <div className="dish-row-title">{row.title}</div>
                {row.reasonBullet ? (
                  <ul className="dish-row-reasons">
                    <li>{row.reasonBullet}</li>
                  </ul>
                ) : null}
              </div>
            ))
          ) : (
            <p className="dish-row-empty">No saved allergens.</p>
          )}
        </div>

        {/* Diet rows use the same rendering contract as allergens. */}
        <h4>Diets:</h4>
        <div className="restaurant-legacy-dish-popover-section">
          {previewDietRows.length ? (
            previewDietRows.map((row) => (
              <div key={row.key} className={`dish-row ${row.tone}`}>
                <div className="dish-row-title">{row.title}</div>
                {row.reasonBullet ? (
                  <ul className="dish-row-reasons">
                    <li>{row.reasonBullet}</li>
                  </ul>
                ) : null}
              </div>
            ))
          ) : (
            <p className="dish-row-empty">No saved diets.</p>
          )}
        </div>
      </div>
    </div>
  );
}
