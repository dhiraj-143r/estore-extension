export interface StoreSettings {
    enabled: boolean;
}

export interface BadgePreferences {
    showNutriScore: boolean;
    showNova: boolean;
    showEcoScore: boolean;
    showHealthCanada: boolean;
}

export interface ExtensionSettings {
    enabled: boolean;
    stores: Record<string, StoreSettings>;
    badges: BadgePreferences;
    language: 'en' | 'fr';
    badgeSize: 'small' | 'medium' | 'large';
    minimumConfidence: number;
    showContributePrompt: boolean;
}

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

const STORAGE_KEY = 'estore_settings';

/** Load settings from browser storage, merging with defaults for new fields. */
export async function loadSettings(): Promise<ExtensionSettings> {
    try {
        const result = await browser.storage.local.get(STORAGE_KEY);

        if (!result[STORAGE_KEY]) {
            return { ...DEFAULT_SETTINGS };
        }

        const saved = result[STORAGE_KEY] as Partial<ExtensionSettings>;

        return {
            ...DEFAULT_SETTINGS,
            ...saved,
            stores: {
                ...DEFAULT_SETTINGS.stores,
                ...(saved.stores || {}),
            },
            badges: {
                ...DEFAULT_SETTINGS.badges,
                ...(saved.badges || {}),
            },
        };
    } catch (error) {
        console.warn('[E-Store] Failed to load settings, using defaults:', error);
        return { ...DEFAULT_SETTINGS };
    }
}

/** Persist the full settings object to browser storage. */
export async function saveSettings(settings: ExtensionSettings): Promise<void> {
    try {
        await browser.storage.local.set({ [STORAGE_KEY]: settings });
    } catch (error) {
        console.error('[E-Store] Failed to save settings:', error);
        throw error;
    }
}

/** Toggle a single store's enabled state. */
export async function setStoreEnabled(storeSlug: string, enabled: boolean): Promise<void> {
    const settings = await loadSettings();

    if (!settings.stores[storeSlug]) {
        settings.stores[storeSlug] = { enabled };
    } else {
        settings.stores[storeSlug].enabled = enabled;
    }

    await saveSettings(settings);
}

/** Check whether a specific store is currently enabled. */
export async function isStoreEnabled(storeSlug: string): Promise<boolean> {
    const settings = await loadSettings();
    return settings.stores[storeSlug]?.enabled ?? true;
}

/** Check the global extension enabled state. */
export async function isExtensionEnabled(): Promise<boolean> {
    const settings = await loadSettings();
    return settings.enabled;
}

/** Set the global extension enabled state. */
export async function setExtensionEnabled(enabled: boolean): Promise<void> {
    const settings = await loadSettings();
    settings.enabled = enabled;
    await saveSettings(settings);
}

/** Subscribe to settings changes. Returns an unsubscribe function. */
export function onSettingsChanged(
    callback: (settings: ExtensionSettings) => void,
): () => void {
    const listener = (
        changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
        area: string,
    ) => {
        if (area === 'local' && changes[STORAGE_KEY]) {
            const newSettings = changes[STORAGE_KEY].newValue as ExtensionSettings;
            if (newSettings) {
                callback(newSettings);
            }
        }
    };

    browser.storage.onChanged.addListener(listener);

    return () => {
        browser.storage.onChanged.removeListener(listener);
    };
}
