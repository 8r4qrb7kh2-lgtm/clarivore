"use client";

import AppTopbar from "../../../components/AppTopbar";
import PageShell from "../../../components/PageShell";
import PageHeading from "../../../components/surfaces/PageHeading";
import { useIngredientScanController } from "../../../components/ingredient-scan/useIngredientScanController";
import { useAccommodationBreakdown } from "./hooks/useAccommodationBreakdown";
import { useAccommodationRequests } from "./hooks/useAccommodationRequests";
import { useBrandManagement } from "./hooks/useBrandManagement";
import { useConfirmationPanel } from "./hooks/useConfirmationPanel";
import { useConfirmationReminder } from "./hooks/useConfirmationReminder";
import { useDashboardRuntimeConfig } from "./hooks/useDashboardRuntimeConfig";
import { useDashboardViewState } from "./hooks/useDashboardViewState";
import { useDishModalData } from "./hooks/useDishModalData";
import { useHeatmapMetrics } from "./hooks/useHeatmapMetrics";
import { useManagerChat } from "./hooks/useManagerChat";
import { useManagerIdentity } from "./hooks/useManagerIdentity";
import { useRecentChanges } from "./hooks/useRecentChanges";
import { useRestaurantDashboardData } from "./hooks/useRestaurantDashboardData";
import { useSelectedRestaurant } from "./hooks/useSelectedRestaurant";
import { useTransientStatus } from "./hooks/useTransientStatus";
import { useUserDietaryBreakdown } from "./hooks/useUserDietaryBreakdown";
import {
  AccessRequiredState,
  AuthRequiredState,
  DashboardMessages,
  LoadingState,
  RestaurantSelector,
} from "./sections/DashboardAccessStates";
import { ChangesAndBrandsSection } from "./sections/ChangesAndBrandsSection";
import { DishAnalyticsModal } from "./sections/DishAnalyticsModal";
import { HeatmapSection } from "./sections/HeatmapSection";
import { QuickActionsSection } from "./sections/QuickActionsSection";
import { RequestActionModal } from "./sections/RequestActionModal";
import { RequestsAndSuggestionsSection } from "./sections/RequestsAndSuggestionsSection";
import { UserDietaryProfileSection } from "./sections/UserDietaryProfileSection";

// Main manager dashboard composition component.
// This file intentionally orchestrates hooks and passes data into section components;
// heavy business logic lives in hooks/utils for readability and testability.
export default function ManagerDashboardDomRoot({
  user,
  isOwner = false,
  isManagerOrOwner = false,
  managerRestaurants = [],
  managerMode = "editor",
  isBooting = false,
  onModeChange,
  onSignOut,
}) {
  const ingredientScan = useIngredientScanController();

  const {
    ALLERGENS,
    DIETS,
    ALLERGEN_EMOJI,
    DIET_EMOJI,
    normalizeAllergen,
    normalizeDietLabel,
    formatAllergenLabel,
  } = useDashboardRuntimeConfig();

  const { managerDisplayName, hasManagerAccess } = useManagerIdentity({
    user,
    isManagerOrOwner,
    managerRestaurants,
  });

  const { selectedRestaurantId, setSelectedRestaurantId, selectedRestaurant } = useSelectedRestaurant({
    managerRestaurants,
  });

  const { statusMessage, setStatus } = useTransientStatus();

  const {
    chatMessages,
    chatUnreadCount,
    chatInput,
    setChatInput,
    chatSending,
    chatListRef,
    clearChatState,
    loadChatState,
    onSendChatMessage,
    onAcknowledgeChat,
    managerChatAckByIndex,
  } = useManagerChat({
    selectedRestaurantId,
    managerDisplayName,
    userId: user?.id,
    setStatus,
  });

  const {
    isLoadingDashboard,
    dashboardError,
    currentRestaurantData,
    setCurrentRestaurantData,
    recentChangeLogs,
    dishAnalytics,
    accommodationRequests,
    setAccommodationRequests,
    rawInteractions,
    rawLoves,
    dishOrders,
  } = useRestaurantDashboardData({
    hasManagerAccess,
    selectedRestaurantId,
    loadChatState,
    clearChatState,
    onRestaurantDataLoaded: () => {
      // Clearing composed message text after reload avoids sending stale drafts to a different restaurant.
      setChatInput("");
    },
  });

  useConfirmationReminder({
    currentRestaurantData,
    selectedRestaurantId,
    loadChatState,
  });

  const {
    requestFilter,
    setRequestFilter,
    pendingRequestCount,
    filteredRequests,
    activeRequestAction,
    activeRequestActionConfig,
    requestResponseText,
    setRequestResponseText,
    isUpdatingRequest,
    openRequestActionModal,
    closeRequestActionModal,
    submitRequestAction,
    resetRequestUIForRestaurantChange,
  } = useAccommodationRequests({
    accommodationRequests,
    setAccommodationRequests,
    selectedRestaurantId,
    userId: user?.id,
    setStatus,
    dishAnalytics,
    ALLERGENS,
    normalizeAllergen,
    normalizeDietLabel,
    formatAllergenLabel,
  });

  const {
    heatmapMetric,
    setHeatmapMetric,
    heatmapPage,
    setHeatmapPage,
    activeDishName,
    setActiveDishName,
    activeTooltipId,
    setActiveTooltipId,
  } = useDashboardViewState({
    selectedRestaurantId,
    onRestaurantChange: resetRequestUIForRestaurantChange,
  });

  const {
    allOverlays,
    menuImages,
    pageOverlays,
    userProfilesById,
    metricByDish,
    metricBounds,
    heatmapMetricLabel,
  } = useHeatmapMetrics({
    currentRestaurantData,
    heatmapMetric,
    heatmapPage,
    setHeatmapPage,
    rawInteractions,
    rawLoves,
    dishOrders,
    accommodationRequests,
    normalizeAllergen,
    normalizeDietLabel,
  });

  const accommodationBreakdown = useAccommodationBreakdown({
    allOverlays,
    rawInteractions,
    ALLERGENS,
    DIETS,
    normalizeAllergen,
    normalizeDietLabel,
  });

  const userDietaryBreakdown = useUserDietaryBreakdown({
    rawInteractions,
    ALLERGENS,
    DIETS,
    ALLERGEN_EMOJI,
    DIET_EMOJI,
    normalizeAllergen,
    normalizeDietLabel,
    formatAllergenLabel,
  });

  const dishModalData = useDishModalData({
    activeDishName,
    allOverlays,
    accommodationRequests,
    rawInteractions,
    rawLoves,
    dishOrders,
    userProfilesById,
    DIETS,
    normalizeAllergen,
    normalizeDietLabel,
  });

  const {
    onViewFullLog,
    previewChangeLogs,
    recentChangesLoading,
  } = useRecentChanges({
    currentRestaurantData,
    recentChangeLogs,
    isLoadingDashboard,
    dashboardError,
  });

  const {
    confirmationInfo,
    onConfirmNow,
  } = useConfirmationPanel({ currentRestaurantData });

  const {
    brandSearchQuery,
    setBrandSearchQuery,
    expandedBrandKeys,
    isReplacingBrand,
    brandItems,
    filteredBrandItems,
    onToggleBrandItem,
    onOpenDishEditor,
    onReplaceBrand,
  } = useBrandManagement({
    currentRestaurantData,
    setStatus,
  });

  const showRestaurantSelector = isOwner;
  const dashboardVisible = hasManagerAccess && !isLoadingDashboard;

  return (
    <PageShell
      shellClassName="page-shell route-manager-dashboard"
      contentClassName="dashboard-container"
      topbar={
        <AppTopbar
          mode={managerMode === "editor" ? "editor" : "customer"}
          user={user || null}
          managerRestaurants={managerRestaurants}
          currentRestaurantSlug={selectedRestaurant?.slug || ""}
          onSignOut={onSignOut}
          onModeChange={onModeChange}
        />
      }
    >
      <PageHeading
        className="dashboard-header"
        title="Restaurant Manager Dashboard"
        subtitle="View customer dietary analytics and accommodation requests"
      />

      <RestaurantSelector
        showRestaurantSelector={showRestaurantSelector}
        selectedRestaurantId={selectedRestaurantId}
        setSelectedRestaurantId={setSelectedRestaurantId}
        managerRestaurants={managerRestaurants}
      />

      <AuthRequiredState user={user} />

      <AccessRequiredState user={user} hasManagerAccess={hasManagerAccess} isBooting={isBooting} />

      <LoadingState
        isBooting={isBooting}
        hasManagerAccess={hasManagerAccess}
        isLoadingDashboard={isLoadingDashboard}
      />

      <DashboardMessages dashboardError={dashboardError} statusMessage={statusMessage} />

      {dashboardVisible ? (
        <div id="dashboard-content">
          <QuickActionsSection
            chatUnreadCount={chatUnreadCount}
            chatMessages={chatMessages}
            managerChatAckByIndex={managerChatAckByIndex}
            chatInput={chatInput}
            setChatInput={setChatInput}
            onSendChatMessage={onSendChatMessage}
            onAcknowledgeChat={onAcknowledgeChat}
            chatSending={chatSending}
            managerDisplayName={managerDisplayName}
            chatListRef={chatListRef}
          />

          <RequestsAndSuggestionsSection
            pendingRequestCount={pendingRequestCount}
            requestFilter={requestFilter}
            setRequestFilter={setRequestFilter}
            filteredRequests={filteredRequests}
            openRequestActionModal={openRequestActionModal}
            confirmationInfo={confirmationInfo}
            onConfirmNow={onConfirmNow}
            normalizeAllergen={normalizeAllergen}
            normalizeDietLabel={normalizeDietLabel}
            ALLERGEN_EMOJI={ALLERGEN_EMOJI}
            DIET_EMOJI={DIET_EMOJI}
            formatAllergenLabel={formatAllergenLabel}
          />

          <ChangesAndBrandsSection
            recentChangesLoading={recentChangesLoading}
            previewChangeLogs={previewChangeLogs}
            onViewFullLog={onViewFullLog}
            currentRestaurantData={currentRestaurantData}
            brandSearchQuery={brandSearchQuery}
            setBrandSearchQuery={setBrandSearchQuery}
            brandItems={brandItems}
            filteredBrandItems={filteredBrandItems}
            expandedBrandKeys={expandedBrandKeys}
            onToggleBrandItem={onToggleBrandItem}
            onOpenDishEditor={onOpenDishEditor}
            isReplacingBrand={isReplacingBrand}
            onReplaceBrand={onReplaceBrand}
          />

          <HeatmapSection
            heatmapMetric={heatmapMetric}
            setHeatmapMetric={setHeatmapMetric}
            metricByDish={metricByDish}
            metricBounds={metricBounds}
            heatmapMetricLabel={heatmapMetricLabel}
            menuImages={menuImages}
            allOverlays={allOverlays}
            pageOverlays={pageOverlays}
            heatmapPage={heatmapPage}
            setHeatmapPage={setHeatmapPage}
            setActiveDishName={setActiveDishName}
            accommodationBreakdown={accommodationBreakdown}
            activeTooltipId={activeTooltipId}
            setActiveTooltipId={setActiveTooltipId}
            ALLERGEN_EMOJI={ALLERGEN_EMOJI}
            DIET_EMOJI={DIET_EMOJI}
            formatAllergenLabel={formatAllergenLabel}
          />

          <UserDietaryProfileSection userDietaryBreakdown={userDietaryBreakdown} />
        </div>
      ) : null}

      <RequestActionModal
        activeRequestAction={activeRequestAction}
        activeRequestActionConfig={activeRequestActionConfig}
        requestResponseText={requestResponseText}
        setRequestResponseText={setRequestResponseText}
        isUpdatingRequest={isUpdatingRequest}
        closeRequestActionModal={closeRequestActionModal}
        submitRequestAction={submitRequestAction}
      />

      <DishAnalyticsModal
        dishModalData={dishModalData}
        setActiveDishName={setActiveDishName}
        ALLERGEN_EMOJI={ALLERGEN_EMOJI}
        DIET_EMOJI={DIET_EMOJI}
        formatAllergenLabel={formatAllergenLabel}
      />

      {/* Keep ingredient scan modal mounted at root so any dashboard action can open it. */}
      {ingredientScan.modalNode}
    </PageShell>
  );
}
