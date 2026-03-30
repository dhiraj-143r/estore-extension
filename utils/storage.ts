/**
 * ============================================================================
 * Extension Storage — Chrome Storage API Wrapper for User Settings
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * Manages user settings and preferences using Chrome's built-in storage API.
 * This is DIFFERENT from the cache (cache.ts):
 *
 *   CACHE (cache.ts)           → Temporary API data (product info)
 *   SETTINGS (this file)       → User preferences (which stores are enabled)
 *
 * WHY NOT USE localStorage FOR SETTINGS?
 *   1. localStorage is per-origin — different on metro.ca vs walmart.ca
 *      Chrome storage is shared across ALL pages the extension runs on
 *   2. Chrome storage can sync across devices (if user is signed in)
 *   3. Chrome storage is accessible from ALL extension contexts
 *      (popup, background, content scripts) — localStorage is not
 *
 * CHROME STORAGE TYPES:
 *   - storage.local  → Stored on THIS device only (up to 10MB)
 *   - storage.sync   → Synced across user's devices (up to 100KB)
 *   We use storage.local for our settings because 100KB is too small
 *   for potential future data, and syncing isn't critical for us.
 *
 * HOW WXT HELPS:
 * WXT provides a `browser.storage` polyfill that works in both
 * Chrome (Manifest V3) and Firefox. We don't need to worry about
 * browser-specific differences.
 * ============================================================================
 */

// ─── Settings Type Definitions ───────────────────────────────────────

/**
 * Per-store settings — each store can be independently enabled/disabled.
 *
 * EXAMPLE: User might want badges on Metro but not Walmart
 * {
 *   metro:   { enabled: true },
 *   superc:  { enabled: true },
 *   walmart: { enabled: false },  // User disabled Walmart
 * }
 */
export interface StoreSettings {
    /** Whether the extension is active on this store's website */
    enabled: boolean;
}

/**
 * Which badge types the user wants to see.
 *
 * Default: all badges are shown. User can hide individual badge types
 * if they only care about certain scores.
 */
export interface BadgePreferences {
    /** Show the Nutri-Score badge (A-E nutrition grade) */
    showNutriScore: boolean;

    /** Show the NOVA badge (1-4 processing level) */
    showNova: boolean;

    /** Show the Eco-Score / Green-Score badge (environmental impact) */
    showEcoScore: boolean;

    /** Show Health Canada "High In" warning symbols */
    showHealthCanada: boolean;
}

/**
 * The complete settings object for the extension.
 *
 * This represents ALL user-configurable options. It's saved to
 * Chrome storage and loaded when the extension starts.
 */
export interface ExtensionSettings {
    /** Global on/off switch — disables the extension entirely */
    enabled: boolean;

    /** Per-store enable/disable toggles */
    stores: Record<string, StoreSettings>;

    /** Which badge types are visible */
    badges: BadgePreferences;

    /** UI language ("en" for English, "fr" for French) */
    language: 'en' | 'fr';

    /** Badge display size: small, medium, or large */
    badgeSize: 'small' | 'medium' | 'large';

    /**
     * Minimum confidence required to show a badge.
     * Products matched below this threshold show "unverified" indicator.
     * Range: 0.0 to 1.0 (default: 0.3)
     */
    minimumConfidence: number;

    /**
     * Whether to show a "Add to OFF" prompt for unmatched products.
     * Encourages users to contribute missing products to the OFF database.
     */
    showContributePrompt: boolean;
}

// ─── Default Settings ────────────────────────────────────────────────

/**
 * Default settings for a new installation.
 *
 * When the extension is installed for the first time, these defaults
 * are used. The user can change them via the popup UI.
 *
 * DESIGN CHOICES:
 *   - All stores enabled by default → user can disable individually
 *   - All badges shown → user can hide individual badge types
 *   - English language → user can switch to French
 *   - Medium badge size → good balance between visibility and space
 *   - 0.3 confidence threshold → same as the matcher's minimum
 *   - Contribute prompt ON → helps grow the OFF database
 */
export const DEFAULT_SETTINGS: ExtensionSettings = {
    enabled: true,

    stores: {
        metro: { enabled: true },
        superc: { enabled: true },
        walmart: { enabled: true },
    },

    badges: {
        showNutriScore: true,
        showNova: true,
        showEcoScore: true,
        showHealthCanada: true,
    },

    language: 'en',
    badgeSize: 'medium',
    minimumConfidence: 0.3,
    showContributePrompt: true,
};

// ─── Storage Key ─────────────────────────────────────────────────────

/**
 * The key under which ALL settings are stored in Chrome storage.
 *
 * We store everything under one key as a single JSON object.
 * This makes it easy to load/save all settings at once.
 */
const STORAGE_KEY = 'estore_settings';

// ─── Core Storage Functions ──────────────────────────────────────────

/**
 * Load the extension settings from Chrome storage.
 *
 * If no settings exist yet (first install), returns the defaults.
 * If some settings exist but new fields have been added in an update,
 * we merge the saved settings with the defaults (so new fields get
 * their default values).
 *
 * @returns The complete settings object
 *
 * @example
 *   // In the popup UI or content script:
 *   const settings = await loadSettings();
 *
 *   if (settings.stores["metro"].enabled) {
 *     console.log("Metro is enabled, scanning for products...");
 *   }
 */
export async function loadSettings(): Promise<ExtensionSettings> {
    try {
        // Read from Chrome's extension storage (works across all pages)
        const result = await browser.storage.local.get(STORAGE_KEY);

        // If no settings saved yet (first install), use defaults
        if (!result[STORAGE_KEY]) {
            return { ...DEFAULT_SETTINGS };
        }

        // Merge saved settings with defaults
        // This handles the case where we add new settings in an extension update:
        //   - Old settings the user changed → kept from saved data
        //   - New settings we just added → filled from defaults
        const saved = result[STORAGE_KEY] as Partial<ExtensionSettings>;

        return {
            ...DEFAULT_SETTINGS,   // Start with all defaults
            ...saved,              // Override with saved values
            stores: {
                ...DEFAULT_SETTINGS.stores,    // Default store settings
                ...(saved.stores || {}),       // Override with saved store settings
            },
            badges: {
                ...DEFAULT_SETTINGS.badges,    // Default badge preferences
                ...(saved.badges || {}),       // Override with saved badge preferences
            },
        };

    } catch (error) {
        // If storage read fails (shouldn't happen), use defaults
        console.warn('[E-Store] Failed to load settings, using defaults:', error);
        return { ...DEFAULT_SETTINGS };
    }
}

/**
 * Save the complete settings object to Chrome storage.
 *
 * @param settings - The full settings object to save
 *
 * @example
 *   const settings = await loadSettings();
 *   settings.stores["metro"].enabled = false; // Disable Metro
 *   await saveSettings(settings);
 */
export async function saveSettings(settings: ExtensionSettings): Promise<void> {
    try {
        await browser.storage.local.set({ [STORAGE_KEY]: settings });
    } catch (error) {
        console.error('[E-Store] Failed to save settings:', error);
        throw error; // Re-throw so the caller knows it failed
    }
}

/**
 * Update a single store's enabled/disabled status.
 *
 * This is a convenience function for the popup UI toggle switches.
 * Instead of loading → modifying → saving the entire settings object,
 * you can just call this with the store name and new status.
 *
 * @param storeSlug - The store identifier (e.g., "metro", "walmart")
 * @param enabled - Whether to enable (true) or disable (false) the store
 *
 * @example
 *   // User toggles off Metro in the popup:
 *   await setStoreEnabled("metro", false);
 */
export async function setStoreEnabled(
    storeSlug: string,
    enabled: boolean,
): Promise<void> {
    const settings = await loadSettings();

    // Create the store entry if it doesn't exist yet
    if (!settings.stores[storeSlug]) {
        settings.stores[storeSlug] = { enabled };
    } else {
        settings.stores[storeSlug].enabled = enabled;
    }

    await saveSettings(settings);
}

/**
 * Check if a specific store is currently enabled.
 *
 * @param storeSlug - The store identifier (e.g., "metro")
 * @returns true if the store is enabled (or if no setting exists — default is enabled)
 *
 * @example
 *   // In the content script, before scanning:
 *   if (await isStoreEnabled("metro")) {
 *     // Scan the page for products
 *   }
 */
export async function isStoreEnabled(storeSlug: string): Promise<boolean> {
    const settings = await loadSettings();

    // If no entry for this store, default to enabled
    return settings.stores[storeSlug]?.enabled ?? true;
}

/**
 * Check if the extension is globally enabled.
 *
 * @returns true if the extension is enabled (the master on/off switch)
 *
 * @example
 *   if (await isExtensionEnabled()) {
 *     // Extension is active, proceed with scanning
 *   }
 */
export async function isExtensionEnabled(): Promise<boolean> {
    const settings = await loadSettings();
    return settings.enabled;
}

/**
 * Toggle the global extension on/off switch.
 *
 * @param enabled - Whether to enable or disable the extension globally
 *
 * @example
 *   // User clicks the master toggle in the popup:
 *   await setExtensionEnabled(false); // Turn off everywhere
 */
export async function setExtensionEnabled(enabled: boolean): Promise<void> {
    const settings = await loadSettings();
    settings.enabled = enabled;
    await saveSettings(settings);
}

// ─── Settings Change Listener ────────────────────────────────────────

/**
 * Listen for settings changes from other parts of the extension.
 *
 * WHY THIS IS NEEDED:
 * The extension has multiple "contexts" running at the same time:
 *   - Content script (on the grocery store page)
 *   - Popup (when user clicks the extension icon)
 *   - Background service worker
 *
 * When the user changes a setting in the popup, the content script
 * needs to know about it immediately. Chrome's storage.onChanged
 * event makes this possible.
 *
 * @param callback - Function called whenever settings change
 * @returns A cleanup function to stop listening
 *
 * @example
 *   // In the content script:
 *   const stopListening = onSettingsChanged((newSettings) => {
 *     if (!newSettings.enabled) {
 *       // User disabled the extension — remove all badges
 *       removeBadges();
 *     }
 *   });
 *
 *   // Later, when the content script is unloaded:
 *   stopListening();
 */
export function onSettingsChanged(
    callback: (settings: ExtensionSettings) => void,
): () => void {
    // The listener function that Chrome will call when storage changes
    const listener = (
        changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
        area: string,
    ) => {
        // Only care about changes to our settings key in local storage
        if (area === 'local' && changes[STORAGE_KEY]) {
            const newSettings = changes[STORAGE_KEY].newValue as ExtensionSettings;
            if (newSettings) {
                callback(newSettings);
            }
        }
    };

    // Register the listener with Chrome's storage API
    browser.storage.onChanged.addListener(listener);

    // Return a cleanup function that removes the listener
    return () => {
        browser.storage.onChanged.removeListener(listener);
    };
}
