// ===== data setup + shared state =====
const SUPABASE_URL = "https://ncqcqtfnaamcrbhncocv.supabase.co";
const SUPABASE_KEY = "sb_publishable_0XjUw1Y6h99mUso6uJT_uw_dt8sFSHh";
const MEDIA_LOOKUP_API_KEY = "90ac58cabf68cf5afed778c87c192084";
const MEDIA_LOOKUP_BASE_URL = "https://api.themoviedb.org/3";
 if (!window.supabase) {
  console.error("Supabase library failed to load.");
}
 const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
);
 // required Supabase table:
// public.activity_log
// columns:
// id bigint generated always as identity primary key
// title text not null
// item_type text not null
// event_type text not null
// rating integer null
// message text not null
// created_at timestamptz not null default now()
//
// queue_items also uses:
// tags text null
// media_lookup_id text null
// media_lookup_type text null
// media_runtime_minutes integer null
// media_season_count integer null
// media_episode_count integer null
// added_by uuid null references auth.users on delete set null
// added_by_name text null
//
// public.profiles:
// id uuid primary key references auth.users on delete cascade
// display_name text
// theme text default 'raichu'
// preferences jsonb default '{}'::jsonb
//
// activity_log also uses:
// actor_id uuid null references auth.users on delete set null
// actor_name text null
 let movies = [];
let games = [];
let searchTerm = "";
let statusFilter = "all";
let mediaTypeFilter = "all";
let genreFilter = "all";
let platformFilter = "all";
let tagFilter = "all";
let moodFilter = "all";
let personalQueueOnly = false;
let draftQueueTags = [];
let editQueueTags = [];
let moviePage = 1;
let gamePage = 1;
const QUEUE_ITEMS_PER_PAGE = 6;
const FILTERED_WATCHLIST_ITEMS_PER_PAGE = 10;
const PLAN_ITEMS_PER_PAGE = 5;
let activityLog = [];
let planSearchTerm = "";
let editItemContext = null;
let currentUser = null;
let currentProfile = null;
let profileSaveTimer = null;
let accountMessageTimer = null;
let activityLogRefreshTimer = null;
let activityLogPollTimer = null;
let mediaMetadataColumnsAvailable = true;
const pendingMetadataBackfills = new Set();
let mediaMetadataBackfillRunning = false;
let mediaMetadataReloadTimer = null;
const mediaSuggestionState = {
  add: { timer: null, requestId: 0, selected: null, results: [] },
  edit: { timer: null, requestId: 0, selected: null, results: [] },
};
 // keeps all stored/displayed text lowercase so the site stays visually consistent
function toLowerSafe(value) {
  return String(value || "").toLowerCase();
}
 function normalizeQueueItem(item) {
  if (!item) return item;
  const storedType = toLowerSafe(item.type);
  return {
    ...item,
    title: toLowerSafe(item.title),
    description: toLowerSafe(item.description),
    tags: toLowerSafe(item.tags),
    type: ["movie", "show", "game"].includes(storedType)
      ? storedType
      : "movie",
  };
}
 function getActorName() {
  const profileName = toLowerSafe(currentProfile && currentProfile.display_name).trim();
  if (profileName) return profileName;
  const emailName = currentUser && currentUser.email
    ? currentUser.email.split("@")[0]
    : "";
  return toLowerSafe(emailName).trim();
}
 function needsDisplayNameSetup() {
  return Boolean(currentUser) && !toLowerSafe(currentProfile?.display_name).trim();
}
 function getActorPrefix() {
  const actorName = getActorName();
  return actorName ? `${escapeHtml(actorName)} ` : "";
}
 function isItemAddedByCurrentUser(item) {
  if (!currentUser || !item) return false;
  if (item.added_by && item.added_by === currentUser.id) return true;
  const actorName = toLowerSafe(getActorName()).trim();
  const itemActorName = toLowerSafe(item.added_by_name).trim();
  return Boolean(actorName && itemActorName && actorName === itemActorName);
}
 function getQueueItemsForCurrentMode(items) {
  return personalQueueOnly ? items.filter(isItemAddedByCurrentUser) : items;
}
 function setPersonalQueueOnly(enabled) {
  if (enabled && !currentUser) {
    setAccountMessage("sign in to see your adds.");
    return;
  }
  personalQueueOnly = Boolean(enabled);
  moviePage = 1;
  gamePage = 1;
  setActivePage("queuePage");
  renderAccountPanel();
  render();
}
 function togglePersonalQueueOnly() {
  setPersonalQueueOnly(!personalQueueOnly);
}
 function getCurrentPreferences() {
  return {
    activePage: localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY) || "queuePage",
    activityLogCollapsed: localStorage.getItem("activityLogCollapsed") === "true",
    activityEntriesCollapsed: localStorage.getItem("activityEntriesCollapsed") !== "false",
  };
}
 function setAccountMessage(message) {
  const messageEl = document.getElementById("accountMessage");
  clearTimeout(accountMessageTimer);
  if (messageEl) messageEl.textContent = message || "";
  if (!message || String(message).trim().endsWith("...")) return;
  accountMessageTimer = setTimeout(() => {
    if (messageEl && messageEl.textContent === message) {
      messageEl.textContent = "";
    }
  }, 3500);
}
 function renderAccountPanel() {
  const accountForm = document.getElementById("accountForm");
  const profileForm = document.getElementById("profileForm");
  const signedInBox = document.getElementById("accountSignedIn");
  const displayName = document.getElementById("accountDisplayName");
  const accountAvatar = document.getElementById("accountAvatar");
  const removeImageButton = document.getElementById("removeProfileImageButton");
  const myAddsButton = document.getElementById("myAddsButton");
  const profileNameInput = document.getElementById("profileNameInput");
   const isSignedIn = Boolean(currentUser);
  const shouldPromptForName = needsDisplayNameSetup();
  if (accountForm) accountForm.classList.toggle("hidden", isSignedIn);
  if (signedInBox) signedInBox.classList.toggle("hidden", !isSignedIn);
  if (profileForm) profileForm.classList.toggle("hidden", !shouldPromptForName);
   if (!isSignedIn) return;
   const actorName = shouldPromptForName ? "set up your name" : getActorName() || "signed in";
  if (displayName) displayName.textContent = actorName;
  if (myAddsButton) {
    myAddsButton.textContent = personalQueueOnly ? "all queue" : "my adds";
    myAddsButton.classList.toggle("is-active", personalQueueOnly);
  }
  if (profileNameInput && shouldPromptForName) profileNameInput.value = "";
  if (accountAvatar) {
    const imageUrl = currentProfile?.preferences?.profileImage || "";
    accountAvatar.classList.toggle("has-profile-image", Boolean(imageUrl));
    accountAvatar.innerHTML = imageUrl
      ? `<img src="${escapeAttribute(imageUrl)}" alt="">`
      : escapeHtml(actorName.slice(0, 1) || "?");
  }
  if (removeImageButton) {
    removeImageButton.disabled = !currentProfile?.preferences?.profileImage;
  }
}
 async function saveProfilePreferences(partial = {}) {
  if (!currentUser) return;
   const preferences = {
    ...(currentProfile?.preferences || {}),
    ...getCurrentPreferences(),
    ...partial,
  };
   const profilePayload = {
    id: currentUser.id,
    display_name: toLowerSafe(currentProfile?.display_name).trim() || null,
    theme: localStorage.getItem(THEME_STORAGE_KEY) || "raichu",
    preferences,
  };
   const { data, error } = await supabaseClient
    .from("profiles")
    .upsert(profilePayload, { onConflict: "id" })
    .select()
    .single();
   if (error) {
    console.error("profile save error:", error);
    return;
  }
   currentProfile = data;
  renderAccountPanel();
}
 function queueProfilePreferenceSave(partial = {}) {
  if (!currentUser) return;
  clearTimeout(profileSaveTimer);
  profileSaveTimer = setTimeout(() => {
    saveProfilePreferences(partial);
  }, 350);
}
 async function loadCurrentProfile() {
  if (!currentUser) {
    currentProfile = null;
    personalQueueOnly = false;
    renderAccountPanel();
    render();
    return;
  }
   const { data: existingProfile, error: selectError } = await supabaseClient
    .from("profiles")
    .select("id, display_name, theme, preferences, created_at")
    .eq("id", currentUser.id)
    .maybeSingle();
   if (selectError) {
    console.error("profile load error:", selectError);
    currentProfile = {
      id: currentUser.id,
      display_name: null,
      theme: localStorage.getItem(THEME_STORAGE_KEY) || "raichu",
      preferences: getCurrentPreferences(),
    };
    setAccountMessage("signed in. profile setup still needs database columns.");
  } else {
    currentProfile = existingProfile || {
      id: currentUser.id,
      display_name: null,
      theme: localStorage.getItem(THEME_STORAGE_KEY) || "raichu",
      preferences: getCurrentPreferences(),
    };
    if (!existingProfile) {
      await saveProfilePreferences();
    }
    setAccountMessage("");
  }
   renderAccountPanel();
  applyProfilePreferences();
}
 function applyProfilePreferences() {
  if (!currentProfile) return;
   const profileTheme = currentProfile.theme === "bulbasaur" ? "bulbasaur" : "raichu";
  setTheme(profileTheme, { savePreference: false });
   const preferences = currentProfile.preferences || {};
  if (preferences.activePage) {
    setActivePage(preferences.activePage, { savePreference: false });
  }
  if (typeof preferences.activityLogCollapsed === "boolean") {
    setActivityLogCollapsed(preferences.activityLogCollapsed, { savePreference: false });
  }
  if (typeof preferences.activityEntriesCollapsed === "boolean") {
    setActivityEntriesCollapsed(preferences.activityEntriesCollapsed, { savePreference: false });
  }
}
 async function signInWithPassword() {
  const email = document.getElementById("accountEmailInput")?.value.trim();
  const password = document.getElementById("accountPasswordInput")?.value;
  if (!email || !password) {
    setAccountMessage("enter email and password.");
    return;
  }
   setAccountMessage("signing in...");
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    setAccountMessage(error.message || "couldn't sign in.");
    return;
  }
   currentUser = data.user;
  await loadCurrentProfile();
  setAccountMessage("signed in.");
}
 async function signUpWithPassword() {
  const email = document.getElementById("accountEmailInput")?.value.trim();
  const password = document.getElementById("accountPasswordInput")?.value;
  if (!email || !password) {
    setAccountMessage("enter email and password.");
    return;
  }
   setAccountMessage("creating account...");
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
  });
   if (error) {
    setAccountMessage(error.message || "couldn't create account.");
    return;
  }
   currentUser = data.session?.user || null;
  if (currentUser) {
    currentProfile = {
      id: currentUser.id,
      display_name: null,
      theme: localStorage.getItem(THEME_STORAGE_KEY) || "raichu",
      preferences: getCurrentPreferences(),
    };
    await saveProfilePreferences();
    setAccountMessage(data.session ? "account created. add your name." : "check your email to confirm.");
  } else {
    setAccountMessage("check your email to confirm.");
  }
  renderAccountPanel();
}
 function openSignOutConfirmModal() {
  if (!currentUser) return;
  const overlay = document.getElementById("signOutConfirmOverlay");
  if (!overlay) return;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("add-modal-open");
}
 function closeSignOutConfirmModal() {
  const overlay = document.getElementById("signOutConfirmOverlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("add-modal-open");
}
 async function signOutAccount() {
  closeSignOutConfirmModal();
  setAccountMessage("signing out...");
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    setAccountMessage(error.message || "couldn't sign out.");
    return;
  }
   currentUser = null;
  currentProfile = null;
  personalQueueOnly = false;
  toggleAvatarPopover(false);
  closeAccountSettingsModal();
  closeSignOutConfirmModal();
  renderAccountPanel();
  setAccountMessage("signed out.");
}
 async function saveDisplayName() {
  if (!currentUser) return;
  const displayName = toLowerSafe(document.getElementById("profileNameInput")?.value.trim());
  if (!displayName) {
    setAccountMessage("enter a display name.");
    return;
  }
   currentProfile = {
    ...(currentProfile || {}),
    id: currentUser.id,
    display_name: displayName,
  };
  await saveProfilePreferences();
  setAccountMessage("name saved.");
}
 function setAccountSettingsMessage(message) {
  const messageEl = document.getElementById("accountSettingsMessage");
  if (messageEl) messageEl.textContent = message || "";
}
 function openAccountSettingsModal() {
  if (!currentUser) return;
  const overlay = document.getElementById("accountSettingsOverlay");
  const nameInput = document.getElementById("accountSettingsNameInput");
  const themeInput = document.getElementById("accountSettingsThemeInput");
  const passwordInput = document.getElementById("accountSettingsPasswordInput");
  if (!overlay) return;
   if (nameInput) nameInput.value = toLowerSafe(currentProfile?.display_name || getActorName()).trim();
  if (themeInput) themeInput.value = document.body.classList.contains("bulbasaur-theme") ? "bulbasaur" : "raichu";
  if (passwordInput) passwordInput.value = "";
  customFilterMenus.find((menu) => menu.select === themeInput)?.refresh();
  setAccountSettingsMessage("");
   overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("add-modal-open");
  requestAnimationFrame(() => {
    if (nameInput) nameInput.focus();
  });
}
 function closeAccountSettingsModal() {
  const overlay = document.getElementById("accountSettingsOverlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("add-modal-open");
  setAccountSettingsMessage("");
}
 async function saveAccountSettings() {
  if (!currentUser) return;
  const nameInput = document.getElementById("accountSettingsNameInput");
  const themeInput = document.getElementById("accountSettingsThemeInput");
  const passwordInput = document.getElementById("accountSettingsPasswordInput");
  const displayName = toLowerSafe(nameInput?.value.trim());
  const theme = themeInput?.value === "bulbasaur" ? "bulbasaur" : "raichu";
  const newPassword = String(passwordInput?.value || "");
   if (!displayName) {
    setAccountSettingsMessage("enter a display name.");
    return;
  }
  if (newPassword && newPassword.length < 6) {
    setAccountSettingsMessage("password needs at least 6 characters.");
    return;
  }
   setAccountSettingsMessage("saving...");
  currentProfile = {
    ...(currentProfile || {}),
    id: currentUser.id,
    display_name: displayName,
    theme,
  };
  setTheme(theme, { savePreference: false });
  await saveProfilePreferences();
   if (newPassword) {
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) {
      setAccountSettingsMessage(error.message || "couldn't update password.");
      return;
    }
    if (passwordInput) passwordInput.value = "";
  }
   setAccountMessage("account updated.");
  closeAccountSettingsModal();
}
 function chooseProfileImage() {
  const input = document.getElementById("profileImageInput");
  if (input) input.click();
}
 function toggleAvatarPopover(forceOpen = null) {
  const popover = document.getElementById("avatarPopover");
  const urlInput = document.getElementById("profileImageUrlInput");
  if (!popover) return;
  const shouldOpen = forceOpen === null ? !popover.classList.contains("show") : forceOpen;
  popover.classList.toggle("show", shouldOpen);
  if (shouldOpen && urlInput) {
    urlInput.value = currentProfile?.preferences?.profileImage?.startsWith("data:")
      ? ""
      : currentProfile?.preferences?.profileImage || "";
    requestAnimationFrame(() => urlInput.focus());
  }
}
 async function saveProfileImage(file) {
  if (!currentUser || !file) return;
  if (!file.type.startsWith("image/")) {
    setAccountMessage("choose an image file.");
    return;
  }
   if (file.size > 900000) {
    setAccountMessage("choose a smaller picture.");
    return;
  }
   const reader = new FileReader();
  reader.onload = async () => {
    const imageUrl = String(reader.result || "");
    currentProfile = {
      ...(currentProfile || {}),
      id: currentUser.id,
      preferences: {
        ...(currentProfile?.preferences || {}),
        profileImage: imageUrl,
      },
    };
    await saveProfilePreferences({ profileImage: imageUrl });
    toggleAvatarPopover(false);
    setAccountMessage("picture saved.");
  };
  reader.onerror = () => setAccountMessage("couldn't read that picture.");
  reader.readAsDataURL(file);
}
 async function saveProfileImageUrl() {
  if (!currentUser) return;
  const input = document.getElementById("profileImageUrlInput");
  const imageUrl = String(input?.value || "").trim();
  if (!imageUrl) {
    setAccountMessage("paste an image link.");
    return;
  }
   currentProfile = {
    ...(currentProfile || {}),
    id: currentUser.id,
    preferences: {
      ...(currentProfile?.preferences || {}),
      profileImage: imageUrl,
    },
  };
  await saveProfilePreferences({ profileImage: imageUrl });
  toggleAvatarPopover(false);
  setAccountMessage("picture saved.");
}
 async function removeProfileImage() {
  if (!currentUser) return;
  currentProfile = {
    ...(currentProfile || {}),
    id: currentUser.id,
    preferences: {
      ...(currentProfile?.preferences || {}),
      profileImage: "",
    },
  };
  await saveProfilePreferences({ profileImage: "" });
  toggleAvatarPopover(false);
  setAccountMessage("picture removed.");
}
 async function initializeAuth() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.error("session load error:", error);
  }
   currentUser = data?.session?.user || null;
  await loadCurrentProfile();
   supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    await loadCurrentProfile();
  });
}
 function getNumberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
 function formatMinutes(totalMinutes) {
  const minutes = getNumberValue(totalMinutes);
  if (!minutes) return "";
  const roundedMinutes = Math.round(minutes);
  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;
  if (!hours) return `${remainingMinutes}m`;
  if (!remainingMinutes) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}
 function renderMediaMetadata(item) {
  if (!item || item.type === "game") return "";
   if (item.type === "show") {
    const seasonCount = getNumberValue(item.media_season_count);
    const episodeCount = getNumberValue(item.media_episode_count);
    const parts = [];
     if (seasonCount) parts.push(`${seasonCount} season${seasonCount === 1 ? "" : "s"}`);
    if (episodeCount) parts.push(`${episodeCount} episode${episodeCount === 1 ? "" : "s"}`);
     return parts.length ? `<span class="media-meta">${escapeHtml(parts.join(" • "))}</span>` : "";
  }
   const runtime = formatMinutes(item.media_runtime_minutes);
  if (!runtime && item.media_lookup_id) {
    return `<span class="media-meta">runtime tbd</span>`;
  }
  return runtime ? `<span class="media-meta">${escapeHtml(runtime)}</span>` : "";
}
 function renderRatingMetadata(item) {
  const rating = getNumberValue(item && item.rating);
  if (!rating) return "";
  const normalizedRating = Math.max(1, Math.min(5, Math.round(rating)));
  return `<span class="rating-meta" aria-label="rated ${normalizedRating} out of 5">${renderRoundedStars(normalizedRating)}</span>`;
}
 function renderRoundedStars(rating) {
  const normalizedRating = Math.max(0, Math.min(5, Math.round(getNumberValue(rating) || 0)));
  return `<span class="rating-stars" aria-hidden="true">${Array.from({ length: 5 }, (_, index) => {
    return renderRoundedStar(index < normalizedRating);
  }).join("")}</span>`;
}
 function renderRoundedStar(isFilled) {
  return `<svg viewBox="0 0 24 24" class="${isFilled ? "filled-star" : "empty-star"}" focusable="false"><path d="M12 3.1l2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 16.62l-5.3 2.79 1.01-5.9-4.29-4.18 5.93-.86L12 3.1z" fill="currentColor" fill-opacity="${isFilled ? "1" : "0"}" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
 function renderPriorityStar(isActive) {
  return `<span class="priority-star" aria-hidden="true">${renderRoundedStar(isActive)}</span>`;
}
 function renderFinishedRatingBadge(item) {
  const rating = getNumberValue(item && item.rating);
  if (!rating) {
    return `<span class="finished-rating-badge unrated" aria-label="not rated">${renderRoundedStars(0)}</span>`;
  }
  const normalizedRating = Math.max(1, Math.min(5, Math.round(rating)));
  return `<span class="finished-rating-badge" aria-label="rated ${normalizedRating} out of 5">${renderRoundedStars(normalizedRating)}</span>`;
}
 function getMediaLookupUrl(path, params = {}) {
  const url = new URL(`${MEDIA_LOOKUP_BASE_URL}${path}`);
  url.searchParams.set("api_key", MEDIA_LOOKUP_API_KEY);
  url.searchParams.set("language", "en-US");
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}
 function cleanLookupTitle(value) {
  return String(value || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
 function getLookupScore(result, title, type) {
  const resultTitle = cleanLookupTitle(
    type === "show" ? result.name || result.original_name : result.title || result.original_title,
  ).toLowerCase();
  const targetTitle = cleanLookupTitle(title).toLowerCase();
  if (!resultTitle || !targetTitle) return 999;
  if (resultTitle === targetTitle) return 0;
  if (resultTitle.includes(targetTitle) || targetTitle.includes(resultTitle)) return 1;
  return getTitleDistance(resultTitle, targetTitle);
}
 function pickBestLookupMatch(results, title, type) {
  const matches = (results || [])
    .filter((result) => result && !result.adult)
    .map((result) => ({ result, score: getLookupScore(result, title, type) }))
    .sort((a, b) => a.score - b.score || (b.result.popularity || 0) - (a.result.popularity || 0));
   const bestMatch = matches[0];
  if (!bestMatch) return null;
   const allowedDistance = Math.max(2, Math.floor(cleanLookupTitle(title).length * 0.22));
  return bestMatch.score <= allowedDistance ? bestMatch.result : null;
}
 function getLookupResultTitle(result, type) {
  return type === "show"
    ? result.name || result.original_name || ""
    : result.title || result.original_title || "";
}
 function getLookupResultYear(result, type) {
  const date = type === "show" ? result.first_air_date : result.release_date;
  return String(date || "").slice(0, 4);
}
 function getMediaSuggestionLabel(result, type) {
  const year = getLookupResultYear(result, type);
  return [getLookupResultTitle(result, type), year, type].filter(Boolean).join(" • ");
}
 async function searchMediaSuggestions(title, type) {
  if (!MEDIA_LOOKUP_API_KEY || !["movie", "show"].includes(type)) return [];
   try {
    const lookupType = type === "show" ? "tv" : "movie";
    const response = await fetch(
      getMediaLookupUrl(`/search/${lookupType}`, {
        query: cleanLookupTitle(title),
        include_adult: "false",
      }),
    );
    if (!response.ok) return [];
     const data = await response.json();
    return (data.results || [])
      .filter((result) => result && !result.adult)
      .map((result) => ({ result, score: getLookupScore(result, title, type) }))
      .sort((a, b) => a.score - b.score || (b.result.popularity || 0) - (a.result.popularity || 0))
      .slice(0, 5)
      .map(({ result }) => result);
  } catch (error) {
    console.error("media suggestion lookup failed:", error);
    return [];
  }
}
 async function fetchMediaMetadataById(mediaId, type) {
  if (!MEDIA_LOOKUP_API_KEY || !mediaId || !["movie", "show"].includes(type)) return null;
   try {
    const lookupType = type === "show" ? "tv" : "movie";
    const detailResponse = await fetch(getMediaLookupUrl(`/${lookupType}/${mediaId}`));
    if (!detailResponse.ok) return null;
    const details = await detailResponse.json();
     if (type === "show") {
      return {
        media_lookup_id: String(details.id || mediaId),
        media_lookup_type: "show",
        media_runtime_minutes: null,
        media_season_count: getNumberValue(details.number_of_seasons),
        media_episode_count: getNumberValue(details.number_of_episodes),
      };
    }
     return {
      media_lookup_id: String(details.id || mediaId),
      media_lookup_type: "movie",
      media_runtime_minutes: getNumberValue(details.runtime),
      media_season_count: null,
      media_episode_count: null,
    };
  } catch (error) {
    console.error("media detail lookup failed:", error);
    return null;
  }
}
 function getSelectedMediaSuggestion(mode, title, type) {
  const selected = mediaSuggestionState[mode]?.selected;
  if (!selected) return null;
  const sameType = selected.type === type;
  const sameTitle = cleanLookupTitle(selected.inputTitle) === cleanLookupTitle(title);
  return sameType && sameTitle ? selected : null;
}
 async function fetchMediaMetadata(title, type) {
  if (!MEDIA_LOOKUP_API_KEY || !["movie", "show"].includes(type)) return null;
   try {
    const lookupType = type === "show" ? "tv" : "movie";
    const searchResponse = await fetch(
      getMediaLookupUrl(`/search/${lookupType}`, {
        query: cleanLookupTitle(title),
        include_adult: "false",
      }),
    );
    if (!searchResponse.ok) return null;
     const searchData = await searchResponse.json();
    const match = pickBestLookupMatch(searchData.results, title, type);
    if (!match || !match.id) return null;
    return fetchMediaMetadataById(match.id, type);
  } catch (error) {
    console.error("media lookup failed:", error);
    return null;
  }
}
 async function getMediaMetadataForSave(mode, title, type) {
  const selected = getSelectedMediaSuggestion(mode, title, type);
  if (selected) {
    return fetchMediaMetadataById(selected.id, type);
  }
  return fetchMediaMetadata(title, type);
}
 function hasMediaMetadata(item) {
  return Boolean(
    getNumberValue(item.media_runtime_minutes) ||
      getNumberValue(item.media_season_count) ||
      getNumberValue(item.media_episode_count),
  );
}
 function isMissingMediaColumnError(error) {
  const message = String(error && error.message ? error.message : "").toLowerCase();
  return message.includes("media_") && message.includes("column");
}
 async function insertQueueItemWithOptionalMetadata(payload) {
  const { error } = await supabaseClient.from("queue_items").insert([payload]);
  if (!error) return { error };
  if (!isMissingMediaColumnError(error) && !isMissingActorColumnError(error)) return { error };
   if (isMissingMediaColumnError(error)) mediaMetadataColumnsAvailable = false;
  const fallbackPayload = { ...payload };
  if (isMissingMediaColumnError(error)) {
    delete fallbackPayload.media_lookup_id;
    delete fallbackPayload.media_lookup_type;
    delete fallbackPayload.media_runtime_minutes;
    delete fallbackPayload.media_season_count;
    delete fallbackPayload.media_episode_count;
  }
  if (isMissingActorColumnError(error)) {
    delete fallbackPayload.added_by;
    delete fallbackPayload.added_by_name;
  }
   return supabaseClient.from("queue_items").insert([fallbackPayload]);
}
 async function updateQueueItemWithOptionalMetadata(itemId, payload) {
  if (!mediaMetadataColumnsAvailable) {
    const {
      media_lookup_id,
      media_lookup_type,
      media_runtime_minutes,
      media_season_count,
      media_episode_count,
      ...fallbackPayload
    } = payload;
    return supabaseClient.from("queue_items").update(fallbackPayload).eq("id", itemId);
  }
   const { error } = await supabaseClient.from("queue_items").update(payload).eq("id", itemId);
  if (!error) return { error };
  if (!isMissingMediaColumnError(error) && !isMissingActorColumnError(error)) return { error };
   if (isMissingMediaColumnError(error)) mediaMetadataColumnsAvailable = false;
  const fallbackPayload = { ...payload };
  if (isMissingMediaColumnError(error)) {
    delete fallbackPayload.media_lookup_id;
    delete fallbackPayload.media_lookup_type;
    delete fallbackPayload.media_runtime_minutes;
    delete fallbackPayload.media_season_count;
    delete fallbackPayload.media_episode_count;
  }
  if (isMissingActorColumnError(error)) {
    delete fallbackPayload.added_by;
    delete fallbackPayload.added_by_name;
  }
   return supabaseClient.from("queue_items").update(fallbackPayload).eq("id", itemId);
}
 function isMissingActorColumnError(error) {
  const message = String(error && error.message ? error.message : "").toLowerCase();
  return (
    message.includes("actor_") ||
    message.includes("added_by") ||
    (message.includes("column") && message.includes("schema cache"))
  );
}
 async function insertActivityLogWithOptionalActor(payload) {
  const { error } = await supabaseClient.from("activity_log").insert([payload]);
  if (!error || !isMissingActorColumnError(error)) return { error };
   const { actor_id, actor_name, ...fallbackPayload } = payload;
  return supabaseClient.from("activity_log").insert([fallbackPayload]);
}
 async function backfillMissingMediaMetadata(items) {
  if (
    !MEDIA_LOOKUP_API_KEY ||
    !mediaMetadataColumnsAvailable ||
    mediaMetadataBackfillRunning
  ) {
    return;
  }
   const missingItems = (items || [])
    .filter((item) => ["movie", "show"].includes(item.type))
    .filter((item) => !hasMediaMetadata(item))
    .filter((item) => !pendingMetadataBackfills.has(item.id))
    .slice(0, 6);
   if (!missingItems.length) return;
   mediaMetadataBackfillRunning = true;
  let shouldReload = false;
   try {
    for (const item of missingItems) {
      pendingMetadataBackfills.add(item.id);
      const metadata = await fetchMediaMetadata(item.title, item.type);
      if (metadata && mediaMetadataColumnsAvailable) {
        const { error } = await updateQueueItemWithOptionalMetadata(item.id, metadata);
        if (error) console.error("metadata save error:", error);
        if (!error) shouldReload = true;
      }
    }
  } finally {
    mediaMetadataBackfillRunning = false;
  }
   clearTimeout(mediaMetadataReloadTimer);
  mediaMetadataReloadTimer = setTimeout(() => {
    loadItems();
  }, shouldReload ? 500 : 900);
}
 function normalizeLogEntry(entry) {
  if (!entry) return entry;
  const actorName = toLowerSafe(entry.actor_name).trim();
  const message = toLowerSafe(entry.message);
  const messageWithActor =
    actorName && message && !message.startsWith(`${actorName} `)
      ? `${actorName} ${message}`
      : message;
  return {
    ...entry,
    title: toLowerSafe(entry.title),
    actor_name: actorName,
    message: messageWithActor,
  };
}
 function updateStats() {
  const activeMovies = getQueueItemsForCurrentMode(movies);
  const activeGames = getQueueItemsForCurrentMode(games);
  const movieItems = activeMovies.filter((item) => item.type === "movie");
  const showItems = activeMovies.filter((item) => item.type === "show");
  const totalMovies = movieItems.length;
  const totalShows = showItems.length;
  const totalGames = activeGames.length;
  const finishedMovies = movieItems.filter(
    (item) => item.status === "finished",
  ).length;
  const finishedShows = showItems.filter(
    (item) => item.status === "finished",
  ).length;
  const finishedGames = activeGames.filter(
    (item) => item.status === "finished",
  ).length;
   const statsHtml = `
    <div class="stat-item">
      <span class="stat-label">movies</span>
      <span class="stat-value">${finishedMovies} / ${totalMovies}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">shows</span>
      <span class="stat-value">${finishedShows} / ${totalShows}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">games</span>
      <span class="stat-value">${finishedGames} / ${totalGames}</span>
    </div>
  `;
   const statsBar = document.getElementById("statsBar");
  const sidebarStatsBar = document.getElementById("sidebarStatsBar");
  if (statsBar) statsBar.innerHTML = statsHtml;
  if (sidebarStatsBar) sidebarStatsBar.innerHTML = statsHtml;
}
 function getActorNameFromLogMessage(message) {
  const text = toLowerSafe(message).trim();
  const addedIndex = text.indexOf(' added "');
  return addedIndex > 0 ? text.slice(0, addedIndex).trim() : "";
}
 function getActivityTypeKey(itemType) {
  const normalizedType = toLowerSafe(itemType);
  if (normalizedType === "movie" || normalizedType === "movies") return "movie";
  if (normalizedType === "show" || normalizedType === "shows") return "show";
  if (normalizedType === "game" || normalizedType === "games") return "game";
  return normalizedType;
}
 async function applyActivityOwnershipFallback(items) {
  const itemsNeedingOwner = (items || []).filter((item) => !item.added_by && !item.added_by_name);
  if (!itemsNeedingOwner.length) return items || [];
   let { data, error } = await supabaseClient
    .from("activity_log")
    .select("title, item_type, event_type, actor_id, actor_name, message, created_at")
    .eq("event_type", "added")
    .order("created_at", { ascending: false })
    .limit(200);
   if (error && isMissingActorColumnError(error)) {
    const fallback = await supabaseClient
      .from("activity_log")
      .select("title, item_type, event_type, message, created_at")
      .eq("event_type", "added")
      .order("created_at", { ascending: false })
      .limit(200);
    data = fallback.data;
    error = fallback.error;
  }
   if (error) {
    console.error("activity ownership fallback error:", error);
    return items || [];
  }
   const ownerByItem = new Map();
  (data || []).forEach((entry) => {
    const title = toLowerSafe(entry.title).trim();
    const typeKey = getActivityTypeKey(entry.item_type);
    if (!title || !typeKey) return;
    const key = `${typeKey}::${title}`;
    if (ownerByItem.has(key)) return;
    const actorName = toLowerSafe(entry.actor_name || getActorNameFromLogMessage(entry.message)).trim();
    ownerByItem.set(key, {
      added_by: entry.actor_id || null,
      added_by_name: actorName || null,
    });
  });
   return (items || []).map((item) => {
    if (item.added_by || item.added_by_name) return item;
    const key = `${getActivityTypeKey(item.type)}::${toLowerSafe(item.title).trim()}`;
    const owner = ownerByItem.get(key);
    return owner ? { ...item, ...owner } : item;
  });
}
 function dedupeActivityEntries(entries) {
  const seen = new Set();
  return (entries || []).filter((entry) => {
    const message = toLowerSafe(entry && entry.message ? entry.message : entry).trim();
    if (!message || seen.has(message)) return false;
    seen.add(message);
    return true;
  });
}
 // renders the activity log sidebar using the most recent saved log entries
function renderLog() {
  const logBox = document.getElementById("logBox");
  if (!logBox) return;
   activityLog = dedupeActivityEntries(activityLog).slice(0, 5);
   if (activityLog.length === 0) {
    logBox.innerHTML =
      '<div class="log-entry" style="opacity:0.6;">nothing new added yet :(</div>';
    return;
  }
   logBox.innerHTML = activityLog
    .map(
      (entry) => `<div class="log-entry">${entry.message || entry}</div>`,
    )
    .join("");
}
 function getQueueItemTypeLabel(item) {
  if (item.type === "game") return "game";
  if (item.type === "show") return "show";
  return "movie";
}
 function renderOngoing() {
  const ongoingBox = document.getElementById("ongoingBox");
  if (!ongoingBox) return;
   const ongoingItems = [...getQueueItemsForCurrentMode(movies), ...getQueueItemsForCurrentMode(games)]
    .filter(isOngoingItem)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
   if (ongoingItems.length === 0) {
    ongoingBox.innerHTML =
      `<div class="ongoing-entry" style="opacity:0.6;">${personalQueueOnly ? "there is nothing from you in rotation right now!" : "nothing in rotation right now"}</div>`;
    return;
  }
   ongoingBox.innerHTML = ongoingItems
    .map(
      (item) => `
        <div class="ongoing-entry">
          <div class="ongoing-entry-title">
            <button type="button" class="ongoing-title-button" onclick="openEditModalById(${item.id})" aria-label="edit ${escapeAttribute(item.title)}">
              ${escapeHtml(item.title)}
            </button>
            <span class="ongoing-entry-type">${getQueueItemTypeLabel(item)}</span>
          </div>
        </div>
      `,
    )
    .join("");
}
 function isOngoingItem(item) {
  const status = String(item && item.status ? item.status : "").toLowerCase();
  return status === "in progress" || status === "currently playing";
}
  
function getTitleDistance(a, b) {
  const left = toLowerSafe(a).trim();
  const right = toLowerSafe(b).trim();
  if (left === right) return 0;
  if (!left || !right) return Math.max(left.length, right.length);
   const distances = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let previous = distances[0];
    distances[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const saved = distances[j];
      distances[j] =
        left[i - 1] === right[j - 1]
          ? previous
          : Math.min(previous + 1, distances[j] + 1, distances[j - 1] + 1);
      previous = saved;
    }
  }
   return distances[right.length];
}
 function isCloseActivityTitle(entryTitle, targetTitle) {
  const normalizedEntryTitle = toLowerSafe(entryTitle).trim();
  const normalizedTargetTitle = toLowerSafe(targetTitle).trim();
  if (!normalizedEntryTitle || !normalizedTargetTitle) return false;
   const distance = getTitleDistance(normalizedEntryTitle, normalizedTargetTitle);
  const allowedDistance = Math.max(1, Math.floor(normalizedTargetTitle.length * 0.15));
  return distance <= allowedDistance;
}
 function replaceActivityTitleInMessage(message, oldTitle, newTitle, fallbackTitle = "") {
  const normalizedNewTitle = toLowerSafe(newTitle).trim();
  let updatedMessage = String(message || "");
  [oldTitle, fallbackTitle]
    .map((title) => toLowerSafe(title).trim())
    .filter(Boolean)
    .forEach((title) => {
      updatedMessage = updatedMessage.replace(
        new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
        normalizedNewTitle,
      );
    });
  return updatedMessage;
}
 async function updateActivityLogsForTitle(oldTitle, newTitle, itemType = "") {
  const normalizedOldTitle = toLowerSafe(oldTitle).trim();
  const normalizedNewTitle = toLowerSafe(newTitle).trim();
  const normalizedItemType = toLowerSafe(itemType).trim();
   if (!normalizedOldTitle || !normalizedNewTitle) {
    return;
  }
   if (normalizedOldTitle === normalizedNewTitle && !normalizedItemType) {
    return;
  }
   activityLog = activityLog.map((entry) => {
    const entryTitle = toLowerSafe(entry.title || "");
    const entryMessage = String(entry.message || entry || "");
    const matchesTitle =
      entryTitle === normalizedOldTitle ||
      isCloseActivityTitle(entryTitle, normalizedNewTitle);
     if (matchesTitle || entryMessage.toLowerCase().includes(normalizedOldTitle)) {
      return {
        ...entry,
        title: normalizedNewTitle,
        message: replaceActivityTitleInMessage(
          entryMessage,
          normalizedOldTitle,
          normalizedNewTitle,
          matchesTitle ? entryTitle : "",
        ),
      };
    }
     return entry;
  });
   renderLog();
   const [titleMatchResult, messageMatchResult] = await Promise.all([
    supabaseClient
      .from("activity_log")
      .select("id, title, message, item_type, event_type, rating, created_at")
      .eq("title", normalizedOldTitle),
    supabaseClient
      .from("activity_log")
      .select("id, title, message, item_type, event_type, rating, created_at")
      .ilike("message", `%${normalizedOldTitle}%`),
  ]);
   if (titleMatchResult.error || messageMatchResult.error) {
    console.error(
      "error finding activity logs to update:",
      titleMatchResult.error || messageMatchResult.error,
    );
    return;
  }
   const rowsById = new Map();
  [...(titleMatchResult.data || []), ...(messageMatchResult.data || [])].forEach((row) => {
    rowsById.set(row.id, row);
  });
   if (normalizedItemType) {
    const { data: typeRows, error: typeRowsError } = await supabaseClient
      .from("activity_log")
      .select("id, title, message, item_type, event_type, rating, created_at")
      .eq("item_type", normalizedItemType)
      .limit(200);
     if (typeRowsError) {
      console.error("error finding same-type activity logs to update:", typeRowsError);
    } else {
      (typeRows || [])
        .filter((row) => isCloseActivityTitle(row.title, normalizedNewTitle))
        .forEach((row) => rowsById.set(row.id, row));
    }
  }
   const matchingRows = [...rowsById.values()];
   await Promise.all(
    matchingRows.map(async (row) => {
      const oldMessage = String(row.message || "");
      const rowTitle = toLowerSafe(row.title || "").trim();
      const updatedMessage = replaceActivityTitleInMessage(
        oldMessage,
        normalizedOldTitle,
        normalizedNewTitle,
        rowTitle !== normalizedNewTitle ? rowTitle : "",
      );
       const { data: updatedRows, error: updateError } = await supabaseClient
        .from("activity_log")
        .update({
          title: normalizedNewTitle,
          message: updatedMessage,
        })
        .eq("id", row.id)
        .select("id");
       if (updateError) {
        console.error("error updating activity log row:", updateError);
        return;
      }
       if (updatedRows && updatedRows.length) return;
       const { error: deleteError } = await supabaseClient
        .from("activity_log")
        .delete()
        .eq("id", row.id);
       if (deleteError) {
        console.error("error replacing old activity log row:", deleteError);
        return;
      }
       const replacementRow = {
        title: normalizedNewTitle,
        item_type: row.item_type,
        event_type: row.event_type,
        rating: row.rating,
        message: updatedMessage,
      };
       if (row.created_at) replacementRow.created_at = row.created_at;
       const { error: insertError } = await supabaseClient
        .from("activity_log")
        .insert([replacementRow]);
       if (insertError) {
        console.error("error inserting corrected activity log row:", insertError);
      }
    }),
  );
   await loadActivityLog();
}
 async function deleteActivityLogsForTitle(title) {
  const normalizedTitle = toLowerSafe(title).trim();
  if (!normalizedTitle) return;
   // update the visible sidebar immediately
  activityLog = activityLog.filter((entry) => {
    const message = String(entry.message || entry || "").toLowerCase();
    const entryTitle = String(entry.title || "").toLowerCase();
    return entryTitle !== normalizedTitle && !message.includes(normalizedTitle);
  });
  renderLog();
   // delete matching rows from Supabase activity_log
  const { error: titleDeleteError } = await supabaseClient
    .from("activity_log")
    .delete()
    .eq("title", normalizedTitle);
   if (titleDeleteError) {
    console.error("error deleting activity log by title:", titleDeleteError);
  }
   // fallback for older log rows where the title column may not match perfectly
  const { error: messageDeleteError } = await supabaseClient
    .from("activity_log")
    .delete()
    .ilike("message", `%${normalizedTitle}%`);
   if (messageDeleteError) {
    console.error("error deleting activity log by message:", messageDeleteError);
  }
   await loadActivityLog();
}
 // pulls recent activity log entries from supabase when the page loads or refreshes
async function loadActivityLog() {
  let { data, error } = await supabaseClient
    .from("activity_log")
    .select("id, title, item_type, event_type, actor_id, actor_name, message, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
   if (error && isMissingActorColumnError(error)) {
    const fallback = await supabaseClient
      .from("activity_log")
      .select("id, title, item_type, event_type, message, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    data = fallback.data;
    error = fallback.error;
  }
   if (error) {
    console.error("Error loading activity log:", error);
    renderLog();
    return;
  }
   activityLog = dedupeActivityEntries((data || []).map(normalizeLogEntry)).slice(0, 5);
  renderLog();
}
 function queueActivityLogRefresh(delay = 150) {
  clearTimeout(activityLogRefreshTimer);
  activityLogRefreshTimer = setTimeout(() => {
    loadActivityLog();
  }, delay);
}
 
function addLocalActivityMessage(message) {
  const entry = normalizeLogEntry({ message });
  const normalizedMessage = toLowerSafe(entry.message).trim();
  activityLog = [
    entry,
    ...activityLog.filter((existing) => {
      const existingMessage = toLowerSafe(existing && existing.message ? existing.message : existing).trim();
      return existingMessage !== normalizedMessage;
    }),
  ].slice(0, 5);
  renderLog();
}
 async function logPlanAdded(title, category) {
  const normalizedTitle = toLowerSafe(title.trim());
  const selectedCategory =
    category ||
    document.getElementById("planCategoryInput")?.value ||
    "things";
  const normalizedCategory = toLowerSafe(selectedCategory);
  const dateOnly = new Date().toLocaleDateString();
  const message = `${getActorPrefix()}added "${escapeHtml(normalizedTitle)}" to ${normalizedCategory} • ${dateOnly}`;
   if (window.lastPlanLogMessage === message) return;
  window.lastPlanLogMessage = message;
  setTimeout(() => {
    if (window.lastPlanLogMessage === message) window.lastPlanLogMessage = "";
  }, 2500);
   addLocalActivityMessage(message);
   try {
    await saveActivityLog({
      title: normalizedTitle,
      itemType: "plan",
      eventType: "added",
      category: normalizedCategory,
    });
  } catch (error) {
    console.error("error logging plan:", error);
  }
}
 // saves a human-readable activity message whenever users add, edit, rate, or remove items
async function saveActivityLog({
  title,
  itemType,
  eventType,
  rating = null,
  category = null,
}) {
  if (!title) return false;
   const normalizedTitle = toLowerSafe(title.trim());
  const dateOnly = new Date().toLocaleDateString();
  let message = "";
   if (eventType === "added" && itemType === "plan") {
    const planCategory =
      category ||
      document.getElementById("planCategoryInput")?.value ||
      "things";
    message = `${getActorPrefix()}added "${escapeHtml(normalizedTitle)}" to ${toLowerSafe(planCategory)} • ${dateOnly}`;
  } else if (eventType === "added") {
    message = `${getActorPrefix()}added "${escapeHtml(normalizedTitle)}" to ${getQueueTypeLabel(itemType)} • ${dateOnly}`;
  } else if (eventType === "rated") {
    message = `${getActorPrefix()}rated "${escapeHtml(normalizedTitle)}" ${rating} star${rating === 1 ? "" : "s"} • ${dateOnly}`;
  } else if (eventType === "finished") {
    message = `${getActorPrefix()}marked "${escapeHtml(normalizedTitle)}" as finished • ${dateOnly}`;
  } else if (eventType === "deleted") {
    const deletedFrom = itemType === "plan" && category
      ? toLowerSafe(category)
      : getQueueTypeLabel(itemType);
    message = `${getActorPrefix()}deleted "${escapeHtml(normalizedTitle)}" from ${deletedFrom} • ${dateOnly}`;
  }
   message = toLowerSafe(message);
   const logPayload = {
    title: normalizedTitle,
    item_type: itemType,
    event_type: eventType,
    rating,
    message,
    actor_id: currentUser?.id || null,
    actor_name: getActorName() || null,
  };
   const { error } = await insertActivityLogWithOptionalActor(logPayload);
   if (error) {
    console.error("Error saving activity log:", error);
    return false;
  }
   return true;
}
 function getQueueTypeLabel(type) {
  if (type === "game") return "games";
  if (type === "show") return "shows";
  if (type === "plan") return "plans";
  return "movies";
}
 function getStatusLabel(status) {
  return status === "hiatus" ? "out of rotation" : status;
}
 function getQueueTags(tags) {
  return getPlanTags(tags);
}
 function serializeQueueTags(tags) {
  return serializePlanTags(tags);
}
 const QUEUE_GENRE_TAG_OPTIONS = [
  "horror",
  "comedy",
  "romance",
  "drama",
  "action",
  "sci-fi",
  "fantasy",
  "thriller",
  "animation",
  "adventure",
  "mystery",
  "crime",
  "documentary",
  "musical",
  "slice of life",
  "supernatural",
  "anime",
];
 const QUEUE_MOOD_TAG_OPTIONS = ["gay", "sad", "happy"];
 const QUEUE_PLATFORM_TAG_OPTIONS = [
  "steam/pc",
  "xbox",
  "playstation",
  "mobile",
  "browser",
  "switch",
  "nintendo ds/3ds",
  "wii/wii u",
];
 const QUEUE_GAME_TAG_OPTIONS = [
  "cozy",
  "co-op",
  "multiplayer",
  "rpg",
  "puzzle",
  "strategy",
  "platformer",
  "open world",
  "story",
  "online",
  "short",
  "long",
  "replay",
  "casual",
  "competitive",
  "sandbox",
  "farming sim",
  "life sim",
  "visual novel",
];
 const QUEUE_TAG_OPTIONS = [
  ...QUEUE_GENRE_TAG_OPTIONS,
  ...QUEUE_MOOD_TAG_OPTIONS,
  ...QUEUE_PLATFORM_TAG_OPTIONS,
  ...QUEUE_GAME_TAG_OPTIONS,
];
 function getQueueTagOptionsForType(type) {
  return type === "game"
    ? QUEUE_TAG_OPTIONS
    : [...QUEUE_GENRE_TAG_OPTIONS, ...QUEUE_MOOD_TAG_OPTIONS];
}
 function getQueueTagTypeForMode(mode) {
  if (mode === "edit") {
    return editItemContext && editItemContext.listType === "game"
      ? "game"
      : "movie";
  }
   const typeInput = document.getElementById("typeInput");
  return typeInput && typeInput.value === "game" ? "game" : "movie";
}
 function getAllowedQueueTagsForType(tags, type) {
  const tagOptions = getQueueTagOptionsForType(type);
  return getQueueTags(serializeQueueTags(tags)).filter((tag) =>
    tagOptions.includes(tag),
  );
}
 function renderQueueTagChips(containerId, selectedTags, type = "movie") {
  const container = document.getElementById(containerId);
  if (!container) return;
   const normalizedSelected = getQueueTags(serializeQueueTags(selectedTags));
  const tagOptions = getQueueTagOptionsForType(type);
  const allTags = [
    ...tagOptions,
    ...normalizedSelected.filter(
      (tag) => type === "game" && !QUEUE_TAG_OPTIONS.includes(tag),
    ),
  ];
   container.innerHTML = allTags
    .map((tag) => {
      const isActive = normalizedSelected.includes(tag);
      return `
        <button
          type="button"
          class="tag-chip ${isActive ? "active" : ""}"
          data-tag="${escapeAttribute(tag)}"
          aria-pressed="${isActive}"
        >#${escapeHtml(tag.replace(/\s+/g, "-"))}</button>
      `;
    })
    .join("");
}
 function toggleQueueTag(mode, tag) {
  const tagList = mode === "edit" ? editQueueTags : draftQueueTags;
  const normalizedTag = toLowerSafe(tag).trim();
  if (!normalizedTag) return;
   const existingIndex = tagList.indexOf(normalizedTag);
  if (existingIndex >= 0) {
    tagList.splice(existingIndex, 1);
  } else {
    tagList.push(normalizedTag);
  }
   if (mode === "edit") {
    renderQueueTagChips("editTagChips", editQueueTags, getQueueTagTypeForMode("edit"));
  } else {
    renderQueueTagChips("addTagChips", draftQueueTags, getQueueTagTypeForMode("add"));
  }
}
 function refreshQueueTagChipsForMode(mode) {
  if (mode === "edit") {
    const type = getQueueTagTypeForMode("edit");
    renderQueueTagChips("editTagChips", editQueueTags, type);
    return;
  }
   const type = getQueueTagTypeForMode("add");
  renderQueueTagChips("addTagChips", draftQueueTags, type);
}
 function setupQueueTagChipControls() {
  [
    { id: "addTagChips", mode: "add" },
    { id: "editTagChips", mode: "edit" },
  ].forEach(({ id, mode }) => {
    const container = document.getElementById(id);
    if (!container || container.dataset.ready === "true") return;
     container.dataset.ready = "true";
    container.addEventListener("click", (event) => {
      const chip =
        event.target instanceof Element
          ? event.target.closest(".tag-chip")
          : null;
      if (!chip) return;
      toggleQueueTag(mode, chip.dataset.tag || "");
    });
  });
   refreshQueueTagChipsForMode("add");
  refreshQueueTagChipsForMode("edit");
}
 function renderQueueTags(tags) {
  const queueTags = getQueueTags(tags);
  if (!queueTags.length) return "";
   return `
    <div class="queue-tag-list">
      ${queueTags
        .map(
          (tag) =>
            `<span class="queue-tag">#${escapeHtml(tag.replace(/\s+/g, "-"))}</span>`,
        )
        .join("")}
    </div>
  `;
}
 function getStatusClass(status) {
  if (status === "want to watch" || status === "want to play")
    return "status-want";
  if (status === "in progress" || status === "currently playing")
    return "status-progress";
  if (status === "hiatus") return "status-hiatus";
  return "status-finished";
}
 function isFinishedStatus(status) {
  return status === "finished";
}
 function sortQueue(items) {
  return [...items].sort((a, b) => {
    const aPriority = a.priority ? 1 : 0;
    const bPriority = b.priority ? 1 : 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    const aFinished = isFinishedStatus(a.status) ? 1 : 0;
    const bFinished = isFinishedStatus(b.status) ? 1 : 0;
     if (aFinished !== bFinished) {
      return aFinished - bFinished;
    }
     return new Date(b.created_at) - new Date(a.created_at);
  });
}
 function getBorderClass(status) {
  if (status === "finished") return "status-finished-border";
  if (status === "in progress" || status === "currently playing")
    return "status-progress-border";
  if (status === "hiatus") return "status-hiatus-border";
  return "status-want-border";
}
 // builds the html for one queue card, including status, rating, and priority controls
function createItemHTML(item, index, type) {
  const itemType = ["movie", "show", "game"].includes(item.type)
    ? item.type
    : type;
  const finishedClass = item.status === "finished" ? "finished-item" : "";
  const typeBadge =
    itemType === "game"
      ? ""
      : `<span class="type-badge type-${itemType}">${itemType}</span>`;
  const hasSummary = item.description && item.description.trim();
  const mediaMetadata = renderMediaMetadata(item);
  const showFinishedRatingControl = item.status === "finished";
  const isFinishedGame = showFinishedRatingControl && itemType === "game";
  const ratingMetadata = showFinishedRatingControl ? "" : renderRatingMetadata(item);
  const cardMetadata = [mediaMetadata, ratingMetadata].filter(Boolean).join("");
  const cardMetaClass = cardMetadata
    ? `has-media-meta ${mediaMetadata && ratingMetadata ? "has-stacked-meta" : ""}`
    : "";
  const topRightControl = showFinishedRatingControl
    ? renderFinishedRatingBadge(item)
    : `<button class="priority-toggle ${item.priority ? "active" : ""}" onclick="togglePriority(\'${type}\', ${index}, ${item.priority ? "false" : "true"})" aria-label="${item.priority ? "remove important" : "mark important"}">${renderPriorityStar(item.priority)}</button>`;
   return `
  <div class="item item-type-${itemType} ${isFinishedGame ? "finished-game-card" : ""} ${finishedClass} ${hasSummary ? "has-summary" : ""} ${cardMetaClass} ${getBorderClass(item.status)}">
    <div class="item-top">
      <div class="title">
        <div class="title-stack">
          <div class="title-line">
            ${typeBadge}
            <span class="title-body ${isFinishedGame ? "finished-game-title" : ""}">
              <button type="button" class="title-button" onclick="openEditModal('${type}', ${index})" aria-label="edit ${escapeHtml(item.title)}">
                <span class="title-text">${escapeHtml(item.title)}</span>
              </button>
            </span>
          </div>
        </div>
      </div>
      <div class="controls">
        ${topRightControl}
      </div>
    </div>
     <div class="summary-row">
      ${
        hasSummary
          ? `
        <div class="summary-text" id="${type}-summary-${index}">${escapeHtml(item.description)}</div>
      `
          : `
        <div class="summary-bottom"></div>
      `
      }
    </div>
    ${renderQueueTags(item.tags)}
    ${cardMetadata ? `<div class="item-meta-row">${cardMetadata}</div>` : ""}
  </div>
`;
}
 function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
 function escapeAttribute(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
 // applies the live search box and status dropdown to whichever list is being displayed
function filterItems(items) {
  return items.filter((item) => {
    const title = String(item.title || "").toLowerCase();
    const description = String(item.description || "").toLowerCase();
    const status = String(item.status || "").toLowerCase();
    const tags = getQueueTags(item.tags);
     const matchesSearch =
      !searchTerm ||
      title.includes(searchTerm) ||
      description.includes(searchTerm);
     const matchesMediaType =
      mediaTypeFilter === "all" ||
      String(item.type || "").toLowerCase() === mediaTypeFilter;
     let matchesStatus = true;
    if (statusFilter === "finished") {
      matchesStatus = status === "finished";
    } else if (statusFilter === "in progress") {
      matchesStatus =
        status === "in progress" || status === "currently playing";
    } else if (statusFilter === "hiatus") {
      matchesStatus = status === "hiatus";
    } else if (statusFilter === "want") {
      matchesStatus =
        status === "want to watch" || status === "want to play";
    }
     const matchesGenre =
      genreFilter === "all" ||
      tags.includes(genreFilter) ||
      description.includes(genreFilter);
     const matchesPlatform =
      platformFilter === "all" ||
      tags.includes(platformFilter) ||
      description.includes(platformFilter);
     const matchesMood =
      moodFilter === "all" ||
      tags.includes(moodFilter) ||
      description.includes(moodFilter);
     const matchesTag =
      tagFilter === "all" ||
      tags.includes(tagFilter) ||
      description.includes(tagFilter);
     return (
      matchesSearch &&
      matchesMediaType &&
      matchesStatus &&
      matchesGenre &&
      matchesPlatform &&
      matchesMood &&
      matchesTag
    );
  });
}
 // splits long lists into pages so the ui stays compact and easier to scan
function paginateItems(items, page, itemsPerPage = QUEUE_ITEMS_PER_PAGE) {
  const totalPages = Math.max(
    1,
    Math.ceil(items.length / itemsPerPage),
  );
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * itemsPerPage;
  return {
    pageItems: items.slice(start, start + itemsPerPage),
    totalPages,
    currentPage: safePage,
  };
}
 // draws the prev/next controls for each list
function renderPagination(type, currentPage, totalPages) {
  const paginationEl = document.getElementById(
    type === "movie" ? "moviePagination" : "gamePagination",
  );
  if (!paginationEl) return;
   if (totalPages <= 1) {
    paginationEl.innerHTML = "";
    return;
  }
   const prevButton =
    currentPage > 1
      ? `<button type="button" class="page-btn secondary-btn" aria-label="previous page" onclick="changePage('${type}', -1)">‹</button>`
      : "";
   paginationEl.innerHTML = `
  ${prevButton}
  <span class="page-info">page ${currentPage} of ${totalPages}</span>
  <button type="button" class="page-btn secondary-btn" aria-label="next page" ${currentPage === totalPages ? "disabled" : ""} onclick="changePage('${type}', 1)">›</button>
`;
}
 // main render pipeline: sorts, filters, paginates, and redraws both lists + stats
function render() {
  const movieList = document.getElementById("movieList");
  const gameList = document.getElementById("gameList");
  const gameSection = gameList ? gameList.closest(".section") : null;
  const listContainer = movieList ? movieList.closest(".lists") : null;
  const shouldShowFinished =
    Boolean(searchTerm) || statusFilter === "finished";
   const activeMovies = getQueueItemsForCurrentMode(movies);
  const activeGames = getQueueItemsForCurrentMode(games);
  const hasNoPersonalWatchlist = personalQueueOnly && activeMovies.length === 0;
  const hasNoPersonalGames = personalQueueOnly && activeGames.length === 0;
  const filteredMovies = filterItems(sortQueue(activeMovies)).filter(
    (item) =>
      !isOngoingItem(item) &&
      (shouldShowFinished || item.status !== "finished"),
  );
  const filteredGames = filterItems(sortQueue(activeGames)).filter(
    (item) =>
      !isOngoingItem(item) &&
      (shouldShowFinished || item.status !== "finished"),
  );
   const movieItemsPerPage =
    mediaTypeFilter === "all"
      ? QUEUE_ITEMS_PER_PAGE
      : FILTERED_WATCHLIST_ITEMS_PER_PAGE;
  const movieData = paginateItems(filteredMovies, moviePage, movieItemsPerPage);
  const gameData = paginateItems(filteredGames, gamePage);
   moviePage = movieData.currentPage;
  gamePage = gameData.currentPage;
  const watchlistEmptyLabel = `${personalQueueOnly ? "your " : ""}${
    mediaTypeFilter === "movie"
      ? "movies"
      : mediaTypeFilter === "show"
        ? "shows"
        : "watchlist items"
  }`;
   movieList.innerHTML = movieData.pageItems.length
    ? movieData.pageItems
        .map((item) =>
          createItemHTML(
            item,
            movies.findIndex((m) => m.id === item.id),
            "movie",
          ),
        )
        .join("")
    : `<div class="empty">${hasNoPersonalWatchlist ? "you haven't added anything yet!" : `no matching ${watchlistEmptyLabel} found ✨`}</div>`;
   gameList.innerHTML = gameData.pageItems.length
    ? gameData.pageItems
        .map((item) =>
          createItemHTML(
            item,
            games.findIndex((g) => g.id === item.id),
            "game",
          ),
        )
        .join("")
    : `<div class="empty">${hasNoPersonalGames ? "you haven't added anything yet!" : `no matching ${personalQueueOnly ? "your " : ""}games found 🎮`}</div>`;
   if (gameSection) {
    gameSection.style.display = mediaTypeFilter === "all" ? "" : "none";
  }
  if (listContainer) {
    listContainer.classList.toggle("watchlist-only", mediaTypeFilter !== "all");
  }
   renderPagination("movie", movieData.currentPage, movieData.totalPages);
  renderPagination(
    "game",
    gameData.currentPage,
    mediaTypeFilter === "all" ? gameData.totalPages : 1,
  );
  updateStats();
  renderOngoing();
}
 function changePage(type, direction) {
  if (type === "movie") {
    moviePage += direction;
  } else {
    gamePage += direction;
  }
  render();
  updateStats();
}
 // loads queue items from supabase, normalizes them, and refreshes the whole interface
async function loadItems() {
  const { data, error } = await supabaseClient
    .from("queue_items")
    .select("*");
   if (error) {
    console.error("Load error:", error);
    return;
  }
   const normalizedData = await applyActivityOwnershipFallback((data || []).map(normalizeQueueItem));
  movies = normalizedData.filter((item) => item.type === "movie" || item.type === "show");
  games = normalizedData.filter((item) => item.type === "game");
  render();
  updateStats();
  backfillMissingMediaMetadata(movies);
}
 function queueHasDuplicateTitleForType(title, type, excludeId = null) {
  const normalizedTitle = String(title || "").toLowerCase();
  const normalizedType = String(type || "").toLowerCase();
   return [...movies, ...games].some(
    (queueItem) =>
      queueItem.id !== excludeId &&
      String(queueItem.type || "").toLowerCase() === normalizedType &&
      String(queueItem.title || "").toLowerCase() === normalizedTitle,
  );
}
 // adds a new movie/show or game to the database, then refreshes the ui and activity log
async function addItem() {
  const titleInput = document.getElementById("titleInput");
  const typeInput = document.getElementById("typeInput");
  const descriptionInput = document.getElementById("descriptionInput");
  const title = toLowerSafe(titleInput.value.trim());
  const type = typeInput.value;
  const description = toLowerSafe(descriptionInput.value.trim());
  draftQueueTags = getAllowedQueueTagsForType(draftQueueTags, type);
  const tags = serializeQueueTags(draftQueueTags);
   if (!title) return;
   const alreadyExists = queueHasDuplicateTitleForType(title, type);
   if (alreadyExists) {
    alert("⚠️ that's already in your queue!");
    return;
  }
   const defaultStatus =
    type === "game" ? "want to play" : "want to watch";
  const metadata = await getMediaMetadataForSave("add", title, type);
  const insertPayload = {
    title,
    type,
    status: defaultStatus,
    description,
    tags,
    added_by: currentUser?.id || null,
    added_by_name: getActorName() || null,
    ...(metadata || {}),
  };
   const { error } = await insertQueueItemWithOptionalMetadata(insertPayload);
   if (error) {
    console.error("Insert error:", error);
    return;
  }
   titleInput.value = "";
  descriptionInput.value = "";
  draftQueueTags = [];
  clearMediaSuggestions("add");
  refreshQueueTagChipsForMode("add");
  document.getElementById("descriptionBox").classList.remove("show");
  document.getElementById("toggleDescriptionBtn").textContent =
    "add summary";
  closeAddModal();
  await loadItems();
  await saveActivityLog({ title, itemType: type, eventType: "added" });
  await loadActivityLog();
  showRaichuMessage(`good choice! ${document.body.classList.contains("bulbasaur-theme") ? "\u{1F33F}" : "\u26A1"}`);
}
 // upthings an item status (want, in progress, finished) and re-renders the card state
async function updateStatus(type, index, selectElement) {
  const status = selectElement.value;
  const item = type === "movie" ? movies[index] : games[index];
   const { error } = await supabaseClient
    .from("queue_items")
    .update({ status })
    .eq("id", item.id);
   if (error) {
    console.error("Update error:", error);
    return;
  }
   selectElement.className = getStatusClass(status);
  await loadItems();
   if (status === "finished" && item.status !== "finished") {
    await saveActivityLog({
      title: item.title,
      itemType: item.type || type,
      eventType: "finished",
    });
    await loadActivityLog();
    showRaichuMessage("was it any good?");
  }
}
 async function updateItemType(index, selectElement) {
  const newType = selectElement.value;
  const item = movies[index];
   if (!item || !["movie", "show"].includes(newType)) return;
   const { error } = await supabaseClient
    .from("queue_items")
    .update({ type: newType })
    .eq("id", item.id);
   if (error) {
    console.error("Type update error:", error);
    selectElement.value = item.type || "movie";
    return;
  }
   await loadItems();
  showRaichuMessage(`marked as ${newType}`);
}
 async function saveEditItem() {
  const item = getItemByContext(editItemContext);
  const itemId = editItemContext && editItemContext.id;
  if (!item || !itemId) {
    alert("couldn't find that item to save.");
    return;
  }
   const oldTitle = item.title;
  const title = toLowerSafe(document.getElementById("editTitleInput").value.trim());
  if (!title) {
    alert("please enter a title.");
    return;
  }
   const pendingType =
    editItemContext.listType === "game"
      ? "game"
      : document.getElementById("editTypeInput").value;
   const duplicateExists = queueHasDuplicateTitleForType(
    title,
    pendingType,
    item.id,
  );
   if (duplicateExists) {
    alert("⚠️ that's already in your queue!");
    return;
  }
   const type =
    editItemContext.listType === "game"
      ? "game"
      : pendingType;
  if (!["movie", "show", "game"].includes(type)) {
    alert("please choose a valid type.");
    return;
  }
  const status = document.getElementById("editStatusInput").value;
  const description = toLowerSafe(
    document.getElementById("editDescriptionInput").value.trim(),
  );
  editQueueTags = getAllowedQueueTagsForType(editQueueTags, type);
  const tags = serializeQueueTags(editQueueTags);
  const rawRating = document.getElementById("editRatingInput").value;
  const rating = rawRating ? Number(rawRating) : null;
  const selectedEditMedia = getSelectedMediaSuggestion("edit", title, type);
  const shouldRefreshMetadata =
    Boolean(selectedEditMedia) ||
    type !== item.type ||
    cleanLookupTitle(title) !== cleanLookupTitle(oldTitle) ||
    !hasMediaMetadata(item);
  const metadata = shouldRefreshMetadata
    ? await getMediaMetadataForSave("edit", title, type)
    : null;
  const updatePayload = { title, type, status, description, tags, ...(metadata || {}) };
   if (rawRating || item.rating !== null) {
    updatePayload.rating = rating;
  }
   const { error } = await updateQueueItemWithOptionalMetadata(itemId, updatePayload);
   if (error) {
    console.error("Edit update error:", error);
    alert(`couldn't save those changes right now. supabase says: ${error.message || "unknown error"}`);
    return;
  }
   await updateActivityLogsForTitle(oldTitle, title, item.type || type);
  if (status === "finished" && item.status !== "finished") {
    await saveActivityLog({
      title,
      itemType: type,
      eventType: "finished",
    });
    await loadActivityLog();
  }
  if (rating && rating !== item.rating && status === "finished") {
    await saveActivityLog({
      title,
      itemType: type,
      eventType: "rated",
      rating,
    });
    await loadActivityLog();
  }
  closeEditModal();
  await loadItems();
  showMascotActionMessage("save");
}
 async function deleteEditItem() {
  const item = getItemByContext(editItemContext);
  if (!item) return;
   await removeItem(editItemContext.listType, editItemContext.index);
  closeEditModal();
}
 // deletes an item from the queue and records that action in the activity log
async function removeItem(type, index) {
  const item = type === "movie" ? movies[index] : games[index];
   const confirmed = window.confirm(
    `are you sure you want to delete "${item.title}"?`,
  );
  if (!confirmed) return;
   const { error } = await supabaseClient
    .from("queue_items")
    .delete()
    .eq("id", item.id);
   if (error) {
    console.error("Delete error:", error);
    return;
  }
   await loadItems();
  await saveActivityLog({
    title: item.title,
    itemType: item.type || type,
    eventType: "deleted",
  });
  await loadActivityLog();
  showMascotActionMessage("delete");
}
 // shows or hides the inline summary editor for a single card
function toggleSummaryEditor(type, index) {
  const el = document.getElementById(`${type}-editor-${index}`);
  if (!el) return;
  el.classList.toggle("show");
}
 // opens or closes the inline title editor when a user clicks an item name
function toggleTitleEditor(type, index) {
  const el = document.getElementById(`${type}-title-editor-${index}`);
  const input = document.getElementById(`${type}-title-input-${index}`);
  const item = type === "movie" ? movies[index] : games[index];
  if (!el || !input || !item) return;
   const willShow = !el.classList.contains("show");
  el.classList.toggle("show");
   if (willShow) {
    input.value = item.title || "";
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }
}
 function handleTitleEditKey(event, type, index) {
  if (event.key === "Enter") {
    event.preventDefault();
    saveTitle(type, index);
  } else if (event.key === "Escape") {
    event.preventDefault();
    toggleTitleEditor(type, index);
  }
}
 // saves a renamed title back to supabase and upthings the activity log
async function saveTitle(type, index) {
  const item = type === "movie" ? movies[index] : games[index];
  const input = document.getElementById(`${type}-title-input-${index}`);
  if (!item || !input) return;
   const oldTitle = item.title;
  const title = toLowerSafe(input.value.trim());
  if (!title) {
    alert("please enter a title.");
    return;
  }
   const duplicateExists = queueHasDuplicateTitleForType(
    title,
    item.type,
    item.id,
  );
   if (duplicateExists) {
    alert("⚠️ that's already in your queue!");
    return;
  }
   const { error } = await supabaseClient
    .from("queue_items")
    .update({ title })
    .eq("id", item.id);
   if (error) {
    console.error("Title update error:", error);
    return;
  }
   await updateActivityLogsForTitle(oldTitle, title, item.type || type);
  await loadItems();
  showMascotActionMessage("save");
}
 // saves the edited summary/notes text for a queue item
async function saveSummary(type, index) {
  const item = type === "movie" ? movies[index] : games[index];
  const input = document.getElementById(`${type}-editor-input-${index}`);
  const description = toLowerSafe(input.value.trim());
   const { error } = await supabaseClient
    .from("queue_items")
    .update({ description })
    .eq("id", item.id);
   if (error) {
    console.error("Summary update error:", error);
    return;
  }
   await loadItems();
  showMascotActionMessage("save");
}
const MASCOT_HOVER_MESSAGES = [
  "hi gf",
  "i love you",
  "you're the best",
  "hi baby",
  "mwah",
  "ur so gay",
];
 function getRandomMascotMessage() {
  const currentText = document.querySelector(".raichu-bubble")?.textContent?.trim();
  const availableMessages = MASCOT_HOVER_MESSAGES.filter((message) => message !== currentText);
  const messages = availableMessages.length ? availableMessages : MASCOT_HOVER_MESSAGES;
  return messages[Math.floor(Math.random() * messages.length)];
}
 function showRandomMascotHoverMessage() {
  const message = getRandomMascotMessage();
  document.querySelectorAll(".raichu-bubble").forEach((bubble) => {
    bubble.dataset.default = message;
    bubble.textContent = message;
  });
}
 // handles raichu speech bubble popups for friendly feedback after user actions
function showRaichuMessage(text) {
  const bubbles = document.querySelectorAll(".raichu-bubble");
  if (!bubbles.length) return;
   clearTimeout(window.raichuTimeout);
  bubbles.forEach((bubble) => {
    bubble.dataset.restoreText = bubble.dataset.default || "hi gf";
    bubble.textContent = text;
    bubble.style.opacity = "1";
    bubble.style.transform = "translateY(0)";
  });
  window.raichuTimeout = setTimeout(() => {
    bubbles.forEach((bubble) => {
      bubble.style.opacity = "";
      bubble.style.transform = "";
    });
    setTimeout(() => {
      bubbles.forEach((bubble) => {
        bubble.textContent = bubble.dataset.restoreText || bubble.dataset.default || "hi gf";
        delete bubble.dataset.restoreText;
      });
    }, 350);
  }, 2200);
}
 function showMascotActionMessage(action) {
  const isBulbasaur = document.body.classList.contains("bulbasaur-theme");
  if (action === "save") {
    showRaichuMessage("saved!");
  } else if (action === "delete") {
    showRaichuMessage("bye bye!");
  }
}
 function getMascotShell() {
  return document.querySelector(".footer-mascot");
}
 function moveMascotToModal(modal) {
  const mascot = getMascotShell();
  if (!mascot || !modal || mascot.parentElement === modal) return;
  modal.insertBefore(mascot, modal.firstElementChild);
}
 function restoreMascotToFooter() {
  const mascot = getMascotShell();
  const footer = document.querySelector(".footer");
  if (!mascot || !footer || mascot.parentElement === footer) return;
  footer.insertBefore(mascot, footer.firstElementChild);
}
 function openAddModal() {
  const overlay = document.getElementById("addOverlay");
  const modal = overlay?.querySelector(".add-modal");
  const titleInput = document.getElementById("titleInput");
  if (!overlay) return;
   refreshQueueTagChipsForMode("add");
  moveMascotToModal(modal);
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("add-modal-open");
   requestAnimationFrame(() => {
    if (titleInput) titleInput.focus();
  });
}
 function closeAddModal() {
  const overlay = document.getElementById("addOverlay");
  if (!overlay) return;
   clearMediaSuggestions("add");
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("add-modal-open");
  restoreMascotToFooter();
}
 function getItemByContext(context) {
  if (!context) return null;
  const allItems = [...movies, ...games];
  return (
    allItems.find((item) => item.id === context.id) ||
    (context.listType === "game"
      ? games[context.index]
      : movies[context.index])
  );
}
 function getStatusOptionsForType(type, selectedStatus) {
  const options =
    type === "game"
      ? ["want to play", "currently playing", "hiatus", "finished"]
      : ["want to watch", "in progress", "hiatus", "finished"];
   return options
    .map(
      (status) =>
        `<option value="${status}" ${selectedStatus === status ? "selected" : ""}>${getStatusLabel(status)}</option>`,
    )
    .join("");
}
 function openEditModal(listType, index) {
  const item = listType === "game" ? games[index] : movies[index];
  const overlay = document.getElementById("editOverlay");
  const modal = overlay?.querySelector(".edit-modal");
  if (!item || !overlay) return;
   editItemContext = { listType, index, id: item.id };
   const itemType = item.type || listType;
  document.getElementById("editModalTitle").textContent = `edit ${item.title}`;
  document.getElementById("editTitleInput").value = item.title || "";
  document.getElementById("editDescriptionInput").value = item.description || "";
  editQueueTags = getQueueTags(item.tags);
  document.getElementById("editRatingInput").value = item.rating || "";
   const typeField = document.getElementById("editTypeField");
  const typeInput = document.getElementById("editTypeInput");
  if (listType === "game") {
    typeField.style.display = "none";
    typeInput.value = "movie";
  } else {
    typeField.style.display = "";
    typeInput.value = itemType === "show" ? "show" : "movie";
  }
   const statusInput = document.getElementById("editStatusInput");
  statusInput.innerHTML = getStatusOptionsForType(itemType, item.status);
  refreshQueueTagChipsForMode("edit");
   moveMascotToModal(modal);
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("add-modal-open");
  requestAnimationFrame(() => document.getElementById("editTitleInput").focus());
}
 function openEditModalById(itemId) {
  const movieIndex = movies.findIndex((item) => item.id === itemId);
  if (movieIndex >= 0) {
    openEditModal("movie", movieIndex);
    return;
  }
   const gameIndex = games.findIndex((item) => item.id === itemId);
  if (gameIndex >= 0) openEditModal("game", gameIndex);
}
 function closeEditModal() {
  const overlay = document.getElementById("editOverlay");
  if (!overlay) return;
   overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("add-modal-open");
  clearMediaSuggestions("edit");
  editItemContext = null;
  editQueueTags = [];
  refreshQueueTagChipsForMode("edit");
  restoreMascotToFooter();
}
 function getMediaSuggestionElements(mode) {
  return {
    input: document.getElementById(mode === "edit" ? "editTitleInput" : "titleInput"),
    typeInput: document.getElementById(mode === "edit" ? "editTypeInput" : "typeInput"),
    box: document.getElementById(mode === "edit" ? "editMediaSuggestions" : "addMediaSuggestions"),
  };
}
 function clearMediaSuggestions(mode) {
  const state = mediaSuggestionState[mode];
  const { box } = getMediaSuggestionElements(mode);
  if (state) {
    clearTimeout(state.timer);
    state.selected = null;
    state.results = [];
  }
  if (box) {
    box.classList.remove("show");
    box.innerHTML = "";
  }
}
 function renderMediaSuggestions(mode, results, type, title) {
  const { box, input } = getMediaSuggestionElements(mode);
  if (!box || !input || !results.length) {
    clearMediaSuggestions(mode);
    return;
  }
   mediaSuggestionState[mode].results = results;
  box.innerHTML = results
    .map((result, index) => {
      const resultTitle = getLookupResultTitle(result, type);
      const meta = [getLookupResultYear(result, type), type].filter(Boolean).join(" • ");
      return `
        <button type="button" class="media-suggestion" data-index="${index}">
          <span class="media-suggestion-title">${escapeHtml(resultTitle)}</span>
          <span class="media-suggestion-meta">${escapeHtml(meta)}</span>
        </button>
      `;
    })
    .join("");
  box.classList.add("show");
   box.querySelectorAll(".media-suggestion").forEach((button) => {
    button.addEventListener("click", () => {
      const result = results[Number(button.dataset.index)];
      if (!result) return;
      const selectedTitle = toLowerSafe(getLookupResultTitle(result, type));
      input.value = selectedTitle;
      mediaSuggestionState[mode].selected = {
        id: result.id,
        type,
        inputTitle: selectedTitle,
        label: getMediaSuggestionLabel(result, type),
      };
      box.classList.remove("show");
      box.innerHTML = "";
    });
  });
}
 function queueMediaSuggestionSearch(mode) {
  const state = mediaSuggestionState[mode];
  const { input, typeInput } = getMediaSuggestionElements(mode);
  if (!state || !input || !typeInput) return;
   clearTimeout(state.timer);
  state.selected = null;
   const title = input.value.trim();
  const type =
    mode === "edit" && editItemContext?.listType === "game"
      ? "game"
      : typeInput.value;
   if (!MEDIA_LOOKUP_API_KEY || !["movie", "show"].includes(type) || cleanLookupTitle(title).length < 2) {
    clearMediaSuggestions(mode);
    return;
  }
   const requestId = state.requestId + 1;
  state.requestId = requestId;
  state.timer = setTimeout(async () => {
    const results = await searchMediaSuggestions(title, type);
    if (state.requestId !== requestId) return;
    renderMediaSuggestions(mode, results, type, title);
  }, 260);
}
 function setupMediaSuggestionControls() {
  [
    { mode: "add", inputId: "titleInput", typeId: "typeInput" },
    { mode: "edit", inputId: "editTitleInput", typeId: "editTypeInput" },
  ].forEach(({ mode, inputId, typeId }) => {
    const input = document.getElementById(inputId);
    const typeInput = document.getElementById(typeId);
    if (!input || input.dataset.mediaSuggestReady === "true") return;
     input.dataset.mediaSuggestReady = "true";
    input.addEventListener("input", () => queueMediaSuggestionSearch(mode));
    input.addEventListener("focus", () => queueMediaSuggestionSearch(mode));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") clearMediaSuggestions(mode);
    });
     if (typeInput && typeInput.dataset.mediaSuggestReady !== "true") {
      typeInput.dataset.mediaSuggestReady = "true";
      typeInput.addEventListener("change", () => queueMediaSuggestionSearch(mode));
    }
  });
   document.addEventListener("click", (event) => {
    ["add", "edit"].forEach((mode) => {
      const { box, input } = getMediaSuggestionElements(mode);
      if (!box || !input) return;
      if (!box.contains(event.target) && event.target !== input) {
        box.classList.remove("show");
      }
    });
  });
}
 // upthings the saved star rating for an item and refreshes the list
async function updateRating(type, index, value) {
  const item = type === "movie" ? movies[index] : games[index];
  const rating = Number(value);
   if (!item) return;
   const { error } = await supabaseClient
    .from("queue_items")
    .update({ rating })
    .eq("id", item.id);
   if (error) {
    console.error("Rating update error:", error);
    return;
  }
   await loadItems();
   if (item.status === "finished") {
    await saveActivityLog({
      title: item.title,
      itemType: item.type || type,
      eventType: "rated",
      rating,
    });
    await loadActivityLog();
  }
}
 // toggles the priority star so users can mark favorites or higher-priority items
async function togglePriority(type, index, value) {
  const item = type === "movie" ? movies[index] : games[index];
  const priority = value === true || value === "true";
   const { error } = await supabaseClient
    .from("queue_items")
    .update({ priority })
    .eq("id", item.id);
   if (error) {
    console.error("Priority update error:", error);
    return;
  }
   await loadItems();
}
 // listens for realtime supabase upthings so the page stays in sync after changes
function subscribeToChanges() {
  supabaseClient
    .channel("site-live-upthings")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "queue_items" },
      () => {
        loadItems();
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "activity_log" },
      () => {
        queueActivityLogRefresh();
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "plans" },
      () => {
        loadPlans();
      },
    )
    .subscribe((_status) => {
      queueActivityLogRefresh(500);
    });
   if (!activityLogPollTimer) {
    activityLogPollTimer = setInterval(() => {
      if (document.visibilityState !== "hidden") {
        queueActivityLogRefresh(0);
      }
    }, 5000);
  }
}
 // collapses or expands the activity log and remembers the choice with localStorage
function positionSidebarToggle(collapsed) {
  const toggleBtn = document.getElementById("sidebarFloatingToggle");
  if (!toggleBtn) return;
   if (!collapsed) {
    toggleBtn.style.left = "";
    toggleBtn.style.right = "";
    toggleBtn.style.top = "";
    return;
  }
   const buttonWidth = toggleBtn.offsetWidth || 36;
  const edgeInset = window.innerWidth <= 700 ? 10 : 24;
  const topOffset = window.innerWidth <= 700 ? 58 : 90;
  const leftOffset = Math.max(12, window.innerWidth - buttonWidth - edgeInset);
   toggleBtn.style.left = `${leftOffset}px`;
  toggleBtn.style.right = "auto";
  toggleBtn.style.top = `${topOffset}px`;
}
function getHeaderDrawerTop() {
  const header = document.querySelector(".site-sticky-header");
  if (!header) return window.innerWidth <= 700 ? 54 : 70;
  const headerBottom = header.getBoundingClientRect().bottom;
  return Math.max(0, Math.round(headerBottom));
}
function updateSidebarDrawerTop() {
  const drawerTop = getHeaderDrawerTop();
  document.documentElement.style.setProperty("--sidebar-drawer-top", `${drawerTop}px`);
}
 function updateSidebarPageScroll() {
  updateSidebarDrawerTop();
  const sidebar = document.getElementById("logSidebar");
  const shouldMeasure =
    sidebar &&
    window.innerWidth > 700 &&
    !sidebar.classList.contains("collapsed");
   if (!shouldMeasure) {
    document.body.classList.remove("sidebar-page-scroll");
    document.body.style.removeProperty("--sidebar-page-height");
    return;
  }
   const sidebarTop = getHeaderDrawerTop();
  const footer = document.querySelector(".footer");
  const footerHeight = footer ? footer.offsetHeight : 0;
  const bottomBreathingRoom = footerHeight + 56;
  const availableHeight = window.innerHeight - sidebarTop - bottomBreathingRoom;
  const sidebarHeight = sidebar.scrollHeight;
  const needsPageScroll = sidebarHeight > availableHeight;
   document.body.classList.toggle("sidebar-page-scroll", needsPageScroll);
  if (needsPageScroll) {
    document.body.style.setProperty(
      "--sidebar-page-height",
      `${sidebarTop + sidebarHeight + bottomBreathingRoom}px`,
    );
  } else {
    document.body.style.removeProperty("--sidebar-page-height");
  }
}
function scheduleSidebarPageScrollUpdate() {
  requestAnimationFrame(updateSidebarPageScroll);
}
 function setActivityLogCollapsed(collapsed, options = {}) {
  const sidebar = document.getElementById("logSidebar");
  const toggleBtn = document.getElementById("sidebarFloatingToggle");
  if (!sidebar || !toggleBtn) return;
   sidebar.classList.toggle("collapsed", collapsed);
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  toggleBtn.setAttribute("aria-expanded", String(!collapsed));
  toggleBtn.setAttribute(
    "aria-label",
    collapsed ? "show activity log" : "collapse activity log",
  );
  const toggleIcon = toggleBtn.querySelector(".sidebar-toggle-icon");
  if (toggleIcon) toggleIcon.textContent = "";
  toggleBtn.classList.toggle("is-collapsed", collapsed);
  positionSidebarToggle(collapsed);
  localStorage.setItem(
    "activityLogCollapsed",
    collapsed ? "true" : "false",
  );
  if (options.savePreference !== false) {
    queueProfilePreferenceSave({ activityLogCollapsed: collapsed });
  }
  scheduleSidebarPageScrollUpdate();
}
 function setActivityEntriesCollapsed(collapsed, options = {}) {
  const activityCard = document.querySelector(".activity-card");
  const toggleBtn = document.getElementById("activityLogToggle");
  if (!activityCard || !toggleBtn) return;
   activityCard.classList.toggle("is-log-collapsed", collapsed);
  toggleBtn.textContent = collapsed ? "+" : "−";
  toggleBtn.setAttribute("aria-expanded", String(!collapsed));
  toggleBtn.setAttribute(
    "aria-label",
    collapsed ? "expand activity log" : "collapse activity log",
  );
  localStorage.setItem(
    "activityEntriesCollapsed",
    collapsed ? "true" : "false",
  );
  if (options.savePreference !== false) {
    queueProfilePreferenceSave({ activityEntriesCollapsed: collapsed });
  }
  scheduleSidebarPageScrollUpdate();
}
 const activityLogToggle = document.getElementById("activityLogToggle");
if (activityLogToggle) {
  const savedEntriesCollapsed = localStorage.getItem(
    "activityEntriesCollapsed",
  );
  setActivityEntriesCollapsed(savedEntriesCollapsed !== "false");
  activityLogToggle.addEventListener("click", () => {
    const activityCard = document.querySelector(".activity-card");
    setActivityEntriesCollapsed(
      !activityCard.classList.contains("is-log-collapsed"),
    );
  });
}
 const logToggleBtn = document.getElementById("sidebarFloatingToggle");
if (logToggleBtn) {
  const savedCollapsed =
    localStorage.getItem("activityLogCollapsed") === "true";
  setActivityLogCollapsed(savedCollapsed);
  logToggleBtn.addEventListener("click", () => {
    const sidebar = document.getElementById("logSidebar");
    setActivityLogCollapsed(!sidebar.classList.contains("collapsed"));
  });
  window.addEventListener("resize", () => {
    const sidebar = document.getElementById("logSidebar");
    positionSidebarToggle(Boolean(sidebar && sidebar.classList.contains("collapsed")));
    setTheme(localStorage.getItem(THEME_STORAGE_KEY) || "raichu", { savePreference: false });
    scheduleSidebarPageScrollUpdate();
  });
  const sidebarPanel = document.getElementById("logSidebar");
  if (sidebarPanel) {
    if ("ResizeObserver" in window) {
      window.sidebarResizeObserver = new ResizeObserver(scheduleSidebarPageScrollUpdate);
      window.sidebarResizeObserver.observe(sidebarPanel);
    }
    window.sidebarMutationObserver = new MutationObserver(scheduleSidebarPageScrollUpdate);
    window.sidebarMutationObserver.observe(sidebarPanel, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    scheduleSidebarPageScrollUpdate();
  }
  document.addEventListener("click", (event) => {
    const sidebar = document.getElementById("logSidebar");
    const target = event.target;
    if (
      window.innerWidth > 700 ||
      !sidebar ||
      sidebar.classList.contains("collapsed") ||
      !(target instanceof Element) ||
      sidebar.contains(target) ||
      logToggleBtn.contains(target)
    ) {
      return;
    }
     setActivityLogCollapsed(true);
  });
}
  // ===== static page tabs + shared Supabase plans page =====
// required Supabase table:
// public.plans
// columns:
// id bigint generated always as identity primary key
// title text not null
// category text not null
// completed boolean not null default false
// tags text null
// created_at timestamptz not null default now()
  const THEME_STORAGE_KEY = "raichuQueueTheme";
 function setTheme(theme, options = {}) {
  const isBulbasaur = theme === "bulbasaur";
  const themeIcon = isBulbasaur ? "\u{1F33F}" : "\u26A1";
  const heartIcon = isBulbasaur ? "\u{1F49A}" : "\u{1F49B}";
  const titleText = isBulbasaur
    ? `${themeIcon} bulba queue ${themeIcon}`
    : `${themeIcon} raichu queue ${themeIcon}`;
  const appTitle = document.getElementById("appTitle");
  const activityTitle = document.querySelector(".activity-card .sidebar-header h3");
  const ongoingTitle = document.querySelector(".ongoing-box .sidebar-header h3");
  const statsBar = document.getElementById("statsBar");
  const sidebarStatsBar = document.getElementById("sidebarStatsBar");
  const addButton = document.getElementById("addButton");
  const searchInput = document.getElementById("searchInput");
  const planSearchInput = document.getElementById("planSearchInput");
  const themeToggle = document.getElementById("themeToggle");
  const raichuBubbles = document.querySelectorAll(".raichu-bubble");
  const themeMascots = document.querySelectorAll(".raichu-img");
  const siteFavicon = document.getElementById("siteFavicon");
  const themeHearts = document.querySelectorAll(".theme-heart");
   document.body.classList.toggle("bulbasaur-theme", isBulbasaur);
  document.title = isBulbasaur ? `bulba queue ${themeIcon}` : `raichu queue ${themeIcon}`;
  localStorage.setItem(THEME_STORAGE_KEY, isBulbasaur ? "bulbasaur" : "raichu");
  if (options.savePreference !== false) {
    queueProfilePreferenceSave();
  }
   if (appTitle) appTitle.textContent = titleText;
  if (activityTitle) activityTitle.textContent = `activity log ${themeIcon}`;
  if (ongoingTitle) ongoingTitle.textContent = `currently in rotation ${themeIcon}`;
  if (statsBar && statsBar.textContent.includes("loading stats")) {
    statsBar.innerHTML = `<span class="stats-loading">${themeIcon} loading stats and petting the raichu ...</span>`;
  }
  if (sidebarStatsBar && sidebarStatsBar.textContent.includes("loading stats")) {
    sidebarStatsBar.innerHTML = `<span class="stats-loading">${themeIcon} loading stats and petting the raichu ...</span>`;
  }
  if (addButton) {
    addButton.textContent =
      window.innerWidth <= 700 ? "add" : `add to queue ${themeIcon}`;
  }
  if (searchInput) searchInput.placeholder = `${themeIcon} search the queue`;
  if (planSearchInput) planSearchInput.placeholder = `${themeIcon} search plans`;
  if (themeToggle) {
    themeToggle.textContent = isBulbasaur ? "raichu mode" : "bulba mode";
    themeToggle.classList.toggle("is-active", isBulbasaur);
    themeToggle.setAttribute("aria-pressed", String(isBulbasaur));
  }
  themeHearts.forEach((heart) => {
    heart.textContent = heartIcon;
  });
  themeMascots.forEach((themeMascot) => {
    themeMascot.src = isBulbasaur ? "bulba.gif" : "raichu.ico";
    themeMascot.alt = isBulbasaur ? "bulbasaur" : "raichu";
  });
  if (siteFavicon) {
    siteFavicon.href = isBulbasaur ? "bulba.gif" : "raichu.ico";
    siteFavicon.type = isBulbasaur ? "image/gif" : "image/x-icon";
  }
  raichuBubbles.forEach((raichuBubble) => {
    raichuBubble.dataset.default = "hi gf";
    if (!raichuBubble.classList.contains("show")) {
      raichuBubble.textContent = raichuBubble.dataset.default;
    }
  });
}
 const ACTIVE_PAGE_STORAGE_KEY = "raichuActivePage";
const planCategories = ["things", "food", "places"];
let plans = [];
let planPages = { things: 1, food: 1, places: 1 };
 function normalizePlan(plan) {
  if (!plan) return plan;
  return {
    ...plan,
    title: toLowerSafe(plan.title),
    category: toLowerSafe(plan.category || "things"),
    tags: toLowerSafe(plan.tags || ""),
    done: Boolean(plan.completed),
  };
}
 function setActivePage(pageId, options = {}) {
  document.querySelectorAll(".app-page").forEach((page) => {
    page.classList.toggle("active", page.id === pageId);
  });
   document.querySelectorAll(".page-tab").forEach((tab) => {
    const isActive = tab.dataset.page === pageId;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
   localStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, pageId);
  if (options.savePreference !== false) {
    queueProfilePreferenceSave({ activePage: pageId });
  }
}
 async function loadPlans() {
  const { data, error } = await supabaseClient
    .from("plans")
    .select("id, title, category, completed, tags, created_at")
    .order("created_at", { ascending: false });
   if (error) {
    console.error("error loading plans from supabase:", error);
    plans = [];
    renderPlans();
    return;
  }
   plans = (data || []).map(normalizePlan);
  renderPlans();
}
 function resetPlanPages() {
  planPages = { things: 1, food: 1, places: 1 };
}
 function renderPlanPagination(category, currentPage, totalPages) {
  const paginationEl = document.getElementById(`${category}PlanPagination`);
  if (!paginationEl) return;
   if (totalPages <= 1) {
    paginationEl.innerHTML = "";
    return;
  }
   paginationEl.innerHTML = `
    <button type="button" class="page-btn secondary-btn" aria-label="previous page" ${currentPage === 1 ? "disabled" : ""} onclick="changePlanPage('${category}', -1)">‹</button>
    <span class="page-info">page ${currentPage} of ${totalPages}</span>
    <button type="button" class="page-btn secondary-btn" aria-label="next page" ${currentPage === totalPages ? "disabled" : ""} onclick="changePlanPage('${category}', 1)">›</button>
  `;
}
 function renderPlans() {
  planCategories.forEach((category) => {
    const list = document.getElementById(`${category}PlanList`);
    if (!list) return;
     const categoryPlans = plans.filter((plan) => {
      const matchesCategory = plan.category === category;
      const matchesSearch =
        !planSearchTerm ||
        String(plan.title || "").toLowerCase().includes(planSearchTerm) ||
        String(plan.tags || "").toLowerCase().includes(planSearchTerm);
      return matchesCategory && matchesSearch;
    });
     if (categoryPlans.length === 0) {
      list.innerHTML = `<div class="empty">nothing here yet ✨</div>`;
      renderPlanPagination(category, 1, 1);
      return;
    }
     const totalPages = Math.max(1, Math.ceil(categoryPlans.length / PLAN_ITEMS_PER_PAGE));
    const currentPage = Math.min(Math.max(1, planPages[category] || 1), totalPages);
    const start = (currentPage - 1) * PLAN_ITEMS_PER_PAGE;
    const pagePlans = categoryPlans.slice(start, start + PLAN_ITEMS_PER_PAGE);
    planPages[category] = currentPage;
     list.innerHTML = pagePlans
      .map((plan) => {
        const globalIndex = plans.findIndex((savedPlan) => savedPlan.id === plan.id);
        return `
          <div class="plan-item ${plan.done ? "done" : ""}">
            <input
              type="checkbox"
              class="plan-check"
              ${plan.done ? "checked" : ""}
              onchange="togglePlanDone(${globalIndex})"
              aria-label="mark ${escapeAttribute(plan.title)} as done"
            />
            <div class="plan-content">
              <div class="plan-title-edit-row" id="plan-title-row-${globalIndex}">
                <span
                  class="plan-title"
                  id="plan-title-text-${globalIndex}"
                  onclick="togglePlanTitleEditor(${globalIndex})"
                >${escapeHtml(plan.title)}</span>
                 <input
                  type="text"
                  class="plan-title-editor"
                  id="plan-title-editor-${globalIndex}"
                  value="${escapeAttribute(plan.title)}"
                  onkeydown="if(event.key==='Enter'){savePlanTitle(${globalIndex})}"
                />
                 <button
                  type="button"
                  class="plan-title-save-btn"
                  id="plan-title-save-${globalIndex}"
                  onclick="savePlanTitle(${globalIndex})"
                >edit</button>
              </div>
              <div class="plan-tag-row">
                ${
                  getPlanTags(plan.tags).length
                    ? `<div class="plan-tag-list">
                        ${getPlanTags(plan.tags)
                          .map((tag) => `<span class="plan-tag plan-tag-removable">
    ${escapeHtml(tag)}
    <button
      type="button"
      class="plan-tag-delete"
      onclick="removePlanTag(${globalIndex}, '${tag.replace(/'/g, "\'")}')"
      aria-label="remove ${escapeAttribute(tag)} tag"
    >×</button>
  </span>`)
                          .join("")}
                       </div>
                       <button
                         type="button"
                         class="plan-tag-add"
                         onclick="togglePlanTagEditor(${globalIndex})"
                         aria-label="edit tags for ${escapeAttribute(plan.title)}"
                       >+</button>`
                    : `<button
                         type="button"
                         class="plan-tag plan-tag-empty"
                         onclick="togglePlanTagEditor(${globalIndex})"
                         aria-label="add tag for ${escapeAttribute(plan.title)}"
                       >+</button>`
                }
              </div>
              <div class="plan-tag-editor" id="plan-tag-editor-${globalIndex}">
                <input
                  type="text"
                  id="plan-tag-input-${globalIndex}"
                  value=""
                  placeholder="add new tag"
                  onkeydown="if(event.key === 'Enter'){ event.preventDefault(); savePlanTag(${globalIndex}); }"
                />
                <button type="button" onclick="savePlanTag(${globalIndex})">add</button>
                <button type="button" class="secondary-btn" onclick="clearPlanTag(${globalIndex})">clear all</button>
              </div>
            </div>
            <button type="button" class="plan-delete-btn" onclick="removePlan(${globalIndex})" aria-label="delete ${escapeAttribute(plan.title)}">✕</button>
          </div>
        `;
      })
      .join("");
    renderPlanPagination(category, currentPage, totalPages);
  });
}
 function changePlanPage(category, direction) {
  if (!planCategories.includes(category)) return;
  planPages[category] = (planPages[category] || 1) + direction;
  renderPlans();
}
 let draftPlanTags = [];
 function getPlanTags(tags) {
  const rawTags = String(tags || "").trim();
  if (!rawTags) return [];
   if (rawTags.startsWith("[")) {
    try {
      const parsedTags = JSON.parse(rawTags);
      if (Array.isArray(parsedTags)) {
        return parsedTags
          .map((tag) => toLowerSafe(tag).trim())
          .filter(Boolean);
      }
    } catch (error) {
      console.warn("could not parse saved plan tags:", error);
    }
  }
   return rawTags
    .split(",")
    .map((tag) => toLowerSafe(tag).trim())
    .filter(Boolean);
}
 function serializePlanTags(tags) {
  return JSON.stringify([...new Set(tags.map((tag) => toLowerSafe(tag).trim()).filter(Boolean))]);
}
 function renderDraftPlanTags() {
  const list = document.getElementById("draftPlanTagList");
  if (!list) return;
   list.innerHTML = draftPlanTags
    .map((tag, index) => `
      <span class="draft-plan-tag">
        ${escapeHtml(tag)}
        <button
          type="button"
          class="draft-tag-remove"
          onclick="removeDraftPlanTag(${index})"
          aria-label="remove ${escapeAttribute(tag)} tag"
        >×</button>
      </span>
    `)
    .join("");
}
 function removeDraftPlanTag(index) {
  draftPlanTags.splice(index, 1);
  renderDraftPlanTags();
   const input = document.getElementById("planTagDraftInput");
  if (input) input.focus();
}
 function addDraftPlanTagFromInput() {
  const input = document.getElementById("planTagDraftInput");
  if (!input) return false;
   const tag = toLowerSafe(input.value.trim());
  if (!tag) return false;
   if (!draftPlanTags.includes(tag)) {
    draftPlanTags.push(tag);
  }
   input.value = "";
  renderDraftPlanTags();
   requestAnimationFrame(() => {
    input.focus();
  });
   return true;
}
 function collectPlanTagsForSave() {
  addDraftPlanTagFromInput();
  return serializePlanTags(draftPlanTags);
}
 function resetDraftPlanTags() {
  draftPlanTags = [];
  renderDraftPlanTags();
   const input = document.getElementById("planTagDraftInput");
  if (input) input.value = "";
}
 function setupDraftPlanTagInput() {
  const input = document.getElementById("planTagDraftInput");
  if (!input || input.dataset.ready === "true") return;
   input.dataset.ready = "true";
   input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
     event.preventDefault();
    event.stopPropagation();
     addDraftPlanTagFromInput();
  });
   renderDraftPlanTags();
}
 async function addPlan() {
  const input = document.getElementById("planInput");
  const categoryInput = document.getElementById("planCategoryInput");
  if (!input || !categoryInput) return;
   const title = toLowerSafe(input.value.trim());
  const tags = collectPlanTagsForSave();
  const category = toLowerSafe(categoryInput.value || "things");
   if (!title) return;
   const duplicate = plans.some(
    (plan) => plan.title === title && plan.category === category,
  );
   if (duplicate) {
    alert("that plan is already in this category.");
    return;
  }
   const { error } = await supabaseClient.from("plans").insert([
    {
      title,
      category,
      tags,
      completed: false,
    },
  ]);
   if (error) {
    console.error("error adding plan to supabase:", error);
    alert("couldn't add that plan right now.");
    return;
  }
   input.value = "";
  resetDraftPlanTags();
  planPages[category] = 1;
  await loadPlans();
  await logPlanAdded(title, category);
}
 function togglePlanTagEditor(index) {
  const editor = document.getElementById(`plan-tag-editor-${index}`);
  const input = document.getElementById(`plan-tag-input-${index}`);
  if (!editor) return;
   editor.classList.toggle("show");
   if (editor.classList.contains("show") && input) {
    input.value = "";
    input.focus();
  }
}
 async function savePlanTag(index) {
  if (!plans[index]) return;
   const input = document.getElementById(`plan-tag-input-${index}`);
  if (!input) return;
   const plan = plans[index];
   const existingTags = getPlanTags(plan.tags);
  const tagToAdd = toLowerSafe(input.value.trim());
  const addedTags = tagToAdd ? [tagToAdd] : [];
   const newTags = serializePlanTags([...existingTags, ...addedTags]);
   if (!addedTags.length) {
    togglePlanTagEditor(index);
    return;
  }
   plans[index].tags = newTags;
  renderPlans();
   const { error } = await supabaseClient
    .from("plans")
    .update({ tags: newTags })
    .eq("id", plan.id);
   if (error) {
    console.error("error adding plan tag:", error);
    await loadPlans();
    alert("couldn't add that tag right now.");
    return;
  }
   await loadPlans();
  showMascotActionMessage("save");
}
  async function removePlanTag(index, tagToRemove) {
  if (!plans[index]) return;
   const plan = plans[index];
   const newTags = serializePlanTags(
    getPlanTags(plan.tags).filter((tag) => tag !== tagToRemove),
  );
   plans[index].tags = newTags;
  renderPlans();
   const { error } = await supabaseClient
    .from("plans")
    .update({ tags: newTags })
    .eq("id", plan.id);
   if (error) {
    console.error("error removing plan tag:", error);
    await loadPlans();
    alert("couldn't remove that tag right now.");
    return;
  }
   await loadPlans();
}
 async function clearPlanTag(index) {
  if (!plans[index]) return;
   const plan = plans[index];
   plans[index].tags = "";
  renderPlans();
   const { error } = await supabaseClient
    .from("plans")
    .update({ tags: "" })
    .eq("id", plan.id);
   if (error) {
    console.error("error clearing plan tag:", error);
    await loadPlans();
    alert("couldn't clear that tag right now.");
    return;
  }
   await loadPlans();
}
  function togglePlanTitleEditor(index) {
  const titleText = document.getElementById(`plan-title-text-${index}`);
  const input = document.getElementById(`plan-title-editor-${index}`);
  const saveBtn = document.getElementById(`plan-title-save-${index}`);
  if (!titleText || !input || !saveBtn) return;
   titleText.classList.add("editing");
  input.classList.add("show");
  saveBtn.classList.add("show");
   input.value = plans[index]?.title || input.value;
  input.focus();
  input.select();
}
 async function savePlanTitle(index) {
  if (!plans[index]) return;
   const titleText = document.getElementById(`plan-title-text-${index}`);
  const input = document.getElementById(`plan-title-editor-${index}`);
  const saveBtn = document.getElementById(`plan-title-save-${index}`);
  if (!input) return;
   const newTitle = toLowerSafe(input.value.trim());
  const currentPlan = plans[index];
   if (!newTitle) {
    input.value = currentPlan.title;
    if (titleText) titleText.classList.remove("editing");
    input.classList.remove("show");
    if (saveBtn) saveBtn.classList.remove("show");
    return;
  }
   if (newTitle === currentPlan.title) {
    if (titleText) titleText.classList.remove("editing");
    input.classList.remove("show");
    if (saveBtn) saveBtn.classList.remove("show");
    return;
  }
   plans[index].title = newTitle;
  renderPlans();
   const { error } = await supabaseClient
    .from("plans")
    .update({ title: newTitle })
    .eq("id", currentPlan.id);
   if (error) {
    console.error("error updating plan title:", error);
    await loadPlans();
    alert("couldn't rename that plan right now.");
    return;
  }
   await updateActivityLogsForTitle(currentPlan.title, newTitle);
  await loadPlans();
  showMascotActionMessage("save");
}
 async function togglePlanDone(index) {
  if (!plans[index]) return;
   const plan = plans[index];
  const newDoneValue = !plan.done;
   plans[index].done = newDoneValue;
  renderPlans();
   const { error } = await supabaseClient
    .from("plans")
    .update({ completed: newDoneValue })
    .eq("id", plan.id);
   if (error) {
    console.error("error updating plan done status:", error);
    plans[index].done = !newDoneValue;
    renderPlans();
    return;
  }
   await loadPlans();
}
 async function removePlan(index) {
  if (!plans[index]) return;
  const plan = plans[index];
  const planTitle = plan.title;
  const confirmed = window.confirm(`delete "${planTitle}" from plans?`);
  if (!confirmed) return;
   plans = plans.filter((savedPlan) => savedPlan.id !== plan.id);
  renderPlans();
   const { error } = await supabaseClient
    .from("plans")
    .delete()
    .eq("id", plan.id);
   if (error) {
    console.error("error deleting plan from supabase:", error);
    await loadPlans();
    alert("couldn't delete that plan right now.");
    return;
  }
   await saveActivityLog({
    title: planTitle,
    itemType: "plan",
    eventType: "deleted",
    category: plan.category,
  });
  await loadActivityLog();
  await loadPlans();
  showMascotActionMessage("delete");
}
 // ===== startup event listeners + initial page load =====
document.querySelectorAll(".page-tab").forEach((tab) => {
  tab.addEventListener("click", () => setActivePage(tab.dataset.page));
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") {
    queueActivityLogRefresh(0);
  }
});
 const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
setTheme(savedTheme === "bulbasaur" ? "bulbasaur" : "raichu");
document.querySelectorAll(".raichu-container").forEach((mascot) => {
  mascot.addEventListener("mouseenter", showRandomMascotHoverMessage);
  mascot.addEventListener("focus", showRandomMascotHoverMessage);
});
const savedActivePage = localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY);
setActivePage(savedActivePage === "plansPage" ? "plansPage" : "queuePage");
 const addPlanButton = document.getElementById("addPlanButton");
if (addPlanButton) {
  addPlanButton.addEventListener("click", addPlan);
}
 const planSearchInput = document.getElementById("planSearchInput");
if (planSearchInput) {
  planSearchInput.addEventListener("input", (event) => {
    planSearchTerm = event.target.value.trim().toLowerCase();
    resetPlanPages();
    renderPlans();
  });
}
 const planInput = document.getElementById("planInput");
if (planInput) {
  planInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addPlan();
    }
  });
}
 const signInButton = document.getElementById("signInButton");
const signUpButton = document.getElementById("signUpButton");
const signOutButton = document.getElementById("signOutButton");
const confirmSignOutButton = document.getElementById("confirmSignOutButton");
const cancelSignOutButton = document.getElementById("cancelSignOutButton");
const closeSignOutConfirmButton = document.getElementById("closeSignOutConfirmButton");
const myAddsButton = document.getElementById("myAddsButton");
const editAccountButton = document.getElementById("editAccountButton");
const saveAccountSettingsButton = document.getElementById("saveAccountSettingsButton");
const closeAccountSettingsButton = document.getElementById("closeAccountSettingsButton");
const saveProfileButton = document.getElementById("saveProfileButton");
const accountAvatar = document.getElementById("accountAvatar");
const chooseProfileImageButton = document.getElementById("chooseProfileImageButton");
const removeProfileImageButton = document.getElementById("removeProfileImageButton");
const saveProfileImageUrlButton = document.getElementById("saveProfileImageUrlButton");
const closeAvatarPopoverButton = document.getElementById("closeAvatarPopoverButton");
const profileImageUrlInput = document.getElementById("profileImageUrlInput");
const profileImageInput = document.getElementById("profileImageInput");
const accountPasswordInput = document.getElementById("accountPasswordInput");
if (signInButton) signInButton.addEventListener("click", signInWithPassword);
if (signUpButton) signUpButton.addEventListener("click", signUpWithPassword);
if (signOutButton) signOutButton.addEventListener("click", openSignOutConfirmModal);
if (confirmSignOutButton) confirmSignOutButton.addEventListener("click", signOutAccount);
if (cancelSignOutButton) cancelSignOutButton.addEventListener("click", closeSignOutConfirmModal);
if (closeSignOutConfirmButton) closeSignOutConfirmButton.addEventListener("click", closeSignOutConfirmModal);
if (myAddsButton) myAddsButton.addEventListener("click", togglePersonalQueueOnly);
if (editAccountButton) editAccountButton.addEventListener("click", openAccountSettingsModal);
if (saveAccountSettingsButton) saveAccountSettingsButton.addEventListener("click", saveAccountSettings);
if (closeAccountSettingsButton) closeAccountSettingsButton.addEventListener("click", closeAccountSettingsModal);
if (saveProfileButton) saveProfileButton.addEventListener("click", saveDisplayName);
if (accountAvatar) accountAvatar.addEventListener("click", () => toggleAvatarPopover());
if (chooseProfileImageButton) chooseProfileImageButton.addEventListener("click", chooseProfileImage);
if (removeProfileImageButton) removeProfileImageButton.addEventListener("click", removeProfileImage);
if (saveProfileImageUrlButton) saveProfileImageUrlButton.addEventListener("click", saveProfileImageUrl);
if (closeAvatarPopoverButton) closeAvatarPopoverButton.addEventListener("click", () => toggleAvatarPopover(false));
if (profileImageUrlInput) {
  profileImageUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveProfileImageUrl();
    }
  });
}
document.addEventListener("click", (event) => {
  const popover = document.getElementById("avatarPopover");
  if (event.target === popover) {
    toggleAvatarPopover(false);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const popover = document.getElementById("avatarPopover");
    if (popover?.classList.contains("show")) {
      toggleAvatarPopover(false);
    }
  }
});
if (profileImageInput) {
  profileImageInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    saveProfileImage(file);
    event.target.value = "";
  });
}
if (accountPasswordInput) {
  accountPasswordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      signInWithPassword();
    }
  });
}
["accountSettingsNameInput", "accountSettingsPasswordInput"].forEach((inputId) => {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveAccountSettings();
    }
  });
});
renderAccountPanel();
initializeAuth();
 loadPlans();
setupDraftPlanTagInput();
setupQueueTagChipControls();
setupMediaSuggestionControls();
 document.getElementById("addButton").addEventListener("click", addItem);
document.getElementById("mobileAddButton").addEventListener("click", addItem);
document
  .getElementById("openAddModal")
  .addEventListener("click", openAddModal);
document
  .getElementById("closeAddModal")
  .addEventListener("click", closeAddModal);
document
  .getElementById("addOverlay")
  .addEventListener("click", (event) => {
    if (event.target.id === "addOverlay") closeAddModal();
  });
document
  .getElementById("closeEditModal")
  .addEventListener("click", closeEditModal);
document
  .getElementById("saveEditButton")
  .addEventListener("click", saveEditItem);
document
  .getElementById("editDeleteButton")
  .addEventListener("click", deleteEditItem);
document
  .getElementById("editOverlay")
  .addEventListener("click", (event) => {
    if (event.target.id === "editOverlay") closeEditModal();
  });
document
  .getElementById("accountSettingsOverlay")
  ?.addEventListener("click", (event) => {
    if (event.target.id === "accountSettingsOverlay") closeAccountSettingsModal();
  });
document
  .getElementById("signOutConfirmOverlay")
  ?.addEventListener("click", (event) => {
    if (event.target.id === "signOutConfirmOverlay") closeSignOutConfirmModal();
  });
document
  .getElementById("editTypeInput")
  .addEventListener("change", (event) => {
    const statusInput = document.getElementById("editStatusInput");
    statusInput.innerHTML = getStatusOptionsForType(
      event.target.value,
      statusInput.value,
    );
    refreshQueueTagChipsForMode("edit");
  });
document
  .getElementById("typeInput")
  .addEventListener("change", () => {
    refreshQueueTagChipsForMode("add");
  });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAddModal();
    closeEditModal();
    closeAccountSettingsModal();
    closeSignOutConfirmModal();
  }
});
document
  .getElementById("searchInput")
  .addEventListener("input", (event) => {
    searchTerm = event.target.value.trim().toLowerCase();
    moviePage = 1;
    gamePage = 1;
    render();
  });
 document
  .getElementById("statusFilter")
  .addEventListener("change", (event) => {
    statusFilter = event.target.value;
    moviePage = 1;
    gamePage = 1;
    render();
  });
 document
  .getElementById("mediaTypeFilter")
  .addEventListener("change", (event) => {
    mediaTypeFilter = event.target.value;
    moviePage = 1;
    gamePage = 1;
    render();
  });
 document
  .getElementById("genreFilter")
  .addEventListener("change", (event) => {
    genreFilter = event.target.value;
    moviePage = 1;
    gamePage = 1;
    render();
  });
 document
  .getElementById("platformFilter")
  .addEventListener("change", (event) => {
    platformFilter = event.target.value;
    moviePage = 1;
    gamePage = 1;
    render();
  });
 document
  .getElementById("tagFilter")
  .addEventListener("change", (event) => {
    tagFilter = event.target.value;
    moviePage = 1;
    gamePage = 1;
    render();
  });
 document
  .getElementById("moodFilter")
  .addEventListener("change", (event) => {
    moodFilter = event.target.value;
    moviePage = 1;
    gamePage = 1;
    render();
  });
 const customFilterMenus = [];
function setupCustomFilter(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
   const customFilter = document.createElement("div");
  const customButton = document.createElement("button");
  const customMenu = document.createElement("div");
   customFilter.className = "filter-custom";
  customFilter.dataset.filterId = selectId;
  customButton.type = "button";
  customButton.className = "filter-button";
  customButton.setAttribute("aria-haspopup", "listbox");
  customButton.setAttribute("aria-expanded", "false");
  customMenu.className = "filter-menu";
  customMenu.setAttribute("role", "listbox");
   const setFilterLabel = () => {
    customButton.textContent =
      select.selectedOptions[0]?.textContent || select.options[0]?.textContent || "";
  };
   const syncActiveOption = () => {
    customMenu
      .querySelectorAll(".filter-option")
      .forEach((button) =>
        button.classList.toggle("active", button.dataset.value === select.value),
      );
  };
   Array.from(select.options).forEach((option) => {
    const optionButton = document.createElement("button");
    optionButton.type = "button";
    optionButton.className = "filter-option";
    optionButton.textContent = option.textContent;
    optionButton.dataset.value = option.value;
    optionButton.setAttribute("role", "option");
    optionButton.addEventListener("click", () => {
      select.value = option.value;
      select.dispatchEvent(new Event("change"));
      setFilterLabel();
      syncActiveOption();
      customFilter.classList.remove("open");
      customButton.setAttribute("aria-expanded", "false");
    });
    customMenu.appendChild(optionButton);
  });
   setFilterLabel();
  syncActiveOption();
  customFilter.append(customButton, customMenu);
  select.classList.add("filter-native-hidden");
  select.insertAdjacentElement("afterend", customFilter);
  customFilterMenus.push({
    customFilter,
    customButton,
    select,
    refresh: () => {
      setFilterLabel();
      syncActiveOption();
    },
  });
   customButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = !customFilter.classList.contains("open");
    customFilterMenus.forEach(({ customFilter: menu, customButton: button }) => {
      menu.classList.remove("open");
      button.setAttribute("aria-expanded", "false");
    });
    customFilter.classList.toggle("open", willOpen);
    customButton.setAttribute("aria-expanded", String(willOpen));
  });
}
 [
  "statusFilter",
  "mediaTypeFilter",
  "genreFilter",
  "platformFilter",
  "tagFilter",
  "moodFilter",
  "accountSettingsThemeInput",
].forEach(setupCustomFilter);
 document.addEventListener("click", (event) => {
  customFilterMenus.forEach(({ customFilter, customButton }) => {
    if (!customFilter.contains(event.target)) {
      customFilter.classList.remove("open");
      customButton.setAttribute("aria-expanded", "false");
    }
  });
});
 const toggleDescriptionBtn = document.getElementById(
  "toggleDescriptionBtn",
);
const descriptionBox = document.getElementById("descriptionBox");
 if (toggleDescriptionBtn && descriptionBox) {
  toggleDescriptionBtn.addEventListener("click", () => {
    descriptionBox.classList.toggle("show");
    toggleDescriptionBtn.textContent = descriptionBox.classList.contains(
      "show",
    )
      ? "hide summary"
      : "add summary";
  });
}
 window.updateStatus = updateStatus;
window.removeItem = removeItem;
window.updateItemType = updateItemType;
window.openEditModal = openEditModal;
window.openEditModalById = openEditModalById;
window.toggleSummaryEditor = toggleSummaryEditor;
window.toggleTitleEditor = toggleTitleEditor;
window.handleTitleEditKey = handleTitleEditKey;
window.saveTitle = saveTitle;
window.saveSummary = saveSummary;
window.updateRating = updateRating;
window.togglePriority = togglePriority;
window.changePage = changePage;
window.changePlanPage = changePlanPage;
window.togglePlanDone = togglePlanDone;
window.removePlan = removePlan;
 window.togglePlanTagEditor = togglePlanTagEditor;
window.savePlanTag = savePlanTag;
window.clearPlanTag = clearPlanTag;
window.removeDraftPlanTag = removeDraftPlanTag;
window.removePlanTag = removePlanTag;
window.togglePlanTitleEditor = togglePlanTitleEditor;
window.savePlanTitle = savePlanTitle;
window.setupDraftPlanTagInput = setupDraftPlanTagInput;
 loadItems();
loadActivityLog();
subscribeToChanges();
