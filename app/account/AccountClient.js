"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppTopbar from "../components/AppTopbar";
import AppLoadingScreen from "../components/AppLoadingScreen";
import PageShell from "../components/PageShell";
import { buildAllergenDietConfig, loadAllergenDietConfig } from "../lib/allergenConfig";
import {
  fetchManagerRestaurants,
  isManagerUser,
  isOwnerUser,
} from "../lib/managerRestaurants";
import {
  DEFAULT_PUSH_PUBLIC_KEY,
  isNativePlatform,
  supabaseClient as supabase,
} from "../lib/supabase";
import {
  applyManagerInviteToCurrentUser,
  checkIfNeedsOnboarding,
  clearQrSelections,
  deleteUserAccount,
  getDefaultPostLoginPath,
  getInviteValidation,
  grantManagerInviteAccess,
  loadUserPreferences,
  readQrSelections,
  resolveRedirectPath,
  saveAllergies,
  saveDiets,
  toSortedKey,
} from "./accountService";

const NATIVE_AUTH_SCHEME = "com.clarivore.app";
const NATIVE_AUTH_CALLBACK = "auth-callback";

function statusClass(kind) {
  if (!kind) return "status-text";
  return `status-text ${kind}`;
}

function useFormState(initial) {
  const [value, setValue] = useState(initial);
  const update = (field, nextValue) => {
    setValue((prev) => ({ ...prev, [field]: nextValue }));
  };
  return [value, update, setValue];
}

export default function AccountClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const redirectParam = searchParams?.get("redirect") || "";
  const inviteToken = searchParams?.get("invite") || "";
  const modeParam = searchParams?.get("mode") || "";

  const [config, setConfig] = useState(() => buildAllergenDietConfig());
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("signin");
  const [user, setUser] = useState(null);
  const [managerRestaurants, setManagerRestaurants] = useState([]);
  const [showPreferences, setShowPreferences] = useState(true);
  const [inviteBannerVisible, setInviteBannerVisible] = useState(false);
  const [invitePrompt, setInvitePrompt] = useState(null);
  const [invitePromptBusy, setInvitePromptBusy] = useState(false);

  const [authStatus, setAuthStatus] = useState({ message: "", kind: "" });
  const [signupStatus, setSignupStatus] = useState({ message: "", kind: "" });
  const [detailsStatus, setDetailsStatus] = useState({ message: "", kind: "" });
  const [allergyStatus, setAllergyStatus] = useState({ message: "", kind: "" });
  const [dietStatus, setDietStatus] = useState({ message: "", kind: "" });
  const [onboardingStatus, setOnboardingStatus] = useState({ message: "", kind: "" });
  const [recoveryStatus, setRecoveryStatus] = useState({ message: "", kind: "" });

  const [loginForm, setLoginField] = useFormState({ email: "", password: "" });
  const [signupForm, setSignupField] = useFormState({ email: "", password: "" });
  const [profileForm, setProfileField, setProfileForm] = useFormState({
    firstName: "",
    lastName: "",
    email: "",
  });
  const [onboardingForm, setOnboardingField, setOnboardingForm] = useFormState({
    firstName: "",
    lastName: "",
  });
  const [recoveryForm, setRecoveryField] = useFormState({ password: "", confirm: "" });

  const [selectedAllergies, setSelectedAllergies] = useState([]);
  const [selectedDiets, setSelectedDiets] = useState([]);
  const [savedAllergies, setSavedAllergies] = useState([]);
  const [savedDiets, setSavedDiets] = useState([]);
  const [savedProfile, setSavedProfile] = useState({ firstName: "", lastName: "", email: "" });

  const [onboardingAllergies, setOnboardingAllergies] = useState([]);
  const [onboardingDiets, setOnboardingDiets] = useState([]);

  const [showDeleteWarning, setShowDeleteWarning] = useState(false);

  const inviteValidationCache = useRef(null);

  const {
    ALLERGENS,
    DIETS,
    normalizeAllergen,
    normalizeDietLabel,
    formatAllergenLabel,
    getAllergenEmoji,
    getDietEmoji,
  } = config;

  const isOwner = isOwnerUser(user);
  const isManager = isManagerUser(user);
  const isManagerOrOwner = isOwner || isManager;

  const detailsChanged =
    profileForm.firstName !== savedProfile.firstName ||
    profileForm.lastName !== savedProfile.lastName ||
    profileForm.email !== savedProfile.email;

  const allergiesChanged = toSortedKey(selectedAllergies) !== toSortedKey(savedAllergies);
  const dietsChanged = toSortedKey(selectedDiets) !== toSortedKey(savedDiets);

  const initConfig = useCallback(async () => {
    if (!supabase) return;
    const loaded = await loadAllergenDietConfig(supabase);
    setConfig(loaded);
  }, []);

  const refreshAuthState = useCallback(async () => {
    if (!supabase) {
      setAuthStatus({ message: "Supabase env vars are missing.", kind: "error" });
      setLoading(false);
      return;
    }

    const hashParams =
      typeof window !== "undefined"
        ? new URLSearchParams((window.location.hash || "").replace(/^#/, ""))
        : new URLSearchParams();
    const isRecoveryMode = hashParams.get("type") === "recovery";

    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();

    setUser(currentUser || null);

    if (!currentUser) {
      setManagerRestaurants([]);
      setInviteBannerVisible(Boolean(inviteToken));
      setShowDeleteWarning(false);
      setMode(modeParam === "signup" ? "signup" : isRecoveryMode ? "recovery" : "signin");
      setLoading(false);
      return;
    }

    const managerList = await fetchManagerRestaurants(supabase, currentUser);
    setManagerRestaurants(managerList);

    if (inviteToken) {
      const promptKey = `invitePromptSeen:${inviteToken}`;
      const alreadyPrompted = sessionStorage.getItem(promptKey) === "1";
      if (!alreadyPrompted) {
        const validation = await getInviteValidation(
          supabase,
          inviteToken,
          inviteValidationCache,
        );
        if (validation.isValid) {
          setInvitePrompt(validation);
        }
      }
    }

    if (isRecoveryMode) {
      setMode("recovery");
      setLoading(false);
      return;
    }

    const needsOnboarding = await checkIfNeedsOnboarding(supabase, currentUser);
    if (needsOnboarding) {
      setMode("onboarding");
      const firstName = currentUser?.user_metadata?.first_name || "";
      const lastName = currentUser?.user_metadata?.last_name || "";
      setOnboardingForm({ firstName, lastName });

      const qrSelections = readQrSelections({
        normalizeAllergen,
        normalizeDietLabel,
        ALLERGENS,
        DIETS,
      });
      setOnboardingAllergies(qrSelections.allergies);
      setOnboardingDiets(qrSelections.diets);

      if (inviteToken) {
        const validation = await getInviteValidation(
          supabase,
          inviteToken,
          inviteValidationCache,
        );
        if (validation.isValid) {
          setOnboardingAllergies([]);
          setOnboardingDiets([]);
        }
      }

      setLoading(false);
      return;
    }

    setMode("account");

    const firstName = currentUser?.user_metadata?.first_name || "";
    const lastName = currentUser?.user_metadata?.last_name || "";
    const email = currentUser?.email || "";
    setProfileForm({ firstName, lastName, email });
    setSavedProfile({ firstName, lastName, email });

    const isEditorMode =
      typeof window !== "undefined" &&
      localStorage.getItem("clarivoreManagerMode") === "editor";
    setShowPreferences(!(isManagerOrOwner && isEditorMode));

    if (!(isManagerOrOwner && isEditorMode)) {
      const { allergies, diets, hadFilteredAllergies } = await loadUserPreferences(
        supabase,
        currentUser,
        { normalizeAllergen, normalizeDietLabel, ALLERGENS },
      );
      setSelectedAllergies(allergies);
      setSavedAllergies(allergies);
      setSelectedDiets(diets);
      setSavedDiets(diets);

      if (hadFilteredAllergies) {
        await saveAllergies(supabase, currentUser.id, allergies, normalizeAllergen);
      }
    }

    const destination = resolveRedirectPath(redirectParam);
    if (destination) {
      if (destination.startsWith("http://") || destination.startsWith("https://")) {
        window.location.href = destination;
      } else {
        router.replace(destination);
      }
      return;
    }

    setLoading(false);
  }, [
    ALLERGENS,
    DIETS,
    inviteToken,
    isManagerOrOwner,
    modeParam,
    normalizeAllergen,
    normalizeDietLabel,
    redirectParam,
    router,
    setOnboardingForm,
    setProfileForm,
  ]);

  useEffect(() => {
    initConfig();
  }, [initConfig]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.CLARIVORE_PUSH_PUBLIC_KEY = DEFAULT_PUSH_PUBLIC_KEY;
    }
  }, []);

  useEffect(() => {
    refreshAuthState();
  }, [refreshAuthState]);

  useEffect(() => {
    if (!supabase) return () => {};
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      refreshAuthState();
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [refreshAuthState]);

  const handleNativeOAuthUrl = useCallback(
    async (url) => {
      if (!url || !url.startsWith(`${NATIVE_AUTH_SCHEME}://`)) return;
      try {
        const parsedUrl = new URL(url);
        const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#/, ""));
        const qs = parsedUrl.searchParams;
        const errorDescription =
          qs.get("error_description") ||
          hashParams.get("error_description") ||
          qs.get("error") ||
          hashParams.get("error");

        if (errorDescription) {
          throw new Error(errorDescription);
        }

        const code = qs.get("code") || hashParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          const accessToken =
            hashParams.get("access_token") || qs.get("access_token");
          const refreshToken =
            hashParams.get("refresh_token") || qs.get("refresh_token");
          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
              expires_in: Number(hashParams.get("expires_in") || 0) || undefined,
              token_type: hashParams.get("token_type") || undefined,
            });
            if (error) throw error;
          }
        }

        const browser =
          window.Capacitor?.Plugins?.Browser || window.Capacitor?.Browser;
        if (browser?.close) {
          await browser.close();
        }

        await refreshAuthState();
      } catch (error) {
        setAuthStatus({
          message: error?.message || "OAuth sign-in failed.",
          kind: "error",
        });
      }
    },
    [refreshAuthState],
  );

  useEffect(() => {
    if (!isNativePlatform()) return () => {};

    const app =
      window.Capacitor?.Plugins?.App || window.Capacitor?.App || window.App;
    if (!app?.addListener) return () => {};

    const listener = app.addListener("appUrlOpen", ({ url }) => {
      handleNativeOAuthUrl(url);
    });

    if (app?.getLaunchUrl) {
      app
        .getLaunchUrl()
        .then(({ url }) => {
          if (url) {
            handleNativeOAuthUrl(url);
          }
        })
        .catch(() => {});
    }

    return () => {
      if (listener && typeof listener.remove === "function") {
        listener.remove();
      }
    };
  }, [handleNativeOAuthUrl]);

  const handleOAuth = async (provider) => {
    if (!supabase) return;

    setAuthStatus({ message: "", kind: "" });

    try {
      const native = isNativePlatform();
      const qs = new URLSearchParams();
      if (redirectParam) qs.set("redirect", redirectParam);
      if (inviteToken) qs.set("invite", inviteToken);

      const redirectTo = native
        ? `${NATIVE_AUTH_SCHEME}://${NATIVE_AUTH_CALLBACK}`
        : `${window.location.origin}/account${qs.toString() ? `?${qs.toString()}` : ""}`;

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: native,
        },
      });

      if (error) throw error;

      if (native && data?.url) {
        const browser =
          window.Capacitor?.Plugins?.Browser || window.Capacitor?.Browser;
        if (browser?.open) {
          await browser.open({ url: data.url });
        } else {
          window.location.href = data.url;
        }
      }
    } catch (error) {
      setAuthStatus({ message: error?.message || "OAuth sign-in failed.", kind: "error" });
    }
  };

  const handleLogin = async () => {
    if (!supabase) return;

    const email = loginForm.email.trim();
    const password = loginForm.password;

    setAuthStatus({ message: "", kind: "" });
    if (!email || !password) {
      setAuthStatus({ message: "Please enter your email and password.", kind: "error" });
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthStatus({ message: error.message, kind: "error" });
      return;
    }

    await refreshAuthState();
  };

  const handleForgotPassword = async () => {
    if (!supabase) return;

    const email = loginForm.email.trim();
    setAuthStatus({ message: "", kind: "" });
    if (!email) {
      setAuthStatus({
        message: "Enter your email first, then tap \"Forgot your password?\"",
        kind: "error",
      });
      return;
    }

    try {
      const redirectTo = `${window.location.origin}/account#type=recovery`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setAuthStatus({
        message: "Password reset email sent. Check your inbox.",
        kind: "success",
      });
    } catch (error) {
      setAuthStatus({
        message: error?.message || "Unable to send reset email.",
        kind: "error",
      });
    }
  };

  const handleSignup = async () => {
    if (!supabase) return;

    const email = signupForm.email.trim();
    const password = signupForm.password;

    setSignupStatus({ message: "", kind: "" });
    if (!email || !password) {
      setSignupStatus({ message: "Please enter both email and password.", kind: "error" });
      return;
    }

    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setSignupStatus({ message: error.message, kind: "error" });
      return;
    }

    setSignupStatus({
      message: "Account created. Check your email to confirm.",
      kind: "success",
    });

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      await refreshAuthState();
    }
  };

  const handleProfileSave = async () => {
    if (!supabase || !user) return;

    setDetailsStatus({ message: "", kind: "" });

    const firstName = profileForm.firstName.trim();
    const lastName = profileForm.lastName.trim();
    const email = profileForm.email.trim();

    if (!firstName || !lastName || !email) {
      setDetailsStatus({
        message: "Please fill in your first name, last name, and email.",
        kind: "error",
      });
      return;
    }

    const payload = {
      data: { first_name: firstName, last_name: lastName },
    };

    if (email !== user.email) {
      payload.email = email;
    }

    const { data, error } = await supabase.auth.updateUser(payload);
    if (error) {
      setDetailsStatus({ message: error.message, kind: "error" });
      return;
    }

    const nextUser = data?.user || user;
    setUser(nextUser);
    setSavedProfile({ firstName, lastName, email });
    setDetailsStatus({ message: "Saved.", kind: "success" });
  };

  const handleSaveAllergies = async () => {
    if (!supabase || !user) return;

    setAllergyStatus({ message: "", kind: "" });
    try {
      await saveAllergies(supabase, user.id, selectedAllergies, normalizeAllergen);
      setSavedAllergies([...selectedAllergies]);
      setAllergyStatus({ message: "Saved.", kind: "success" });
    } catch (error) {
      setAllergyStatus({
        message: error?.message || "Failed to save allergies.",
        kind: "error",
      });
    }
  };

  const handleSaveDiets = async () => {
    if (!supabase || !user) return;

    setDietStatus({ message: "", kind: "" });
    try {
      await saveDiets(supabase, user.id, selectedDiets, normalizeDietLabel);
      setSavedDiets([...selectedDiets]);
      setDietStatus({ message: "Saved.", kind: "success" });
    } catch (error) {
      setDietStatus({
        message: error?.message || "Failed to save diets.",
        kind: "error",
      });
    }
  };

  const handleOnboardingComplete = async () => {
    if (!supabase || !user) return;

    setOnboardingStatus({ message: "", kind: "" });

    const firstName = onboardingForm.firstName.trim();
    const lastName = onboardingForm.lastName.trim();
    if (!firstName || !lastName) {
      setOnboardingStatus({
        message: "Please enter your first and last name.",
        kind: "error",
      });
      return;
    }

    try {
      let role = "customer";
      let restaurantIds = [];
      let inviteValidation = null;

      if (inviteToken) {
        inviteValidation = await getInviteValidation(
          supabase,
          inviteToken,
          inviteValidationCache,
        );
        if (inviteValidation.isValid) {
          role = "manager";
          restaurantIds = inviteValidation.invitation?.restaurant_ids || [];
        } else if (inviteValidation.message) {
          setOnboardingStatus({ message: inviteValidation.message, kind: "error" });
        }
      }

      const { data: updatedUserData, error: updateError } = await supabase.auth.updateUser({
        data: {
          first_name: firstName,
          last_name: lastName,
          role,
        },
      });
      if (updateError) throw updateError;

      await supabase.from("user_allergies").upsert(
        {
          user_id: user.id,
          allergens: onboardingAllergies,
          diets: onboardingDiets,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

      if (role === "manager") {
        await grantManagerInviteAccess(supabase, inviteToken, user.id, restaurantIds);
      }

      clearQrSelections();

      const nextUser = updatedUserData?.user || user;
      const destination = getDefaultPostLoginPath(nextUser, redirectParam, inviteValidation);
      if (destination.startsWith("http://") || destination.startsWith("https://")) {
        window.location.href = destination;
      } else {
        router.replace(destination);
      }
    } catch (error) {
      setOnboardingStatus({
        message: error?.message || "Failed to complete setup. Please try again.",
        kind: "error",
      });
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setShowDeleteWarning(false);
    setSelectedAllergies([]);
    setSelectedDiets([]);
    setSavedAllergies([]);
    setSavedDiets([]);
    setOnboardingAllergies([]);
    setOnboardingDiets([]);
    await refreshAuthState();
  };

  const handleDeleteAccount = async () => {
    if (!supabase || !user) return;

    try {
      await deleteUserAccount(supabase, user.id);
      await supabase.auth.signOut();
      router.replace("/");
    } catch (error) {
      setDetailsStatus({
        message: `Failed to delete account: ${error?.message || "Please contact support."}`,
        kind: "error",
      });
    }
  };

  const handleUpdatePassword = async () => {
    if (!supabase) return;

    const password = recoveryForm.password;
    const confirm = recoveryForm.confirm;
    setRecoveryStatus({ message: "", kind: "" });

    if (!password || !confirm) {
      setRecoveryStatus({ message: "Enter and confirm your new password.", kind: "error" });
      return;
    }
    if (password !== confirm) {
      setRecoveryStatus({ message: "Passwords do not match.", kind: "error" });
      return;
    }
    if (password.length < 8) {
      setRecoveryStatus({ message: "Use at least 8 characters.", kind: "error" });
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setRecoveryStatus({ message: error.message, kind: "error" });
      return;
    }

    setRecoveryStatus({ message: "Password updated. You are signed in.", kind: "success" });
    if (typeof window !== "undefined") {
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    }
    setTimeout(() => {
      refreshAuthState();
    }, 800);
  };

  const handleCancelRecovery = () => {
    setRecoveryField("password", "");
    setRecoveryField("confirm", "");
    if (typeof window !== "undefined") {
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    }
    refreshAuthState();
  };

  const handleInviteUseCurrent = async () => {
    if (!supabase || !user || !invitePrompt || invitePromptBusy) return;

    setInvitePromptBusy(true);
    try {
      const promptKey = `invitePromptSeen:${inviteToken}`;
      sessionStorage.setItem(promptKey, "1");

      await applyManagerInviteToCurrentUser(
        supabase,
        inviteToken,
        user,
        invitePrompt,
      );
      localStorage.setItem("clarivoreManagerMode", "editor");
      setInvitePrompt(null);
      router.replace("/manager-dashboard");
    } catch (error) {
      setAuthStatus({ message: error?.message || "Unable to apply invite.", kind: "error" });
      setInvitePromptBusy(false);
    }
  };

  const handleInviteCreateNew = async () => {
    if (!supabase || invitePromptBusy) return;
    setInvitePromptBusy(true);
    const promptKey = `invitePromptSeen:${inviteToken}`;
    sessionStorage.setItem(promptKey, "1");
    await supabase.auth.signOut();
    setInvitePrompt(null);
    router.replace(`/account?mode=signup&invite=${encodeURIComponent(inviteToken)}`);
  };

  const renderChips = (items, selected, setSelected, formatter, emojiGetter) => (
    <div className="allergen-select">
      {items.map((item) => {
        const active = selected.includes(item);
        return (
          <button
            key={item}
            type="button"
            className={`chip${active ? " active" : ""}`}
            onClick={() => {
              setSelected((prev) =>
                prev.includes(item)
                  ? prev.filter((entry) => entry !== item)
                  : [...prev, item],
              );
            }}
          >
            {emojiGetter(item) || ""} {formatter(item)}
          </button>
        );
      })}
    </div>
  );

  if (loading) {
    return <AppLoadingScreen label="account" />;
  }

  return (
    <PageShell
      topbar={
        <AppTopbar
          mode="customer"
          user={user || null}
          signedIn={Boolean(user)}
        />
      }
      afterMain={
        invitePrompt ? (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(8, 12, 26, 0.82)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10001,
              padding: 20,
            }}
          >
            <div
              style={{
                width: "min(520px, 100%)",
                background: "#0f1638",
                border: "1px solid rgba(76,90,212,0.4)",
                borderRadius: 16,
                padding: 24,
                color: "#e9ecff",
              }}
            >
              <h3 style={{ margin: "0 0 12px", fontSize: "1.2rem" }}>Apply manager invite</h3>
              <p style={{ margin: "0 0 20px", color: "#a8b2d6", lineHeight: 1.5 }}>
                You are already signed in. Grant manager access to this account or create a new account for the invite.
              </p>
              <div style={{ display: "grid", gap: 12 }}>
                <button
                  type="button"
                  className="primary-btn"
                  style={{ background: "#17663a", borderColor: "#22c55e" }}
                  disabled={invitePromptBusy}
                  onClick={handleInviteUseCurrent}
                >
                  {invitePromptBusy ? "Granting access..." : "Use current account"}
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={invitePromptBusy}
                  onClick={handleInviteCreateNew}
                >
                  {invitePromptBusy ? "Redirecting..." : "Create a new account"}
                </button>
              </div>
            </div>
          </div>
        ) : null
      }
    >
      <div className="account-layout">
            {inviteBannerVisible ? (
              <div className="auth-card" style={{ background: "linear-gradient(135deg,#4c5ad4,#6366f1)", border: "none" }}>
                <h3 style={{ margin: "0 0 8px", color: "white" }}>
                  You have been invited as a manager
                </h3>
                <p style={{ margin: 0, color: "rgba(255,255,255,0.9)" }}>
                  Create an account or sign in to get manager access to your restaurants.
                </p>
              </div>
            ) : null}

            {mode === "signin" ? (
              <section className="auth-card">
                <h2>Manage your allergy profile</h2>
                <p className="muted-text">
                  Sign in to manage saved allergens and diets.
                </p>

                <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
                  <button
                    className="secondary-btn"
                    type="button"
                    style={{ background: "#000", color: "#fff", borderColor: "#000" }}
                    onClick={() => handleOAuth("apple")}
                  >
                    Sign in with Apple
                  </button>
                  <button className="secondary-btn" type="button" onClick={() => handleOAuth("google")}>
                    Sign in with Google
                  </button>
                </div>

                <input
                  type="email"
                  placeholder="Email"
                  value={loginForm.email}
                  onChange={(event) => setLoginField("email", event.target.value)}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={loginForm.password}
                  onChange={(event) => setLoginField("password", event.target.value)}
                />
                <div className="auth-actions">
                  <button className="primary-btn" type="button" onClick={handleLogin}>
                    Sign in
                  </button>
                  <button
                    className="secondary-btn"
                    type="button"
                    onClick={() => {
                      setSignupField("email", loginForm.email.trim());
                      setSignupField("password", loginForm.password);
                      setMode("signup");
                      setAuthStatus({ message: "", kind: "" });
                      setSignupStatus({ message: "", kind: "" });
                    }}
                  >
                    Create an account
                  </button>
                </div>
                <button className="link-btn" type="button" onClick={handleForgotPassword}>
                  Forgot your password?
                </button>
                <p className={statusClass(authStatus.kind)}>{authStatus.message}</p>
              </section>
            ) : null}

            {mode === "signup" ? (
              <section className="auth-card">
                <div className="auth-actions" style={{ justifyContent: "space-between" }}>
                  <h2 style={{ margin: 0 }}>Create your account</h2>
                  <button className="secondary-btn" type="button" onClick={() => setMode("signin")}>
                    Back
                  </button>
                </div>

                <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
                  <button
                    className="secondary-btn"
                    type="button"
                    style={{ background: "#000", color: "#fff", borderColor: "#000" }}
                    onClick={() => handleOAuth("apple")}
                  >
                    Sign up with Apple
                  </button>
                  <button className="secondary-btn" type="button" onClick={() => handleOAuth("google")}>
                    Sign up with Google
                  </button>
                </div>

                <input
                  type="email"
                  placeholder="Email"
                  value={signupForm.email}
                  onChange={(event) => setSignupField("email", event.target.value)}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={signupForm.password}
                  onChange={(event) => setSignupField("password", event.target.value)}
                />
                <div className="auth-actions">
                  <button className="primary-btn" type="button" onClick={handleSignup}>
                    Create account
                  </button>
                </div>
                <p className={statusClass(signupStatus.kind)}>{signupStatus.message}</p>
              </section>
            ) : null}

            {mode === "recovery" ? (
              <section className="auth-card">
                <h2 style={{ margin: "0 0 12px" }}>Set a new password</h2>
                <p className="muted-text" style={{ marginBottom: 12 }}>
                  Enter a new password for your Clarivore account.
                </p>
                <input
                  type="password"
                  placeholder="New password"
                  value={recoveryForm.password}
                  onChange={(event) => setRecoveryField("password", event.target.value)}
                />
                <input
                  type="password"
                  placeholder="Confirm new password"
                  value={recoveryForm.confirm}
                  onChange={(event) => setRecoveryField("confirm", event.target.value)}
                />
                <div className="auth-actions">
                  <button className="primary-btn" type="button" onClick={handleUpdatePassword}>
                    Update password
                  </button>
                  <button className="secondary-btn" type="button" onClick={handleCancelRecovery}>
                    Cancel
                  </button>
                </div>
                <p className={statusClass(recoveryStatus.kind)}>{recoveryStatus.message}</p>
              </section>
            ) : null}

            {mode === "onboarding" ? (
              <section className="auth-card">
                <h2 style={{ margin: "0 0 12px" }}>Welcome to Clarivore</h2>
                <p className="muted-text" style={{ marginBottom: 16 }}>
                  {inviteToken
                    ? "You are joining as a manager. Complete profile setup to continue."
                    : "Set up your profile to get started."}
                </p>

                <h3 style={{ margin: "8px 0" }}>Your name</h3>
                <div className="form-row">
                  <input
                    type="text"
                    placeholder="First name"
                    value={onboardingForm.firstName}
                    onChange={(event) => setOnboardingField("firstName", event.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Last name"
                    value={onboardingForm.lastName}
                    onChange={(event) => setOnboardingField("lastName", event.target.value)}
                  />
                </div>

                {inviteToken ? null : (
                  <>
                    <h3 style={{ margin: "16px 0 8px" }}>Select your allergens</h3>
                    {renderChips(
                      ALLERGENS,
                      onboardingAllergies,
                      setOnboardingAllergies,
                      formatAllergenLabel,
                      getAllergenEmoji,
                    )}

                    <h3 style={{ margin: "16px 0 8px" }}>Diets</h3>
                    {renderChips(
                      DIETS,
                      onboardingDiets,
                      setOnboardingDiets,
                      (diet) => diet,
                      getDietEmoji,
                    )}
                  </>
                )}

                <div className="auth-actions" style={{ marginTop: 16 }}>
                  <button className="primary-btn" type="button" onClick={handleOnboardingComplete}>
                    Complete setup
                  </button>
                </div>
                <p className={statusClass(onboardingStatus.kind)}>{onboardingStatus.message}</p>
              </section>
            ) : null}

            {mode === "account" ? (
              <>
                <section className="auth-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <h2 style={{ margin: 0 }}>Your information</h2>
                    {detailsChanged ? (
                      <button className="primary-btn" type="button" onClick={handleProfileSave}>
                        Save changes
                      </button>
                    ) : null}
                  </div>
                  <div className="form-row">
                    <input
                      type="text"
                      placeholder="First name"
                      value={profileForm.firstName}
                      onChange={(event) => setProfileField("firstName", event.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Last name"
                      value={profileForm.lastName}
                      onChange={(event) => setProfileField("lastName", event.target.value)}
                    />
                  </div>
                  <input
                    type="email"
                    placeholder="Email"
                    value={profileForm.email}
                    onChange={(event) => setProfileField("email", event.target.value)}
                  />
                  <p className="muted-text">Updating your email sends a confirmation message.</p>
                  <p className={statusClass(detailsStatus.kind)}>{detailsStatus.message}</p>
                </section>

                {showPreferences ? (
                  <section className="auth-card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <h2 style={{ margin: 0 }}>My Allergens</h2>
                      {allergiesChanged ? (
                        <button className="primary-btn" type="button" onClick={handleSaveAllergies}>
                          Save changes
                        </button>
                      ) : null}
                    </div>
                    {renderChips(
                      ALLERGENS,
                      selectedAllergies,
                      setSelectedAllergies,
                      formatAllergenLabel,
                      getAllergenEmoji,
                    )}
                    <p className={statusClass(allergyStatus.kind)}>{allergyStatus.message}</p>
                  </section>
                ) : null}

                {showPreferences ? (
                  <section className="auth-card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <h2 style={{ margin: 0 }}>My Diets</h2>
                      {dietsChanged ? (
                        <button className="primary-btn" type="button" onClick={handleSaveDiets}>
                          Save changes
                        </button>
                      ) : null}
                    </div>
                    {renderChips(DIETS, selectedDiets, setSelectedDiets, (diet) => diet, getDietEmoji)}
                    <p className={statusClass(dietStatus.kind)}>{dietStatus.message}</p>
                  </section>
                ) : null}

                <section className="auth-card">
                  <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                    <button className="secondary-btn" type="button" onClick={handleSignOut}>
                      Sign out
                    </button>
                    <button
                      className="secondary-btn"
                      type="button"
                      style={{ background: "#dc2626", borderColor: "#dc2626", color: "white" }}
                      onClick={() => setShowDeleteWarning(true)}
                    >
                      Delete account
                    </button>
                  </div>

                  {showDeleteWarning ? (
                    <div
                      style={{
                        marginTop: 16,
                        padding: 16,
                        background: "rgba(220,38,38,0.1)",
                        border: "1px solid #dc2626",
                        borderRadius: 8,
                      }}
                    >
                      <p style={{ margin: "0 0 12px", fontWeight: 600, color: "#dc2626" }}>
                        Are you sure you want to delete your account?
                      </p>
                      <p style={{ margin: "0 0 16px", color: "#8891b0", fontSize: "0.9rem" }}>
                        This permanently deletes your account and data.
                      </p>
                      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                        <button className="secondary-btn" type="button" onClick={() => setShowDeleteWarning(false)}>
                          Cancel
                        </button>
                        <button
                          className="primary-btn"
                          type="button"
                          style={{ background: "#dc2626", borderColor: "#dc2626" }}
                          onClick={handleDeleteAccount}
                        >
                          Yes, delete my account
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              </>
            ) : null}
          </div>
    </PageShell>
  );
}
