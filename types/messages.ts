/**
 * ============================================================================
 * Message Types — Communication Protocol Between Extension Parts
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * Defines the "language" that different parts of the extension use to
 * talk to each other. Think of it like a walkie-talkie protocol:
 *   - Content script says: "Hey background, look up this barcode for me"
 *   - Background replies: "Here's the product data"
 *
 * WHY MESSAGE PASSING IS NEEDED:
 * A browser extension has multiple isolated "worlds" running simultaneously:
 *
 *   ┌──────────────────┐     ┌──────────────────────┐
 *   │  CONTENT SCRIPT   │     │  BACKGROUND WORKER    │
 *   │  (runs on the     │◄───►│  (runs independently, │
 *   │   grocery page)   │     │   manages API calls)  │
 *   └──────────────────┘     └──────────────────────┘
 *           ▲                          ▲
 *           │                          │
 *           ▼                          │
 *   ┌──────────────────┐              │
 *   │  POPUP UI         │◄────────────┘
 *   │  (extension icon  │
 *   │   click menu)     │
 *   └──────────────────┘
 *
 * These "worlds" can NOT directly call each other's functions.
 * They communicate by sending MESSAGES through Chrome's messaging API.
 *
 * HOW IT WORKS:
 *   1. Content script creates a message: { type: "LOOKUP_BARCODE", barcode: "123" }
 *   2. Content script sends it: browser.runtime.sendMessage(message)
 *   3. Background worker receives it and processes the request
 *   4. Background worker sends back a response: { product: {...}, confidence: 1.0 }
 *   5. Content script receives the response and uses it
 *
 * WHY TYPED MESSAGES?
 * Without types, we'd be passing around `any` objects and hoping the other
 * side knows what fields to expect. TypeScript message types ensure:
 *   - We never send a message with missing fields
 *   - We never misspell a message type
 *   - The response shape is always correct
 * ============================================================================
 */

import type { MatchResult, OFFProduct, BadgeData, ScrapedProductData } from '@/types';
import type { ExtensionSettings } from '@/utils/storage';

// ─── Message Types (Content Script → Background) ────────────────────

/**
 * Content script asks the background to look up a product by barcode.
 *
 * WHEN SENT:
 * The content script found a barcode in the grocery store's DOM and
 * wants the background worker to look it up in the OFF database.
 */
export interface LookupBarcodeMessage {
    type: 'LOOKUP_BARCODE';

    /** The barcode to look up (e.g., "3017620422003") */
    barcode: string;
}

/**
 * Content script asks the background to search for a product by name.
 *
 * WHEN SENT:
 * No barcode was found, so the content script sends the product's
 * name and brand for a text-based search.
 */
export interface SearchProductMessage {
    type: 'SEARCH_PRODUCT';

    /** Product name from the store page (e.g., "Nutella 750g") */
    name: string;

    /** Brand name if available (e.g., "Ferrero") */
    brand?: string;

    /** Which store this product is from (e.g., "metro") */
    storeSlug: string;
}

/**
 * Content script asks the background to match a complete scraped product.
 *
 * WHEN SENT:
 * The content script sends all scraped data for a product and lets
 * the background worker figure out the best matching strategy.
 * This is the most common message type.
 */
export interface MatchProductMessage {
    type: 'MATCH_PRODUCT';

    /** The product identifier (barcode, SKU, or name) */
    identifier: {
        type: 'barcode' | 'sku' | 'name';
        value: string;
        confidence: number;
    } | null;

    /** Product name from the store page */
    name: string;

    /** Brand name if available */
    brand?: string;

    /** Which store this product is from */
    storeSlug: string;
}

/**
 * Content script asks for the current extension settings.
 *
 * WHEN SENT:
 * When the content script first loads on a page, it needs to know
 * if the extension is enabled, which badges to show, etc.
 */
export interface GetSettingsMessage {
    type: 'GET_SETTINGS';
}

/**
 * Content script (or popup) asks for cache statistics.
 *
 * WHEN SENT:
 * The popup UI wants to display cache info (how many products cached, etc.)
 */
export interface GetCacheStatsMessage {
    type: 'GET_CACHE_STATS';
}

/**
 * Popup asks background to clear all cached data.
 *
 * WHEN SENT:
 * User clicks "Clear Cache" button in the extension popup.
 */
export interface ClearCacheMessage {
    type: 'CLEAR_CACHE';
}

/**
 * Content script sends a batch of barcodes for lookup at once.
 *
 * WHEN SENT:
 * The content script found multiple barcodes on a page and wants
 * to look them all up efficiently. The background deduplicates
 * any in-flight requests automatically.
 */
export interface BatchLookupMessage {
    type: 'BATCH_LOOKUP';

    /** Array of barcodes to look up */
    barcodes: string[];
}

/**
 * Content script reports how many products it successfully processed.
 *
 * WHEN SENT:
 * After a scan cycle completes, the content script tells the background
 * how many products were matched so the badge icon can be updated.
 */
export interface ProductsProcessedMessage {
    type: 'PRODUCTS_PROCESSED';

    /** Number of products that received badges on this tab */
    matchedCount: number;

    /** Total number of products found on the page */
    totalCount: number;
}

/**
 * Popup sends updated settings to the background for broadcasting.
 *
 * WHEN SENT:
 * The user changes settings in the popup UI. The popup saves to
 * chrome.storage AND sends this message to the background so it
 * can immediately broadcast to all content script tabs.
 */
export interface SettingsChangedMessage {
    type: 'SETTINGS_CHANGED';

    /** The updated settings object */
    settings: ExtensionSettings;
}

// ─── Union Type (All Possible Messages) ──────────────────────────────

/**
 * A union of ALL possible messages that can be sent to the background.
 *
 * TypeScript uses this to enforce that we only send valid messages.
 * If we try to send a message with type: "INVALID_TYPE", TypeScript
 * will show an error at compile time.
 */
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

// ─── Response Types (Background → Content Script) ───────────────────

/**
 * Response to a barcode lookup request.
 */
export interface LookupBarcodeResponse {
    /** Whether the lookup was successful */
    success: boolean;

    /** The product data if found */
    product?: OFFProduct;

    /** Pre-computed badge data ready for rendering */
    badgeData?: BadgeData;

    /** Error message if something went wrong */
    error?: string;
}

/**
 * Response to a product match request.
 */
export interface MatchProductResponse {
    /** Whether a match was found */
    success: boolean;

    /** The match result (product + confidence + method) */
    match?: MatchResult;

    /** Pre-computed badge data ready for rendering */
    badgeData?: BadgeData;

    /** Error message if something went wrong */
    error?: string;
}

/**
 * Response to a settings request.
 */
export interface GetSettingsResponse {
    success: boolean;
    settings?: ExtensionSettings;
    error?: string;
}

/**
 * Response to a cache stats request.
 */
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

/**
 * Response to a clear cache request.
 */
export interface ClearCacheResponse {
    success: boolean;
    error?: string;
}

/**
 * Response to a batch barcode lookup request.
 */
export interface BatchLookupResponse {
    success: boolean;

    /** Map of barcode → badge data (only includes found products) */
    results?: Record<string, {
        product: import('@/types').OFFProduct;
        badgeData: import('@/types').BadgeData;
    }>;

    error?: string;
}

/**
 * Response to a products processed notification.
 * (Simple acknowledgment — the background updates the badge icon internally)
 */
export interface ProductsProcessedResponse {
    success: boolean;
}

/**
 * Response to a settings changed notification.
 */
export interface SettingsChangedResponse {
    success: boolean;
}

// ─── Helper Function ─────────────────────────────────────────────────

/**
 * Send a message to the background service worker and get a typed response.
 *
 * This is a convenience wrapper around browser.runtime.sendMessage()
 * that adds TypeScript type safety. Instead of getting back an `any`,
 * you get back the correct response type.
 *
 * @param message - The message to send (must be one of BackgroundMessage types)
 * @returns The response from the background worker
 *
 * @example
 *   // In the content script:
 *   const response = await sendToBackground<MatchProductResponse>({
 *     type: 'MATCH_PRODUCT',
 *     identifier: { type: 'barcode', value: '3017620422003', confidence: 1.0 },
 *     name: 'Nutella 750g',
 *     storeSlug: 'metro',
 *   });
 *
 *   if (response.success && response.badgeData) {
 *     // Show the badges!
 *   }
 */
export async function sendToBackground<T>(message: BackgroundMessage): Promise<T> {
    return browser.runtime.sendMessage(message) as Promise<T>;
}
