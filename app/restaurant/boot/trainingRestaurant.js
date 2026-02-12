export const HOW_IT_WORKS_SLUG = "how-it-works";
const HOW_IT_WORKS_MENU_IMAGE = "images/how-it-works-menu.png";

const HOW_IT_WORKS_OVERLAYS = [
  {
    id: "Grilled Tofu",
    name: "Grilled Tofu",
    title: "Grilled Tofu",
    description: "With vegetables and potatoes",
    x: 13,
    y: 21,
    w: 52,
    h: 11,
    allergens: ["soy"],
    removable: [
      {
        allergen: "soy",
        instructions: "Ask for olive oil dressing instead of soy glaze",
      },
    ],
    diets: ["Vegan", "Vegetarian", "Gluten-free"],
    crossContaminationAllergens: ["peanut"],
    price: "$18",
    details: {
      description:
        "House-marinated tofu served with charred vegetables and crispy potatoes.",
      tags: ["Chef favorite", "Training example"],
    },
    ingredients: [
      { name: "Tofu", allergens: ["soy"] },
      { name: "Roasted vegetables", allergens: [] },
      { name: "Baby potatoes", allergens: [] },
      { name: "Herb oil", allergens: [] },
    ],
  },
  {
    id: "Spaghetti Bolognese",
    name: "Spaghetti Bolognese",
    title: "Spaghetti Bolognese",
    description: "With tomato sauce and basil",
    x: 13,
    y: 33.5,
    w: 52,
    h: 11,
    allergens: ["wheat", "milk"],
    removable: [
      { allergen: "milk", instructions: "Request no parmesan topping" },
    ],
    diets: ["Pescatarian"],
    crossContaminationAllergens: ["egg"],
    price: "$22",
    details: {
      description:
        "Slow-simmered sauce tossed with spaghetti and finished with basil.",
      tags: ["House classic", "Training example"],
    },
    ingredients: [
      { name: "Spaghetti", allergens: ["wheat"] },
      { name: "Parmesan", allergens: ["milk"] },
      { name: "Tomato-basil sauce", allergens: [] },
    ],
  },
];

const HOW_IT_WORKS_RESTAURANT = {
  id: "tour-how-it-works",
  _id: "tour-how-it-works",
  name: "How It Works Training Menu",
  slug: HOW_IT_WORKS_SLUG,
  menu_image: HOW_IT_WORKS_MENU_IMAGE,
  last_confirmed: "2025-11-14T00:00:00.000Z",
  overlays: HOW_IT_WORKS_OVERLAYS,
  website: null,
  phone: null,
  delivery_url: null,
};

export async function buildTrainingRestaurantPayload({
  supabaseClient,
  isQrVisit,
  managerRestaurants,
}) {
  let allergies = [];
  let diets = [];
  let userPayload = { loggedIn: false };

  try {
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    if (user) {
      userPayload = {
        loggedIn: true,
        email: user.email,
        id: user.id,
        name: user.user_metadata?.first_name || null,
        role: user.user_metadata?.role || null,
        managerRestaurants,
      };

      const { data: record } = await supabaseClient
        .from("user_allergies")
        .select("allergens, diets")
        .eq("user_id", user.id)
        .maybeSingle();
      allergies = record?.allergens || [];
      diets = record?.diets || [];
    }
  } catch (error) {
    console.warn("Training restaurant: failed to load user profile", error);
  }

  return {
    page: "restaurant",
    restaurant: JSON.parse(JSON.stringify(HOW_IT_WORKS_RESTAURANT)),
    user: userPayload,
    allergies,
    diets,
    canEdit: false,
    canEditSource: "tour",
    qr: isQrVisit,
    isHowItWorks: true,
  };
}
