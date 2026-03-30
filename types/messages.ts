import type { MatchResult, OFFProduct, BadgeData, ScrapedProductData } from '@/types';
import type { ExtensionSettings } from '@/utils/storage';

// --- Messages (content script / popup → background) ---

export interface LookupBarcodeMessage {
    type: 'LOOKUP_BARCODE';
    barcode: string;
}

export interface SearchProductMessage {
    type: 'SEARCH_PRODUCT';
    name: string;
    brand?: string;
    storeSlug: string;
}

export interface MatchProductMessage {
    type: 'MATCH_PRODUCT';
    identifier: {
        type: 'barcode' | 'sku' | 'name';
        value: string;
        confidence: number;
    } | null;
    name: string;
    brand?: string;
    storeSlug: string;
}

export interface GetSettingsMessage {
    type: 'GET_SETTINGS';
}

export interface GetCacheStatsMessage {
    type: 'GET_CACHE_STATS';
}

export interface ClearCacheMessage {
    type: 'CLEAR_CACHE';
}

export interface BatchLookupMessage {
    type: 'BATCH_LOOKUP';
    barcodes: string[];
}

export interface ProductsProcessedMessage {
    type: 'PRODUCTS_PROCESSED';
    matchedCount: number;
    totalCount: number;
}

export interface SettingsChangedMessage {
    type: 'SETTINGS_CHANGED';
    settings: ExtensionSettings;
}

export type BackgroundMessage =
    | LookupBarcodeMessage
    | SearchProductMessage
    | MatchProductMessage
    | GetSettingsMessage
    | GetCacheStatsMessage
    | ClearCacheMessage
    | BatchLookupMessage
    | ProductsProcessedMessage
    | SettingsChangedMessage;

// --- Responses (background → content script / popup) ---

export interface LookupBarcodeResponse {
    success: boolean;
    product?: OFFProduct;
    badgeData?: BadgeData;
    error?: string;
}

export interface MatchProductResponse {
    success: boolean;
    match?: MatchResult;
    badgeData?: BadgeData;
    error?: string;
}

export interface GetSettingsResponse {
    success: boolean;
    settings?: ExtensionSettings;
    error?: string;
}

export interface CacheStatsResponse {
    success: boolean;
    stats?: {
        totalEntries: number;
        totalSizeKB: number;
        expiredEntries: number;
        categoryCounts: Record<string, number>;
    };
    error?: string;
}

export interface ClearCacheResponse {
    success: boolean;
    error?: string;
}

export interface BatchLookupResponse {
    success: boolean;
    results?: Record<string, {
        product: import('@/types').OFFProduct;
        badgeData: import('@/types').BadgeData;
    }>;
    error?: string;
}

export interface ProductsProcessedResponse {
    success: boolean;
}

export interface SettingsChangedResponse {
    success: boolean;
}

// --- Helper ---

/** Type-safe wrapper around browser.runtime.sendMessage. */
export async function sendToBackground<T>(message: BackgroundMessage): Promise<T> {
    return browser.runtime.sendMessage(message) as Promise<T>;
}
