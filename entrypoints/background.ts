/**
 * ============================================================================
 * Background Service Worker — The Central Hub of the Extension
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * This is the "control center" of the extension. It runs in the background
 * (not on any web page) and coordinates everything:
 *
 *   1. RECEIVES messages from content scripts ("look up this barcode")
 *   2. CALLS the OFF API to get product data
 *   3. SENDS responses back to content scripts ("here's the Nutri-Score")
 *   4. CLEANS UP expired cache entries periodically (every 6 hours)
 *   5. HANDLES installation and update events
 *   6. DEDUPLICATES requests (multiple tabs asking for the same product)
 *   7. UPDATES the extension badge icon with matched product counts
 *   8. BROADCASTS settings changes to all content scripts
 *
 * WHY A BACKGROUND WORKER?
 * Without a background worker, each content script (one per grocery tab)
 * would make its own API calls. This causes problems:
 *   - Multiple tabs could look up the SAME product simultaneously (wasteful)
 *   - No centralized rate limiting (could spam the OFF server)
 *   - No shared state between tabs
 *
 * With a background worker, all tabs talk to ONE central hub:
 *
 *   ┌──────────┐  ┌──────────┐  ┌──────────┐
 *   │ Metro Tab │  │ SuperC   │  │ Walmart  │
 *   │ (content  │  │ Tab      │  │ Tab      │
 *   │  script)  │  │ (content │  │ (content │
 *   └─────┬─────┘  │  script) │  │  script) │
 *         │        └─────┬────┘  └─────┬────┘
 *         │              │             │
 *         ▼              ▼             ▼
 *   ┌─────────────────────────────────────────┐
 *   │        BACKGROUND SERVICE WORKER         │
 *   │                                          │
 *   │  • Receives messages from all tabs       │
 *   │  • Deduplicates in-flight requests       │
 *   │  • Makes API calls (with rate limiting)  │
 *   │  • Manages cache for all tabs            │
 *   │  • Updates badge icon per tab            │
 *   │  • Broadcasts settings changes           │
 *   │  • Sends responses back to each tab      │
 *   └─────────────┬───────────────────────────┘
 *                 │
 *                 ▼
 *   ┌─────────────────────────┐
 *   │  Open Food Facts API     │
 *   │  (world.openfoodfacts.org│)
 *   └─────────────────────────┘
 *
 * MANIFEST V3 NOTE:
 * In Manifest V3 (Chrome's latest extension format), background pages
 * are replaced by "service workers". Service workers can be terminated
 * by the browser when idle and restarted when needed. This means:
 *   - We can NOT store state in global variables (they'd be lost)
 *   - We use Chrome storage and localStorage instead
 *   - All our code is stateless — each message is handled independently
 *   - We use chrome.alarms to keep alive during active processing
 * ============================================================================
 */

import type {
  BackgroundMessage,
  LookupBarcodeResponse,
  MatchProductResponse,
  GetSettingsResponse,
  CacheStatsResponse,
  ClearCacheResponse,
  BatchLookupResponse,
  ProductsProcessedResponse,
} from '@/types/messages';
import type { ProductIdentifier, ScrapedProductData, OFFProduct } from '@/types';
import { fetchProductByBarcode, searchProducts, toBadgeData } from '@/api/off-client';
import { matchProduct } from '@/utils/matcher';
import { purgeExpiredCache, getCacheStats, clearAllCache } from '@/utils/cache';
import { loadSettings } from '@/utils/storage';

// ─── Constants ───────────────────────────────────────────────────────

/**
 * Name of the alarm that triggers periodic cache cleanup.
 * Chrome alarms persist across service worker restarts.
 */
const CACHE_CLEANUP_ALARM = 'estore-cache-cleanup';

/**
 * How often to clean up expired cache entries (in minutes).
 * 360 minutes = 6 hours.
 */
const CACHE_CLEANUP_INTERVAL_MINUTES = 360;

/**
 * Name of the alarm used to keep the service worker alive during
 * active batch processing. Without this, Chrome may terminate the
 * worker mid-batch (MV3 kills idle workers after ~30 seconds).
 */
const KEEPALIVE_ALARM = 'estore-keepalive';

/**
 * Keep-alive alarm interval (in minutes).
 * Chrome alarms have a minimum period of 0.5 minutes (30 seconds).
 * We use the minimum to keep the worker alive during batch processing.
 */
const KEEPALIVE_INTERVAL_MINUTES = 0.5;

// ─── In-Flight Request Deduplication ─────────────────────────────────

/**
 * Map of currently in-flight barcode lookup requests.
 *
 * WHY THIS EXISTS:
 * If the user has 3 Metro tabs open, all 3 might request the same barcode
 * at the same time. Without deduplication, we'd make 3 identical API calls.
 *
 * HOW IT WORKS:
 *   1. Tab A requests barcode "123" → we start an API call, store the Promise
 *   2. Tab B requests barcode "123" → we see it's already in-flight, return the SAME Promise
 *   3. Tab C requests barcode "123" → same thing
 *   4. API call completes → all 3 tabs get the same result
 *   5. Promise is removed from the map
 *
 * NOTE: This is an in-memory map. If Chrome terminates the service worker,
 * this map is lost. That's OK — the requests will just be re-made.
 * The cache layer underneath will still prevent redundant API calls.
 */
const inFlightRequests = new Map<string, Promise<OFFProduct | null>>();

/**
 * Look up a barcode with deduplication.
 *
 * If another request for the same barcode is already in-flight,
 * this returns the same Promise instead of making a duplicate API call.
 *
 * @param barcode - The barcode to look up
 * @returns The product data, or null if not found
 */
async function deduplicatedBarcodeLookup(barcode: string): Promise<OFFProduct | null> {
  // Check if this barcode is already being looked up
  const existing = inFlightRequests.get(barcode);
  if (existing) {
    console.log(`[E-Store Background] Deduplicating request for barcode ${barcode}`);
    return existing;
  }

  // Start a new lookup and track it
  const promise = fetchProductByBarcode(barcode).finally(() => {
    // Remove from the map once the request completes (success or failure)
    inFlightRequests.delete(barcode);
  });

  inFlightRequests.set(barcode, promise);
  return promise;
}

// ─── Badge Icon Management ───────────────────────────────────────────

/**
 * Update the extension icon badge for a specific tab.
 *
 * Shows the number of matched products as a small badge on the extension icon.
 * For example, if we matched 12 products on a Metro tab, the icon shows "12".
 *
 * @param tabId - The tab to update the badge for
 * @param matchedCount - Number of matched products
 * @param totalCount - Total products found on the page
 */
async function updateBadgeForTab(
  tabId: number,
  matchedCount: number,
  totalCount: number,
): Promise<void> {
  try {
    if (matchedCount > 0) {
      // Show the count on the badge
      await browser.action.setBadgeText({
        text: String(matchedCount),
        tabId,
      });

      // Color the badge based on match ratio
      const ratio = matchedCount / totalCount;
      let color: string;

      if (ratio >= 0.7) {
        color = '#4CAF50'; // Green — most products matched
      } else if (ratio >= 0.3) {
        color = '#FF9800'; // Orange — some products matched
      } else {
        color = '#F44336'; // Red — few products matched
      }

      await browser.action.setBadgeBackgroundColor({ color, tabId });
    } else {
      // No matches — clear the badge
      await browser.action.setBadgeText({ text: '', tabId });
    }
  } catch (error) {
    // Tab might have been closed — ignore
    console.warn('[E-Store Background] Failed to update badge:', error);
  }
}

// ─── Keep-Alive Management ───────────────────────────────────────────

/**
 * Start the keep-alive alarm to prevent Chrome from killing the service worker.
 *
 * MV3 service workers are terminated after ~30 seconds of inactivity.
 * During batch processing (scanning 50+ products), we need the worker
 * to stay alive. The alarm fires every 30 seconds, which wakes the worker.
 */
async function startKeepAlive(): Promise<void> {
  await browser.alarms.create(KEEPALIVE_ALARM, {
    periodInMinutes: KEEPALIVE_INTERVAL_MINUTES,
  });
}

/**
 * Stop the keep-alive alarm (when batch processing is complete).
 */
async function stopKeepAlive(): Promise<void> {
  await browser.alarms.clear(KEEPALIVE_ALARM);
}

// ─── Settings Change Broadcast ───────────────────────────────────────

/**
 * Broadcast settings changes to all content script tabs.
 *
 * WHY THIS IS NEEDED:
 * When the user toggles a store off in the popup, the content script
 * on that store's tab needs to know IMMEDIATELY to remove badges.
 * Chrome's storage.onChanged fires in content scripts too, but we
 * also send an explicit message for reliability.
 *
 * @param settings - The new settings object
 */
async function broadcastSettingsChange(settings: unknown): Promise<void> {
  try {
    // Get all tabs that match our store patterns
    const tabs = await browser.tabs.query({
      url: [
        '*://*.metro.ca/*',
        '*://*.superc.ca/*',
        '*://*.walmart.ca/*',
      ],
    });

    // Send a message to each tab's content script
    for (const tab of tabs) {
      if (tab.id) {
        browser.tabs.sendMessage(tab.id, {
          type: 'SETTINGS_CHANGED',
          settings,
        }).catch(() => {
          // Tab might not have a content script loaded yet — ignore
        });
      }
    }

    console.log(`[E-Store Background] Broadcasted settings to ${tabs.length} tabs`);
  } catch (error) {
    console.warn('[E-Store Background] Failed to broadcast settings:', error);
  }
}

// ─── Extension Lifecycle Events ──────────────────────────────────────

/**
 * WXT's defineBackground() registers this as the background service worker.
 * Everything inside this function runs when the service worker starts.
 */
export default defineBackground(() => {
  console.log('[E-Store Background] Service worker started', {
    id: browser.runtime.id,
  });

  // ── On Install / Update ──────────────────────────────────────────

  /**
   * This event fires when:
   *   - The extension is installed for the first time ("install")
   *   - The extension is updated to a new version ("update")
   *   - Chrome itself is updated ("chrome_update")
   *
   * We use this to:
   *   - Log the installation for debugging
   *   - Clean up old cache data after an update
   *   - Set up periodic alarms
   */
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      // First-time installation
      console.log('[E-Store Background] Extension installed for the first time!');

      // No cleanup needed on fresh install — everything is empty

    } else if (details.reason === 'update') {
      // Extension was updated to a new version
      console.log(
        '[E-Store Background] Extension updated from',
        details.previousVersion,
        'to',
        browser.runtime.getManifest().version,
      );

      // After an update, old cached data might be in an outdated format.
      // Purge expired entries to keep things clean.
      purgeExpiredCache().catch(console.error);
    }

    // Set up the periodic cache cleanup alarm (runs on both install & update)
    setupCacheCleanupAlarm();
  });

  // ── Startup Cleanup ──────────────────────────────────────────────

  /**
   * Every time the service worker starts (browser launch, wake from idle),
   * clean up expired cache entries.
   *
   * WHY: Expired items only get deleted when someone reads them (lazy deletion).
   * This proactive cleanup keeps localStorage tidy and within size limits.
   */
  purgeExpiredCache().catch(console.error);

  // ── Alarm Handler ────────────────────────────────────────────────

  /**
   * Handle alarm events for periodic tasks.
   *
   * REGISTERED ALARMS:
   *   - "estore-cache-cleanup" — fires every 6 hours to purge expired cache
   *   - "estore-keepalive"     — fires every 30s during active processing
   */
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CACHE_CLEANUP_ALARM) {
      console.log('[E-Store Background] Periodic cache cleanup triggered');
      purgeExpiredCache().catch(console.error);
    }
    // Keep-alive alarm doesn't need to DO anything — just waking up
    // the service worker is enough to prevent Chrome from killing it
    if (alarm.name === KEEPALIVE_ALARM) {
      console.log('[E-Store Background] Keep-alive ping');
    }
  });

  // ── Settings Change Listener ─────────────────────────────────────

  /**
   * Listen for settings changes in Chrome storage and broadcast them
   * to all content script tabs. This ensures that when the user toggles
   * a store off in the popup, badges are removed immediately.
   */
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['estore_settings']) {
      const newSettings = changes['estore_settings'].newValue;
      if (newSettings) {
        console.log('[E-Store Background] Settings changed, broadcasting to tabs');
        broadcastSettingsChange(newSettings);
      }
    }
  });

  // ── Message Handler ──────────────────────────────────────────────

  /**
   * THE MAIN EVENT HANDLER — processes ALL messages from content scripts and popup.
   *
   * HOW CHROME MESSAGING WORKS:
   *   1. Content script calls: browser.runtime.sendMessage({ type: "LOOKUP_BARCODE", ... })
   *   2. Chrome delivers the message to this listener
   *   3. We process the message and call sendResponse() with the result
   *   4. Chrome delivers the response back to the content script
   *
   * THE "return true" TRICK:
   * Chrome's messaging API is synchronous by default — if you don't respond
   * immediately, the connection closes. But our API calls are async!
   * Returning `true` tells Chrome: "I'll respond later, keep the connection open."
   * This lets us use async/await inside the handler.
   *
   * @param message - The message from the content script or popup
   * @param sender - Info about who sent the message (which tab, etc.)
   * @param sendResponse - Function to call with the response
   * @returns true (keeps the message channel open for async responses)
   */
  browser.runtime.onMessage.addListener(
    (
      message: BackgroundMessage,
      sender: browser.Runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ) => {
      // Log every message for debugging (with the sender tab info)
      console.log('[E-Store Background] Received message:', message.type, {
        tab: sender.tab?.url,
      });

      // Route the message to the appropriate handler based on its type
      // Each handler is an async function that returns a response
      handleMessage(message, sender)
        .then((response) => {
          // Success — send the response back to the content script
          sendResponse(response);
        })
        .catch((error) => {
          // Something went wrong — send an error response
          console.error(
            '[E-Store Background] Error handling message:',
            message.type,
            error,
          );
          sendResponse({ success: false, error: String(error) });
        });

      // IMPORTANT: Return true to keep the message channel open
      // Without this, Chrome would close the connection before our
      // async handler finishes, and the content script would get undefined
      return true;
    },
  );
});

// ─── Alarm Setup ─────────────────────────────────────────────────────

/**
 * Create the periodic cache cleanup alarm.
 *
 * Chrome alarms persist across service worker restarts, so we only
 * need to create this once (on install/update). It fires every 6 hours
 * and triggers purgeExpiredCache().
 */
async function setupCacheCleanupAlarm(): Promise<void> {
  // Check if the alarm already exists (avoid creating duplicates)
  const existing = await browser.alarms.get(CACHE_CLEANUP_ALARM);

  if (!existing) {
    await browser.alarms.create(CACHE_CLEANUP_ALARM, {
      // First fire: 6 hours from now
      delayInMinutes: CACHE_CLEANUP_INTERVAL_MINUTES,
      // Repeat every 6 hours
      periodInMinutes: CACHE_CLEANUP_INTERVAL_MINUTES,
    });

    console.log(
      `[E-Store Background] Cache cleanup alarm set (every ${CACHE_CLEANUP_INTERVAL_MINUTES / 60} hours)`,
    );
  }
}

// ─── Message Router ──────────────────────────────────────────────────

/**
 * Routes a message to the correct handler function.
 *
 * This is like a telephone switchboard:
 *   - "LOOKUP_BARCODE" → connect to handleLookupBarcode()
 *   - "MATCH_PRODUCT"  → connect to handleMatchProduct()
 *   - "GET_SETTINGS"   → connect to handleGetSettings()
 *   - etc.
 *
 * @param message - The incoming message
 * @param sender - Info about who sent the message (tab ID, etc.)
 * @returns The response to send back
 */
async function handleMessage(
  message: BackgroundMessage,
  sender: browser.Runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'LOOKUP_BARCODE':
      return handleLookupBarcode(message.barcode);

    case 'SEARCH_PRODUCT':
      return handleSearchProduct(message.name, message.brand, message.storeSlug);

    case 'MATCH_PRODUCT':
      return handleMatchProduct(message);

    case 'BATCH_LOOKUP':
      return handleBatchLookup(message.barcodes);

    case 'PRODUCTS_PROCESSED':
      return handleProductsProcessed(
        sender.tab?.id,
        message.matchedCount,
        message.totalCount,
      );

    case 'SETTINGS_CHANGED':
      // Popup explicitly sent settings — broadcast to all content scripts
      // (This is a backup; storage.onChanged also triggers broadcast)
      await broadcastSettingsChange(message.settings);
      return { success: true };

    case 'GET_SETTINGS':
      return handleGetSettings();

    case 'GET_CACHE_STATS':
      return handleGetCacheStats();

    case 'CLEAR_CACHE':
      return handleClearCache();

    default:
      // If we get an unknown message type, log it and return an error
      console.warn('[E-Store Background] Unknown message type:', message);
      return { success: false, error: 'Unknown message type' };
  }
}

// ─── Individual Message Handlers ─────────────────────────────────────

/**
 * Handle a barcode lookup request.
 *
 * FLOW: Content script found a barcode → we look it up in OFF → return result
 *
 * DEDUPLICATION: Uses deduplicatedBarcodeLookup() so multiple tabs
 * requesting the same barcode only trigger one API call.
 *
 * @param barcode - The barcode to look up (e.g., "3017620422003")
 * @returns The product data and badge data, or an error
 */
async function handleLookupBarcode(barcode: string): Promise<LookupBarcodeResponse> {
  try {
    // Call the OFF API (deduplicated — won't make duplicate requests)
    const product = await deduplicatedBarcodeLookup(barcode);

    if (product) {
      // Found! Convert the raw product data into badge-ready data
      const badgeData = toBadgeData(product);

      return {
        success: true,
        product,
        badgeData,
      };
    }

    // Product not found in the OFF database
    return {
      success: false,
      error: `Product with barcode ${barcode} not found in Open Food Facts`,
    };

  } catch (error) {
    return {
      success: false,
      error: `Failed to look up barcode: ${String(error)}`,
    };
  }
}

/**
 * Handle a text search request.
 *
 * FLOW: No barcode available → search by product name → return best match
 *
 * @param name - Product name (e.g., "Nutella 750g")
 * @param brand - Brand name if available (e.g., "Ferrero")
 * @param storeSlug - Which store (e.g., "metro")
 * @returns The best matching product, or an error
 */
async function handleSearchProduct(
  name: string,
  brand: string | undefined,
  storeSlug: string,
): Promise<MatchProductResponse> {
  try {
    // Create a minimal ScrapedProductData object for the matcher
    // We need this because matchProduct() expects the full scraped data shape
    const product: ScrapedProductData = {
      element: null as unknown as Element, // Not available in background
      identifier: { type: 'name', value: name, confidence: 0.1 },
      name,
      brand,
    };

    // Use the multi-strategy matcher (it will do text search)
    const match = await matchProduct(product, storeSlug);

    if (match) {
      const badgeData = toBadgeData(match.product);
      return { success: true, match, badgeData };
    }

    return {
      success: false,
      error: `No match found for "${name}"`,
    };

  } catch (error) {
    return {
      success: false,
      error: `Search failed: ${String(error)}`,
    };
  }
}

/**
 * Handle a full product match request.
 *
 * This is the MOST COMMON message. The content script sends all scraped
 * data and lets the background worker figure out the best strategy.
 *
 * FLOW:
 *   1. Content script scrapes product data from the grocery page
 *   2. Sends it here via MATCH_PRODUCT message
 *   3. We run the multi-strategy matcher (barcode → cache → text search)
 *   4. If matched, we convert to badge data and send it back
 *   5. Content script renders the badges
 *
 * KEEP-ALIVE: Starts a keep-alive alarm to prevent Chrome from killing
 * the worker during potentially long matching operations.
 *
 * @param message - The match product message with identifier, name, brand
 * @returns The match result with badge data, or an error
 */
async function handleMatchProduct(
  message: {
    identifier: { type: 'barcode' | 'sku' | 'name'; value: string; confidence: number } | null;
    name: string;
    brand?: string;
    storeSlug: string;
  },
): Promise<MatchProductResponse> {
  try {
    // Keep the service worker alive during matching
    await startKeepAlive();

    // Build the ScrapedProductData that the matcher expects
    const product: ScrapedProductData = {
      element: null as unknown as Element, // Not available in background context
      identifier: message.identifier as ProductIdentifier | null,
      name: message.name,
      brand: message.brand,
    };

    // Run the multi-strategy matcher
    // This tries: barcode lookup → cache → text search
    const match = await matchProduct(product, message.storeSlug);

    if (match) {
      // Convert the raw OFF product data into badge-ready rendering data
      const badgeData = toBadgeData(match.product);

      return {
        success: true,
        match,
        badgeData,
      };
    }

    // No match found with any strategy
    return {
      success: false,
      error: `No match found for "${message.name}"`,
    };

  } catch (error) {
    return {
      success: false,
      error: `Match failed: ${String(error)}`,
    };
  } finally {
    // Stop keep-alive once this match request completes
    // (If other matches are still in-flight, content script will
    // send another MATCH_PRODUCT which restarts keep-alive)
    await stopKeepAlive();
  }
}

/**
 * Handle a batch barcode lookup request.
 *
 * Looks up multiple barcodes at once, using deduplication to avoid
 * making duplicate API calls.
 *
 * @param barcodes - Array of barcodes to look up
 * @returns Map of barcode → product + badge data for found products
 */
async function handleBatchLookup(barcodes: string[]): Promise<BatchLookupResponse> {
  try {
    // Keep the service worker alive during batch processing
    await startKeepAlive();

    const results: Record<string, { product: OFFProduct; badgeData: ReturnType<typeof toBadgeData> }> = {};

    // Look up all barcodes in parallel (deduplicated)
    await Promise.allSettled(
      barcodes.map(async (barcode) => {
        const product = await deduplicatedBarcodeLookup(barcode);
        if (product) {
          results[barcode] = {
            product,
            badgeData: toBadgeData(product),
          };
        }
      }),
    );

    return { success: true, results };

  } catch (error) {
    return {
      success: false,
      error: `Batch lookup failed: ${String(error)}`,
    };
  } finally {
    await stopKeepAlive();
  }
}

/**
 * Handle a products processed notification from a content script.
 *
 * Updates the extension badge icon for the tab that sent the message.
 *
 * @param tabId - The tab that finished processing
 * @param matchedCount - How many products were matched
 * @param totalCount - Total products found on the page
 */
async function handleProductsProcessed(
  tabId: number | undefined,
  matchedCount: number,
  totalCount: number,
): Promise<ProductsProcessedResponse> {
  if (tabId) {
    await updateBadgeForTab(tabId, matchedCount, totalCount);
  }
  return { success: true };
}

/**
 * Handle a settings request.
 *
 * FLOW: Content script or popup wants the current settings → load and return them
 */
async function handleGetSettings(): Promise<GetSettingsResponse> {
  try {
    const settings = await loadSettings();
    return { success: true, settings };
  } catch (error) {
    return {
      success: false,
      error: `Failed to load settings: ${String(error)}`,
    };
  }
}

/**
 * Handle a cache stats request.
 *
 * FLOW: Popup wants to display cache info → gather stats and return them
 */
async function handleGetCacheStats(): Promise<CacheStatsResponse> {
  try {
    const stats = await getCacheStats();
    return { success: true, stats };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get cache stats: ${String(error)}`,
    };
  }
}

/**
 * Handle a clear cache request.
 *
 * FLOW: User clicks "Clear Cache" in popup → delete all cached data
 */
async function handleClearCache(): Promise<ClearCacheResponse> {
  try {
    await clearAllCache();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to clear cache: ${String(error)}`,
    };
  }
}
