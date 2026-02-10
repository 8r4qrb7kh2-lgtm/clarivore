export async function detectDishesOnMenu(imageData) {
  try {
    const response = await fetch(
      "https://fgoiyycctnwnghrvsilt.supabase.co/functions/v1/detect-menu-dishes",
      {
        method: "POST",
        headers: {
          Authorization:
            "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnb2l5eWNjdG53bmdocnZzaWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA0MzY1MjYsImV4cCI6MjA3NjAxMjUyNn0.xlSSXr0Gl7j-vsckrj-2anpPmp4BG2SUIdN-_dquSA8",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageData }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error:", errorText);
      throw new Error("Failed to detect dishes");
    }

    const result = await response.json();
    return result;
  } catch (err) {
    console.error("Detection error:", err);
    return { success: false, error: err.message, dishes: [] };
  }
}
