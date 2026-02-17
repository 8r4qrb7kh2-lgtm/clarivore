import { isOwnerUser } from "../lib/managerRestaurants";

const QR_ALLERGIES_KEY = "qrAllergies";
const QR_DIETS_KEY = "qrDiets";

export function toSortedKey(values = []) {
  return JSON.stringify([...(values || [])].sort());
}

export function readQrSelections({ normalizeAllergen, normalizeDietLabel, ALLERGENS, DIETS }) {
  const selections = { allergies: [], diets: [] };
  try {
    const rawAllergies = sessionStorage.getItem(QR_ALLERGIES_KEY);
    if (rawAllergies) {
      const parsed = JSON.parse(rawAllergies);
      if (Array.isArray(parsed)) {
        selections.allergies = parsed
          .map(normalizeAllergen)
          .filter((key) => ALLERGENS.includes(key));
      }
    }
  } catch (_) {}

  try {
    const rawDiets = sessionStorage.getItem(QR_DIETS_KEY);
    if (rawDiets) {
      const parsed = JSON.parse(rawDiets);
      if (Array.isArray(parsed)) {
        selections.diets = parsed
          .map(normalizeDietLabel)
          .filter((label) => DIETS.includes(label));
      }
    }
  } catch (_) {}

  return selections;
}

export function clearQrSelections() {
  try {
    sessionStorage.removeItem(QR_ALLERGIES_KEY);
    sessionStorage.removeItem(QR_DIETS_KEY);
  } catch (_) {}
}

export function resolveRedirectPath(redirectParam) {
  if (!redirectParam) return "";
  if (redirectParam.startsWith("http://") || redirectParam.startsWith("https://")) {
    return redirectParam;
  }

  const map = {
    restaurants: "/restaurants",
    favorites: "/favorites",
    "dish-search": "/dish-search",
    "my-dishes": "/my-dishes",
    home: "/home",
  };

  return map[redirectParam] || "";
}

export async function checkIfNeedsOnboarding(supabase, user) {
  const firstName = user?.user_metadata?.first_name || "";
  const lastName = user?.user_metadata?.last_name || "";

  if (!firstName || !lastName) return true;

  const { data } = await supabase
    .from("user_allergies")
    .select("allergens, diets")
    .eq("user_id", user.id)
    .maybeSingle();

  return !data;
}

export async function loadUserPreferences(
  supabase,
  user,
  { normalizeAllergen, normalizeDietLabel, ALLERGENS },
) {
  const { data } = await supabase
    .from("user_allergies")
    .select("allergens, diets")
    .eq("user_id", user.id)
    .maybeSingle();

  const dbAllergies = (data?.allergens || []).map(normalizeAllergen).filter(Boolean);
  const allergies = dbAllergies.filter((key) => ALLERGENS.includes(key));
  const diets = (data?.diets || []).map(normalizeDietLabel).filter(Boolean);

  return { allergies, diets, hadFilteredAllergies: dbAllergies.length !== allergies.length };
}

export async function saveAllergies(supabase, userId, allergies, normalizeAllergen) {
  const { data: current } = await supabase
    .from("user_allergies")
    .select("diets")
    .eq("user_id", userId)
    .maybeSingle();

  const payload = {
    user_id: userId,
    allergens: allergies.map(normalizeAllergen).filter(Boolean),
    updated_at: new Date().toISOString(),
  };

  if (current && "diets" in current) {
    payload.diets = current.diets || [];
  }

  const { error } = await supabase
    .from("user_allergies")
    .upsert(payload, { onConflict: "user_id" });
  if (error) throw error;
}

export async function saveDiets(supabase, userId, diets, normalizeDietLabel) {
  const { data: current } = await supabase
    .from("user_allergies")
    .select("allergens, diets")
    .eq("user_id", userId)
    .maybeSingle();

  const payload = {
    user_id: userId,
    allergens: current?.allergens || [],
    updated_at: new Date().toISOString(),
  };

  if (current && "diets" in current) {
    payload.diets = diets.map(normalizeDietLabel).filter(Boolean);
  } else {
    throw new Error("Diets feature requires a database update. Please contact support.");
  }

  const { error } = await supabase
    .from("user_allergies")
    .upsert(payload, { onConflict: "user_id" });
  if (error) throw error;
}

export async function getInviteValidation(supabase, inviteToken, cacheRef) {
  if (!inviteToken) {
    return { token: null, status: "missing", isValid: false, invitation: null, message: "" };
  }

  if (cacheRef.current && cacheRef.current.token === inviteToken) {
    return cacheRef.current;
  }

  const result = {
    token: inviteToken,
    status: "invalid",
    isValid: false,
    invitation: null,
    message: "",
  };

  try {
    const { data: invitation, error: inviteError } = await supabase
      .from("manager_invites")
      .select("*")
      .eq("token", inviteToken)
      .maybeSingle();

    if (inviteError) {
      console.error("Invitation lookup error:", inviteError);
      result.status = "error";
      result.message = "Unable to validate invitation. Continuing as regular user.";
    } else if (!invitation) {
      result.status = "missing";
      result.message = "Invalid invitation link. Continuing as regular user.";
    } else if (invitation.used_at) {
      result.status = "used";
      result.message = "This invitation has already been used. Continuing as regular user.";
    } else if (!invitation.is_active) {
      result.status = "revoked";
      result.message = "This invitation has been revoked. Continuing as regular user.";
    } else if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
      result.status = "expired";
      result.message = "This invitation has expired. Continuing as regular user.";
    } else {
      result.status = "valid";
      result.isValid = true;
      result.invitation = invitation;
    }
  } catch (error) {
    console.error("Invitation lookup failed:", error);
    result.status = "error";
    result.message = "Unable to validate invitation. Continuing as regular user.";
  }

  cacheRef.current = result;
  return result;
}

export async function grantManagerInviteAccess(supabase, inviteToken) {
  const token = String(inviteToken || "").trim();
  if (!token) {
    throw new Error("Invite token is required.");
  }

  const { data, error } = await supabase.rpc("consume_manager_invite", {
    p_token: token,
  });

  if (error) {
    throw error;
  }

  if (!data?.success) {
    throw new Error(
      data?.message || "Manager invite could not be consumed.",
    );
  }

  return {
    restaurantIds: Array.isArray(data?.restaurant_ids) ? data.restaurant_ids : [],
    grantedCount: Number(data?.granted_count) || 0,
  };
}

export async function applyManagerInviteToCurrentUser(
  supabase,
  inviteToken,
  user,
  validation,
) {
  if (!validation?.isValid) {
    throw new Error("Manager invitation is not valid.");
  }

  const grantResult = await grantManagerInviteAccess(
    supabase,
    inviteToken,
  );
  const restaurantIds = Array.isArray(grantResult?.restaurantIds)
    ? grantResult.restaurantIds
    : validation.invitation?.restaurant_ids || [];
  const nextMetadata = { ...(user?.user_metadata || {}), role: "manager" };

  const { data: userData, error: userError } = await supabase.auth.updateUser({
    data: nextMetadata,
  });
  if (userError) throw userError;

  const updatedUser = userData?.user || user;

  return {
    user: updatedUser,
    restaurantIds,
  };
}

export async function deleteUserAccount(supabase, userId) {
  const { error: rpcError } = await supabase.rpc("delete_user");

  if (!rpcError) return;

  console.error("RPC delete error:", rpcError);

  await supabase.from("user_allergies").delete().eq("user_id", userId);
}

export function getDefaultPostLoginPath(user, redirectParam, inviteValidation) {
  const role = user?.user_metadata?.role || user?.role || "customer";
  const isOwner = isOwnerUser(user);

  if (role === "manager" || isOwner || inviteValidation?.isValid) {
    return "/manager-dashboard";
  }

  return resolveRedirectPath(redirectParam) || "/restaurants";
}
