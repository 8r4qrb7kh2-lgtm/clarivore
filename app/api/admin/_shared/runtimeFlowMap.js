export const ADMIN_RUNTIME_FLOW_DIAGRAMS = [
  {
    id: "runtime-root",
    title: "Runtime Codebase Overview",
    description:
      "Primary runtime surfaces and service boundaries for the Next.js app and APIs.",
    blocks: [
      {
        id: "admin-dashboard",
        title: "Admin Dashboard UI",
        summary: "Client boot + tab runtime for administrator-only operations.",
        authorizedUserTypes: ["app_admin"],
        x: 5,
        y: 10,
        width: 23,
        height: 18,
        childDiagramId: "admin-runtime-introspection",
        codeRefs: [
          {
            filePath: "app/admin-dashboard/AdminDashboardClient.js",
            startLine: 11,
            endLine: 95,
          },
          {
            filePath: "app/admin-dashboard/components/AdminDashboardDom.js",
            startLine: 27,
            endLine: 35,
          },
        ],
      },
      {
        id: "manager-dashboard",
        title: "Manager Dashboard UI",
        summary: "Manager/owner boot flow and editor mode routing.",
        authorizedUserTypes: ["restaurant_manager", "restaurant_owner"],
        x: 5,
        y: 42,
        width: 23,
        height: 18,
        codeRefs: [
          {
            filePath: "app/manager-dashboard/ManagerDashboardClient.js",
            startLine: 11,
            endLine: 131,
          },
        ],
      },
      {
        id: "restaurant-surface",
        title: "Restaurant Surface",
        summary: "Public route entrypoint used by diners and managers for menu interactions.",
        authorizedUserTypes: ["guest_diner", "authenticated_user", "restaurant_manager"],
        x: 5,
        y: 74,
        width: 23,
        height: 16,
        codeRefs: [
          {
            filePath: "app/restaurant/page.js",
            startLine: 1,
            endLine: 15,
          },
        ],
      },
      {
        id: "admin-runtime-api",
        title: "Admin Runtime Mapping APIs",
        summary: "Admin-only endpoints powering runtime map drilldown and evidence-backed chat.",
        authorizedUserTypes: ["app_admin"],
        x: 38,
        y: 26,
        width: 26,
        height: 22,
        childDiagramId: "admin-runtime-introspection",
        codeRefs: [
          {
            filePath: "app/api/admin/data-flow-ask/route.js",
            startLine: 405,
            endLine: 520,
          },
        ],
      },
      {
        id: "restaurant-write-api",
        title: "Restaurant Write Gateway",
        summary: "Stage/current/commit/system API routes enforcing write scope and auth boundaries.",
        authorizedUserTypes: ["app_admin", "restaurant_manager", "system_process"],
        x: 38,
        y: 62,
        width: 26,
        height: 22,
        childDiagramId: "restaurant-write-lifecycle",
        codeRefs: [
          {
            filePath: "app/api/restaurant-write/stage/route.js",
            startLine: 24,
            endLine: 246,
          },
          {
            filePath: "app/api/restaurant-write/commit/route.js",
            startLine: 25,
            endLine: 202,
          },
        ],
      },
      {
        id: "runtime-storage",
        title: "Prisma + Postgres Tables",
        summary: "Persistent state for managers, restaurants, and staged write operations.",
        authorizedUserTypes: ["service_backend", "authorized_api_routes"],
        x: 74,
        y: 42,
        width: 21,
        height: 22,
        codeRefs: [
          {
            filePath: "prisma/schema.prisma",
            startLine: 1,
            endLine: 180,
          },
        ],
      },
    ],
    connections: [
      {
        from: "admin-dashboard",
        to: "admin-runtime-api",
        variables: [
          {
            name: "Authorization: Bearer <token>",
            description: "Supabase session token attached by the admin client.",
            usedFor: "Validates app_admin access before exposing runtime map evidence.",
          },
          {
            name: "diagramId / blockId / question",
            description: "Selected runtime map context and user question payload.",
            usedFor: "Targets a specific runtime subsystem and evidence set for chatbot reasoning.",
          },
        ],
      },
      {
        from: "manager-dashboard",
        to: "restaurant-write-api",
        variables: [
          {
            name: "restaurantId",
            description: "Manager-selected restaurant scope.",
            usedFor: "Restricts write reads/staging/commit operations to one restaurant scope.",
          },
          {
            name: "expectedWriteVersion",
            description: "Client-side optimistic concurrency version.",
            usedFor: "Rejects stale staged writes when write scope has changed.",
          },
        ],
      },
      {
        from: "restaurant-surface",
        to: "restaurant-write-api",
        variables: [
          {
            name: "edit / openAI / dishName query flags",
            description: "Route parameters controlling editor activation and focused item context.",
            usedFor: "Drive manager editing workflows that eventually stage write operations.",
          },
        ],
      },
      {
        from: "admin-runtime-api",
        to: "runtime-storage",
        variables: [
          {
            name: "session.userId",
            description: "User identity extracted from bearer token.",
            usedFor: "Checks app_admin membership and gates runtime evidence endpoints.",
          },
        ],
      },
      {
        from: "restaurant-write-api",
        to: "runtime-storage",
        variables: [
          {
            name: "batchId / operationPayload / scopeType",
            description: "Normalized write batch identity and operation payload.",
            usedFor: "Creates, validates, and commits staged writes in restaurant write tables.",
          },
          {
            name: "x-clarivore-system-key",
            description: "System integration key header for internal monitoring writes.",
            usedFor: "Authorizes system-only write operations in /restaurant-write/system.",
          },
        ],
      },
    ],
  },
  {
    id: "admin-runtime-introspection",
    title: "Admin Runtime Introspection Stack",
    description:
      "Detailed internals for how admin runtime mapping + chatbot evidence retrieval works.",
    parentDiagramId: "runtime-root",
    parentBlockId: "admin-runtime-api",
    blocks: [
      {
        id: "runtime-flow-map",
        title: "Runtime Flow Map Definitions",
        summary: "Hierarchical block graph, edges, auth types, and code references.",
        authorizedUserTypes: ["app_admin"],
        x: 6,
        y: 12,
        width: 26,
        height: 20,
        codeRefs: [
          {
            filePath: "app/api/admin/_shared/runtimeFlowMap.js",
            startLine: 1,
            endLine: 420,
          },
        ],
      },
      {
        id: "runtime-flow-read-route",
        title: "GET /api/admin/runtime-flow",
        summary: "Returns diagrams and live code-line snippets for each block reference.",
        authorizedUserTypes: ["app_admin"],
        x: 38,
        y: 12,
        width: 26,
        height: 20,
        codeRefs: [
          {
            filePath: "app/api/admin/runtime-flow/route.js",
            startLine: 1,
            endLine: 260,
          },
        ],
      },
      {
        id: "runtime-flow-ask-route",
        title: "POST /api/admin/runtime-flow-ask",
        summary: "Builds evidence context from latest file contents and asks selected AI provider.",
        authorizedUserTypes: ["app_admin"],
        x: 38,
        y: 44,
        width: 26,
        height: 24,
        codeRefs: [
          {
            filePath: "app/api/admin/runtime-flow-ask/route.js",
            startLine: 1,
            endLine: 340,
          },
        ],
      },
      {
        id: "provider-runtime",
        title: "Provider Runtime",
        summary: "OpenAI/Anthropic selection wrapper used by admin evidence chatbot routes.",
        authorizedUserTypes: ["service_backend"],
        x: 70,
        y: 28,
        width: 24,
        height: 24,
        codeRefs: [
          {
            filePath: "app/lib/server/ai/providerRuntime.js",
            startLine: 1,
            endLine: 260,
          },
        ],
      },
    ],
    connections: [
      {
        from: "runtime-flow-map",
        to: "runtime-flow-read-route",
        variables: [
          {
            name: "diagramId",
            description: "Selected diagram key.",
            usedFor: "Loads a specific flow graph and hydrates referenced code lines.",
          },
        ],
      },
      {
        from: "runtime-flow-map",
        to: "runtime-flow-ask-route",
        variables: [
          {
            name: "block metadata + codeRefs",
            description: "Structured block metadata and associated code references.",
            usedFor: "Builds evidence bundle that grounds chat answers in real files and lines.",
          },
        ],
      },
      {
        from: "runtime-flow-ask-route",
        to: "provider-runtime",
        variables: [
          {
            name: "messages + systemPrompt",
            description: "Prompt payload containing runtime evidence and user question.",
            usedFor: "Generates evidence-grounded answer using configured AI provider.",
          },
        ],
      },
    ],
  },
  {
    id: "restaurant-write-lifecycle",
    title: "Restaurant Write Lifecycle",
    description: "How staged restaurant writes are validated, loaded, and committed.",
    parentDiagramId: "runtime-root",
    parentBlockId: "restaurant-write-api",
    blocks: [
      {
        id: "write-current-route",
        title: "GET /restaurant-write/current",
        summary: "Returns pending staged batch for a requested scope after auth checks.",
        authorizedUserTypes: ["app_admin", "restaurant_manager"],
        x: 6,
        y: 14,
        width: 26,
        height: 20,
        codeRefs: [
          {
            filePath: "app/api/restaurant-write/current/route.js",
            startLine: 24,
            endLine: 95,
          },
        ],
      },
      {
        id: "write-stage-route",
        title: "POST /restaurant-write/stage",
        summary: "Validates requested operation, enforces auth and stale-write protection.",
        authorizedUserTypes: ["app_admin", "restaurant_manager"],
        x: 36,
        y: 12,
        width: 28,
        height: 24,
        codeRefs: [
          {
            filePath: "app/api/restaurant-write/stage/route.js",
            startLine: 24,
            endLine: 246,
          },
        ],
      },
      {
        id: "write-commit-route",
        title: "POST /restaurant-write/commit",
        summary: "Commits pending batches with ownership + write-version checks.",
        authorizedUserTypes: ["app_admin", "restaurant_manager"],
        x: 36,
        y: 44,
        width: 28,
        height: 24,
        codeRefs: [
          {
            filePath: "app/api/restaurant-write/commit/route.js",
            startLine: 25,
            endLine: 202,
          },
        ],
      },
      {
        id: "write-system-route",
        title: "POST /restaurant-write/system",
        summary: "Internal monitoring write path protected by x-clarivore-system-key.",
        authorizedUserTypes: ["system_process"],
        x: 6,
        y: 46,
        width: 26,
        height: 22,
        codeRefs: [
          {
            filePath: "app/api/restaurant-write/system/route.js",
            startLine: 16,
            endLine: 137,
          },
        ],
      },
      {
        id: "write-auth-utils",
        title: "writeGatewayUtils auth + scope logic",
        summary: "Shared auth/session/scope authorization helpers used by write routes.",
        authorizedUserTypes: ["service_backend"],
        x: 68,
        y: 24,
        width: 26,
        height: 28,
        childDiagramId: "write-auth-subsystems",
        codeRefs: [
          {
            filePath: "app/api/restaurant-write/_shared/writeGatewayUtils.js",
            startLine: 1607,
            endLine: 1694,
          },
          {
            filePath: "app/api/restaurant-write/_shared/writeGatewayUtils.js",
            startLine: 1999,
            endLine: 2017,
          },
        ],
      },
    ],
    connections: [
      {
        from: "write-current-route",
        to: "write-auth-utils",
        variables: [
          {
            name: "scopeType / restaurantId / Authorization",
            description: "Requested write scope and bearer session token.",
            usedFor: "Determines whether to require admin-only or restaurant-access session.",
          },
        ],
      },
      {
        from: "write-stage-route",
        to: "write-auth-utils",
        variables: [
          {
            name: "operationType / restaurantId",
            description: "Normalized operation target.",
            usedFor: "Routes auth checks via authorizeWriteStage for admin-only vs scoped writes.",
          },
          {
            name: "expectedWriteVersion",
            description: "Client write version hint.",
            usedFor: "Prevents stale staging when server write version has advanced.",
          },
        ],
      },
      {
        from: "write-commit-route",
        to: "write-auth-utils",
        variables: [
          {
            name: "batchId + session.userId",
            description: "Pending batch identity and current user identity.",
            usedFor: "Ensures user owns batch and has required admin/manager rights before apply.",
          },
        ],
      },
      {
        from: "write-system-route",
        to: "write-auth-utils",
        variables: [
          {
            name: "x-clarivore-system-key",
            description: "System key header value.",
            usedFor: "Allows only internal process writes for monitoring stats operation type.",
          },
        ],
      },
    ],
  },
  {
    id: "write-auth-subsystems",
    title: "Write Auth Subsystems",
    description: "Leaf-level auth helpers used by restaurant write routes.",
    parentDiagramId: "restaurant-write-lifecycle",
    parentBlockId: "write-auth-utils",
    blocks: [
      {
        id: "require-authenticated-session",
        title: "requireAuthenticatedSession",
        summary: "Parses bearer token and resolves Supabase user identity.",
        authorizedUserTypes: ["authenticated_user"],
        x: 6,
        y: 16,
        width: 28,
        height: 22,
        codeRefs: [
          {
            filePath: "app/api/restaurant-write/_shared/writeGatewayUtils.js",
            startLine: 1607,
            endLine: 1624,
          },
        ],
      },
      {
        id: "require-admin-session",
        title: "requireAdminSession + isAppAdminUser",
        summary: "Checks app_admin membership in public.app_admins.",
        authorizedUserTypes: ["app_admin"],
        x: 38,
        y: 16,
        width: 28,
        height: 22,
        codeRefs: [
          {
            filePath: "app/api/restaurant-write/_shared/writeGatewayUtils.js",
            startLine: 1626,
            endLine: 1662,
          },
        ],
      },
      {
        id: "restaurant-access-session",
        title: "requireRestaurantAccessSession",
        summary: "Allows app_admin or manager linked to the specific restaurant_id.",
        authorizedUserTypes: ["app_admin", "restaurant_manager"],
        x: 70,
        y: 16,
        width: 24,
        height: 22,
        codeRefs: [
          {
            filePath: "app/api/restaurant-write/_shared/writeGatewayUtils.js",
            startLine: 1664,
            endLine: 1694,
          },
        ],
      },
      {
        id: "authorize-write-stage",
        title: "authorizeWriteStage",
        summary: "Routes each operation type to the correct auth helper.",
        authorizedUserTypes: ["app_admin", "restaurant_manager", "authenticated_user"],
        x: 30,
        y: 52,
        width: 40,
        height: 24,
        codeRefs: [
          {
            filePath: "app/api/restaurant-write/_shared/writeGatewayUtils.js",
            startLine: 1999,
            endLine: 2017,
          },
        ],
      },
    ],
    connections: [
      {
        from: "authorize-write-stage",
        to: "require-authenticated-session",
        variables: [
          {
            name: "Authorization bearer token",
            description: "Token parsed from request authorization header.",
            usedFor: "Resolves user identity before any write authorization checks.",
          },
        ],
      },
      {
        from: "authorize-write-stage",
        to: "require-admin-session",
        variables: [
          {
            name: "ADMIN_ONLY_OPS membership",
            description: "Operation type classification.",
            usedFor: "Forces app_admin permissions for admin-only operations.",
          },
        ],
      },
      {
        from: "authorize-write-stage",
        to: "restaurant-access-session",
        variables: [
          {
            name: "restaurantId + RESTAURANT_SCOPED_OPS",
            description: "Restaurant scope identifier and operation classification.",
            usedFor: "Enforces manager ownership for scoped restaurant operations.",
          },
        ],
      },
    ],
  },
];

const RUNTIME_FLOW_BY_ID = new Map(
  ADMIN_RUNTIME_FLOW_DIAGRAMS.map((entry) => [entry.id, entry]),
);

export function getRuntimeFlowDiagramById(diagramId) {
  const safeId = String(diagramId || "").trim();
  return RUNTIME_FLOW_BY_ID.get(safeId) || null;
}

export function listRuntimeFlowDiagramSummaries() {
  return ADMIN_RUNTIME_FLOW_DIAGRAMS.map((entry) => ({
    id: entry.id,
    title: entry.title,
    description: entry.description,
    parentDiagramId: entry.parentDiagramId || "",
    parentBlockId: entry.parentBlockId || "",
  }));
}
