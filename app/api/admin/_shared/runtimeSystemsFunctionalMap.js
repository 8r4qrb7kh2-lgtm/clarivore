export const FUNCTIONAL_ROOT_NODE_ID = "functional:clarivore-workflows";

export const FUNCTIONAL_GRAPH_DEFINITION = {
  id: FUNCTIONAL_ROOT_NODE_ID,
  label: "How Clarivore Works",
  kind: "root",
  scopeLabel: "Site overview",
  description:
    "A live map of Clarivore organized by what people are trying to do, not by how the codebase is stored.",
  audience: [
    "Diner / guest",
    "Authenticated user",
    "Manager / owner",
    "Server staff",
    "Kitchen staff",
    "App admin",
  ],
  children: [
    {
      id: "functional:start-and-identity",
      label: "Start and Identity",
      kind: "area",
      scopeLabel: "Entry points",
      description:
        "How a person enters Clarivore, chooses the right access path, and lands in the correct signed-in or guest experience.",
      audience: ["Diner / guest", "Authenticated user", "Manager / owner"],
      flowsTo: [
        {
          targetId: "functional:find-food",
          label: "moves diners into restaurant and dish discovery",
        },
      ],
      children: [
        {
          id: "functional:guest-entry",
          label: "Guest Entry and Restaurant Selection",
          kind: "task",
          scopeLabel: "Guest path",
          description:
            "Guests choose a restaurant and set allergies or diets before opening a menu.",
          audience: ["Diner / guest"],
          selectors: {
            exact: ["app/page.js"],
            prefixes: ["app/guest/"],
          },
          flowsTo: [
            {
              targetId: "functional:account-identity",
              label: "can move a guest into sign-in or onboarding",
            },
          ],
        },
        {
          id: "functional:account-identity",
          label: "Account, Sign-In, and Onboarding",
          kind: "task",
          scopeLabel: "Identity",
          description:
            "Clarivore signs users in, handles invites, saves preferences, and decides where to send them next.",
          audience: ["Authenticated user", "Manager / owner", "Diner / guest"],
          selectors: {
            prefixes: ["app/account/"],
          },
          flowsTo: [
            {
              targetId: "functional:signed-in-home",
              label: "returns signed-in diners to their home base",
            },
          ],
        },
        {
          id: "functional:signed-in-home",
          label: "Signed-In Home",
          kind: "task",
          scopeLabel: "Home",
          description:
            "Signed-in diners see the main home experience with recent restaurants and quick paths into discovery.",
          audience: ["Authenticated user"],
          selectors: {
            prefixes: ["app/home/"],
          },
        },
      ],
    },
    {
      id: "functional:find-food",
      label: "Find Food",
      kind: "area",
      scopeLabel: "Discovery",
      description:
        "How diners browse restaurants, search by dish, and return to saved places or dishes.",
      audience: ["Diner / guest", "Authenticated user"],
      flowsTo: [
        {
          targetId: "functional:restaurant-menu-experience",
          label: "opens a specific restaurant menu or dish result",
        },
      ],
      children: [
        {
          id: "functional:browse-restaurants",
          label: "Browse Restaurants",
          kind: "task",
          scopeLabel: "By restaurant",
          description:
            "Diners browse restaurant choices, map previews, and recent confirmations.",
          audience: ["Diner / guest", "Authenticated user"],
          selectors: {
            prefixes: ["app/restaurants/"],
          },
          flowsTo: [
            {
              targetId: "functional:saved-favorites",
              label: "lets diners save trusted places for quick return",
            },
          ],
        },
        {
          id: "functional:dish-search",
          label: "Dish Search",
          kind: "task",
          scopeLabel: "By dish",
          description:
            "Diners search for a dish first and then decide which restaurant or menu result to open.",
          audience: ["Diner / guest", "Authenticated user"],
          selectors: {
            prefixes: ["app/dish-search/"],
          },
          flowsTo: [
            {
              targetId: "functional:saved-favorites",
              label: "helps diners keep dishes and places they trust",
            },
          ],
        },
        {
          id: "functional:saved-favorites",
          label: "Saved Restaurants and Dishes",
          kind: "task",
          scopeLabel: "Saved items",
          description:
            "Signed-in diners return to saved restaurants and dishes without starting discovery from scratch.",
          audience: ["Authenticated user"],
          selectors: {
            prefixes: ["app/favorites/", "app/my-dishes/"],
          },
        },
      ],
    },
    {
      id: "functional:restaurant-menu-experience",
      label: "Restaurant Menu Experience",
      kind: "area",
      scopeLabel: "Menu experience",
      description:
        "What diners see inside a restaurant, how the menu adapts to their needs, and how they send questions back to staff.",
      audience: ["Diner / guest", "Authenticated user", "Manager / owner"],
      flowsTo: [
        {
          targetId: "functional:staff-order-handling",
          label: "sends diner questions and updates to restaurant staff",
        },
      ],
      children: [
        {
          id: "functional:restaurant-route-shell",
          label: "Restaurant Route and Access Modes",
          kind: "task",
          scopeLabel: "Route shell",
          description:
            "The restaurant route decides whether the page opens in guest, signed-in, QR, or editor mode.",
          audience: ["Diner / guest", "Authenticated user", "Manager / owner"],
          selectors: {
            exact: [
              "app/restaurant/page.js",
              "app/restaurant/RestaurantClient.js",
              "app/restaurant/restaurant-editor-primitives.css",
            ],
            prefixes: ["app/restaurant/client/"],
          },
          flowsTo: [
            {
              targetId: "functional:menu-viewer",
              label: "loads the correct restaurant view and safety context",
            },
          ],
        },
        {
          id: "functional:menu-viewer",
          label: "Menu Viewer and Safety Filters",
          kind: "task",
          scopeLabel: "Viewer",
          description:
            "Clarivore loads the menu, applies allergy and diet context, and helps diners decide what is safe to eat.",
          audience: ["Diner / guest", "Authenticated user"],
          selectors: {
            prefixes: ["app/restaurant/features/viewer/", "app/restaurant/features/shared/"],
            exact: ["app/restaurant/hooks/useRestaurantViewer.js"],
          },
          flowsTo: [
            {
              targetId: "functional:diner-notices-feedback",
              label: "lets diners ask follow-up questions and track updates",
            },
          ],
        },
        {
          id: "functional:diner-notices-feedback",
          label: "Diner Notices and Visit Feedback",
          kind: "task",
          scopeLabel: "Questions and feedback",
          description:
            "Diners can send order-related needs, watch notice updates, and submit feedback after the experience.",
          audience: ["Diner / guest", "Authenticated user", "Feedback token holder"],
          selectors: {
            prefixes: ["app/restaurant/features/order/", "app/order-feedback/"],
            exact: [
              "app/restaurant/hooks/useOrderFlow.js",
              "app/api/order-feedback/bootstrap/route.js",
              "app/api/order-feedback/submit/route.js",
            ],
          },
        },
      ],
    },
    {
      id: "functional:restaurant-management",
      label: "Restaurant Management",
      kind: "area",
      scopeLabel: "Manager workflows",
      description:
        "How managers review performance, edit a restaurant, and publish safe menu updates.",
      audience: ["Manager / owner", "App admin"],
      flowsTo: [
        {
          targetId: "functional:restaurant-menu-experience",
          label: "publishes and updates what diners see",
        },
      ],
      children: [
        {
          id: "functional:manager-dashboard",
          label: "Manager Dashboard",
          kind: "task",
          scopeLabel: "Dashboard",
          description:
            "Managers review menu interest, accommodation demand, confirmations, and recent changes.",
          audience: ["Manager / owner"],
          selectors: {
            prefixes: ["app/manager-dashboard/"],
          },
          flowsTo: [
            {
              targetId: "functional:restaurant-editor-workspace",
              label: "opens editing and review work for a restaurant",
            },
          ],
        },
        {
          id: "functional:restaurant-editor-workspace",
          label: "Restaurant Editor Workspace",
          kind: "task",
          scopeLabel: "Editor",
          description:
            "Managers edit dishes, overlays, menu structure, and restaurant-specific content.",
          audience: ["Manager / owner"],
          selectors: {
            prefixes: [
              "app/restaurant/features/editor/",
              "app/restaurant/hooks/useRestaurantEditor/",
            ],
            exact: [
              "app/restaurant/hooks/useRestaurantEditor.js",
              "app/restaurant/hooks/useManagerActions.js",
            ],
          },
          flowsTo: [
            {
              targetId: "functional:drafts-and-publishing",
              label: "stages, locks, and commits published changes",
            },
            {
              targetId: "functional:menu-analysis",
              label: "uses analysis and ingredient review during editing",
            },
          ],
        },
        {
          id: "functional:drafts-and-publishing",
          label: "Drafts, Locks, and Publishing",
          kind: "task",
          scopeLabel: "Publishing",
          description:
            "Clarivore stages edits, protects write access, and applies commits back to the restaurant runtime.",
          audience: ["Manager / owner", "App admin"],
          selectors: {
            prefixes: ["app/api/restaurant-write/", "app/api/editor-pending-save/"],
            exact: [
              "app/api/editor-lock/route.js",
              "app/lib/restaurantWriteGatewayClient.js",
              "app/lib/editorLockClient.js",
              "app/lib/changeLogs.js",
              "app/lib/restaurantViewBindings.js",
            ],
          },
        },
        {
          id: "functional:menu-analysis",
          label: "Menu Analysis and Ingredient Review",
          kind: "task",
          scopeLabel: "Analysis",
          description:
            "Clarivore analyzes menus, ingredient text, photos, and branded products to support accurate editing.",
          audience: ["Manager / owner", "App admin", "System / cron"],
          selectors: {
            prefixes: [
              "app/components/ingredient-scan/",
              "app/api/menu-image-analysis/",
              "app/api/analyze-ingredient-scan/",
              "app/api/confirm-info-compare/",
              "app/api/detect-corners/",
              "app/api/detect-menu-dishes/",
              "app/api/dish-editor-analysis/",
              "app/api/ingredient-",
              "app/lib/server/ingredient",
            ],
            exact: [
              "app/lib/allergenConfig.js",
              "app/lib/allergenConfigRuntime.js",
              "app/lib/ingredientAllergenAnalysis.js",
              "app/lib/ingredientLabelParser.js",
              "app/lib/ingredientNormalizer.js",
              "app/lib/ingredientPhotoAnalysis.js",
              "app/lib/ingredientSources.js",
              "app/lib/managerIngredientPhotoCapture.js",
            ],
          },
        },
      ],
    },
    {
      id: "functional:staff-order-handling",
      label: "Staff Order Handling",
      kind: "area",
      scopeLabel: "Restaurant staff",
      description:
        "How server and kitchen staff see diner needs, pass work across stations, and send status updates back.",
      audience: ["Server staff", "Kitchen staff", "Manager / owner"],
      children: [
        {
          id: "functional:notice-storage-alerts",
          label: "Notice Storage and Alerts",
          kind: "task",
          scopeLabel: "Shared order state",
          description:
            "Shared order persistence, notifications, and diner notice updates power both tablet experiences.",
          audience: ["Server staff", "Kitchen staff", "Manager / owner", "System / cron"],
          selectors: {
            prefixes: ["app/api/notifications/"],
            exact: [
              "app/components/TabletMonitorLayout.js",
              "app/lib/chatMessage.js",
              "app/lib/chatNotifications.js",
              "app/lib/dinerNotifications.js",
              "app/lib/managerNotifications.js",
              "app/lib/orderNotifications.js",
              "app/lib/tabletOrderPersistence.js",
              "app/lib/tabletSync.js",
            ],
          },
          flowsTo: [
            {
              targetId: "functional:server-tablet",
              label: "surfaces new diner needs to the server station",
            },
          ],
        },
        {
          id: "functional:server-tablet",
          label: "Server Tablet",
          kind: "task",
          scopeLabel: "Server station",
          description:
            "Servers review diner needs, approve or reject them, and route the right requests onward.",
          audience: ["Server staff", "Manager / owner"],
          selectors: {
            prefixes: ["app/server-tablet/"],
          },
          flowsTo: [
            {
              targetId: "functional:kitchen-tablet",
              label: "passes approved requests to kitchen",
            },
            {
              targetId: "functional:notice-storage-alerts",
              label: "updates diner-facing status and alerts",
            },
          ],
        },
        {
          id: "functional:kitchen-tablet",
          label: "Kitchen Tablet",
          kind: "task",
          scopeLabel: "Kitchen station",
          description:
            "Kitchen staff acknowledge, question, or reject requests and push the result back to the diner notice flow.",
          audience: ["Kitchen staff", "Manager / owner"],
          selectors: {
            prefixes: ["app/kitchen-tablet/"],
          },
          flowsTo: [
            {
              targetId: "functional:notice-storage-alerts",
              label: "sends acknowledgements, questions, or rejections back",
            },
          ],
        },
      ],
    },
    {
      id: "functional:admin-support",
      label: "Admin and Support",
      kind: "area",
      scopeLabel: "Administration",
      description:
        "How Clarivore administrators inspect the runtime, support managers, and review reported issues.",
      audience: ["App admin", "Manager / owner"],
      flowsTo: [
        {
          targetId: "functional:restaurant-management",
          label: "supports managers and resolves reported issues",
        },
      ],
      children: [
        {
          id: "functional:admin-dashboard",
          label: "Admin Dashboard and Live System Maps",
          kind: "task",
          scopeLabel: "Admin dashboard",
          description:
            "Admins review restaurant state, manager access, appeals, feedback, and this live system map.",
          audience: ["App admin"],
          selectors: {
            prefixes: ["app/admin-dashboard/"],
          },
        },
        {
          id: "functional:admin-apis",
          label: "Admin APIs and Review Workflows",
          kind: "task",
          scopeLabel: "Admin services",
          description:
            "Admin-only APIs power manager review, appeals, runtime questions, and other protected admin actions.",
          audience: ["App admin"],
          selectors: {
            prefixes: ["app/api/admin/"],
            exact: ["app/api/ingredient-scan-appeals/route.js"],
          },
          flowsTo: [
            {
              targetId: "functional:admin-dashboard",
              label: "powers the protected admin review surfaces",
            },
          ],
        },
        {
          id: "functional:help-support-reporting",
          label: "Help, Contact, and Issue Reporting",
          kind: "task",
          scopeLabel: "Support intake",
          description:
            "Diners and managers can ask for help, contact Clarivore, and submit product issues for follow-up.",
          audience: ["Any user", "App admin"],
          selectors: {
            prefixes: ["app/help-contact/", "app/report-issue/"],
            exact: ["app/api/help-assistant/route.js", "app/api/report-issue/route.js"],
          },
          flowsTo: [
            {
              targetId: "functional:admin-dashboard",
              label: "surfaces support needs and issue reports for review",
            },
          ],
        },
      ],
    },
    {
      id: "functional:shared-platform",
      label: "Shared Platform Services",
      kind: "area",
      scopeLabel: "Cross-cutting support",
      description:
        "Shared UI, auth, state, and background services used across multiple Clarivore experiences.",
      audience: [
        "Diner / guest",
        "Authenticated user",
        "Manager / owner",
        "Server staff",
        "Kitchen staff",
        "App admin",
        "System / cron",
      ],
      flowsTo: [
        {
          targetId: "functional:start-and-identity",
          label: "supports auth, app chrome, and shared entry behavior",
        },
        {
          targetId: "functional:restaurant-menu-experience",
          label: "supplies shared state and restaurant runtime services",
        },
        {
          targetId: "functional:staff-order-handling",
          label: "stores shared notice state and sends updates",
        },
        {
          targetId: "functional:admin-support",
          label: "supports monitoring and runtime inspection tools",
        },
      ],
      children: [
        {
          id: "functional:shared-ui",
          label: "Shared UI and App Chrome",
          kind: "task",
          scopeLabel: "Shared UI",
          description:
            "Reusable layout, topbars, cards, forms, chat previews, and loading shells used throughout Clarivore.",
          audience: ["Any user"],
          selectors: {
            prefixes: ["app/components/"],
            exact: ["app/layout.js", "app/loading.js", "app/globals.css", "app/providers.js"],
          },
          flowsTo: [
            {
              targetId: "functional:shared-data",
              label: "renders shared application state and navigation",
            },
          ],
        },
        {
          id: "functional:shared-data",
          label: "Shared Data, Auth, and Restaurant State",
          kind: "task",
          scopeLabel: "Shared runtime data",
          description:
            "Shared libraries handle auth, restaurant state, user preferences, and reusable runtime logic.",
          audience: [
            "Diner / guest",
            "Authenticated user",
            "Manager / owner",
            "Server staff",
            "Kitchen staff",
            "App admin",
          ],
          selectors: {
            prefixes: ["app/lib/", "app/runtime/"],
          },
          flowsTo: [
            {
              targetId: "functional:platform-services",
              label: "feeds shared state into background services and health checks",
            },
          ],
        },
        {
          id: "functional:platform-services",
          label: "AI, Monitoring, and Runtime Health",
          kind: "task",
          scopeLabel: "Background services",
          description:
            "Background services handle AI dish search, menu monitoring, runtime health, and other shared operational checks.",
          audience: ["App admin", "Manager / owner", "System / cron"],
          selectors: {
            prefixes: [
              "app/api/ai-dish-search/",
              "app/api/monitor-menus/",
            ],
            exact: [
              "app/api/runtime-config-health/route.js",
              "app/api/ingredient-status-sync/route.js",
              "next.config.js",
            ],
          },
        },
        {
          id: "functional:other-runtime-support",
          label: "Remaining Runtime Support",
          kind: "task",
          scopeLabel: "Unassigned support",
          description:
            "Any runtime files that do not fit the primary workflow buckets above still appear here so the map stays complete.",
          audience: ["App admin"],
          matchUnassigned: true,
        },
      ],
    },
  ],
};
