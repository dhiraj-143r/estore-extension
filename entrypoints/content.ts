/**
 * ============================================================================
 * Content Script — The Extension's Eyes on the Grocery Store Page
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * This script runs INSIDE the grocery store's web page (metro.ca, superc.ca,
 * walmart.ca). It's like a spy that:
 *   1. DETECTS which store the user is on
 *   2. FINDS all product cards on the page
 *   3. ASKS the background worker to look up each product
 *   4. INJECTS nutrition badges next to each product
 *   5. WATCHES for new products (infinite scroll, page navigation)
 *   6. REPORTS matched product counts to background (for badge icon)
 *   7. LISTENS for settings changes (instant badge removal when store disabled)
 *
 * WHEN DOES IT RUN?
 * Chrome injects this script automatically whenever the user visits a URL
 * that matches one of our patterns (defined in the "matches" array below):
 *   - *://*.metro.ca/*   → Any page on metro.ca
 *   - *://*.superc.ca/*  → Any page on superc.ca
 *   - *://*.walmart.ca/* → Any page on walmart.ca
 *
 * LIFECYCLE:
 *   1. User opens metro.ca
 *   2. Chrome sees the URL matches our pattern
 *   3. Chrome injects this content script into the page
 *   4. main() function runs
 *   5. We find products, look them up, and add badges
 *   6. We start watching for new products (infinite scroll)
 *   7. We report counts to background for badge icon
 *   8. We listen for settings changes (real-time enable/disable)
 *
 * ISOLATION:
 * Content scripts run in an "isolated world" — we can see and modify
 * the page's DOM, but we can NOT access the page's JavaScript variables
 * or functions. And the page can NOT access ours. This is a security feature.
 * ============================================================================
 */

import { getAdapterForUrl } from '@/adapters';
import { sendToBackground } from '@/types/messages';
import type { MatchProductResponse } from '@/types/messages';
import type { StoreAdapter, ScrapedProductData } from '@/types';
import { createBadgeContainer } from '@/components/badges';
import './badges.css';

// ─── Module-Level State ──────────────────────────────────────────────

/**
 * Track matched/total product counts for badge icon reporting.
 * These are updated as products are processed and reported to
 * the background worker via PRODUCTS_PROCESSED messages.
 */
let matchedProductCount = 0;
let totalProductCount = 0;

/**
 * Cleanup functions for observers and listeners.
 * Stored so they can be called when settings change or the page unloads.
 */
let navigationCleanup: (() => void) | null = null;

/**
 * WXT's defineContentScript() registers this as a content script.
 *
 * - "matches" tells Chrome WHICH websites to inject this script into
 * - "main()" is the entry point — runs when the script is injected
 * - "runAt" controls WHEN the script runs relative to page loading:
 *     "document_idle" = after the page has finished loading (safest)
 */
export default defineContentScript({
  matches: [
    '*://*.metro.ca/*',      // Metro grocery store
    '*://*.superc.ca/*',     // SuperC grocery store
    '*://*.walmart.ca/*',    // Walmart Canada
  ],
  runAt: 'document_idle',    // Wait for the page to finish loading

  /**
   * THE MAIN ENTRY POINT — runs when the content script is injected.
   *
   * This function orchestrates the entire content script lifecycle:
   *   1. Check if we should run (extension enabled? store enabled?)
   *   2. Find the right adapter for this store
   *   3. Scan the page for products
   *   4. Look up each product and add badges
   *   5. Start watching for new products
   *   6. Listen for settings changes from the background
   */
  async main() {
    console.log('[E-Store Content] Content script loaded on:', window.location.href);

    // ── Step 1: Check if the extension is enabled ──────────────────

    /**
     * Read settings DIRECTLY from chrome.storage — no background round-trip.
     *
     * WHY: Content scripts can access chrome.storage directly, so there is
     * NO need to ask the background worker for settings. Doing so caused a
     * silent hang whenever the MV3 service worker was terminated (which Chrome
     * does aggressively after ~30 seconds of inactivity).
     */
    let extensionEnabled = true;
    let badgeSettings: Record<string, boolean> = {};
    let storeSettings: Record<string, { enabled: boolean }> = {};

    try {
      const stored = await browser.storage.local.get('estore_settings');
      const settings = stored['estore_settings'] as {
        enabled?: boolean;
        stores?: Record<string, { enabled: boolean }>;
        badges?: Record<string, boolean>;
      } | undefined;

      console.log('[E-Store Content] Loaded settings from storage:', settings);

      if (settings) {
        extensionEnabled = settings.enabled ?? true;
        storeSettings   = settings.stores  ?? {};
        badgeSettings   = settings.badges  ?? {};
      } else {
        console.log('[E-Store Content] No saved settings, using defaults (all enabled).');
      }
    } catch (err) {
      console.warn('[E-Store Content] Failed to read storage, using defaults:', err);
    }

    // If the extension is globally disabled, stop immediately
    if (!extensionEnabled) {
      console.log('[E-Store Content] Extension is disabled, not scanning.');
      return;
    }

    // ── Step 2: Find the right adapter for this store ──────────────

    /**
     * Each store has its own adapter with store-specific CSS selectors
     * and scraping logic. We find the right one based on the current URL.
     */
    const adapter = getAdapterForUrl(window.location.href);

    if (!adapter) {
      // This shouldn't happen because Chrome only injects us on matching URLs,
      // but it's a safety check
      console.warn('[E-Store Content] No adapter found for:', window.location.hostname);
      return;
    }

    console.log(`[E-Store Content] Using adapter: ${adapter.config.name}`);

    // Check if this specific store is enabled by the user
    const storeSlug = adapter.config.slug;
    const storeEnabled = storeSettings[storeSlug]?.enabled ?? true;

    if (!storeEnabled) {
      console.log(`[E-Store Content] Store "${adapter.config.name}" is disabled by user.`);
      return;
    }

    console.log(`[E-Store Content] Store "${adapter.config.name}" is enabled, proceeding...`);

    // ── Step 3: Detect page type ───────────────────────────────────

    /**
     * Figure out what kind of page we're on (listing, detail, search, cart).
     * Different page types might need different scraping strategies.
     */
    const pageType = adapter.detectPageType(window.location.href, document);
    console.log(`[E-Store Content] Page type: ${pageType}`);

    // ── Step 4: Initial scan — find and process products ───────────

    /**
     * Scan the page for product cards and start matching them.
     * This is the main work of the content script.
     */
    await scanAndBadgeProducts(adapter, storeSlug);

    // ── Step 5: Watch for dynamic content ──────────────────────────

    /**
     * Many grocery sites use "infinite scroll" — as the user scrolls down,
     * new products appear dynamically. We need to detect these new products
     * and badge them too.
     *
     * We also watch for SPA navigation (URL changes without page reload),
     * which triggers a full re-scan.
     */
    setupDynamicContentObserver(adapter, storeSlug);
    setupNavigationObserver(adapter, storeSlug);

    // ── Step 6: Listen for settings changes from background ────────

    /**
     * When the user toggles a store off in the popup, the background
     * broadcasts SETTINGS_CHANGED to all content scripts. We listen
     * for this to remove badges immediately.
     */
    setupSettingsChangeListener(adapter, storeSlug);

    console.log('[E-Store Content] Setup complete — watching for products.');
  },
});

// ─── Product Scanning ────────────────────────────────────────────────

/**
 * Scan the page for products and add nutrition badges.
 *
 * This is the "workhorse" function that does the actual product processing:
 *   1. Use the adapter to find all product cards on the page
 *   2. Filter out products that already have badges (avoid duplicates)
 *   3. For each product, send a MATCH_PRODUCT message to the background
 *   4. If a match is found, mark the card as "badged"
 *   5. Report final counts to background for badge icon update
 *
 * @param adapter - The store adapter for the current page
 * @param storeSlug - The store identifier (e.g., "metro")
 */
async function scanAndBadgeProducts(
  adapter: StoreAdapter,
  storeSlug: string,
): Promise<void> {
  // Step 1: Find all product cards on the page
  const products = adapter.scrapeProducts(document.body);
  console.log(`[E-Store Content] Found ${products.length} products on page`);

  // If no products found, nothing to do
  if (products.length === 0) return;

  // Step 2: Filter out products that already have badges
  // (This prevents duplicate badges when the observer re-scans)
  const newProducts = products.filter((p) => !adapter.hasBadges(p.element));
  console.log(`[E-Store Content] ${newProducts.length} new products to process`);

  if (newProducts.length === 0) return;

  // Step 3: Process products in batches of 5 (matching off-client's MAX_CONCURRENT_REQUESTS)
  // Firing all 29 at once causes Chrome message channels to time out for the queued ones
  const BATCH_SIZE = 5;
  let matchedInBatch = 0;

  for (let i = 0; i < newProducts.length; i += BATCH_SIZE) {
    const batch = newProducts.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((product) => processProduct(product, adapter, storeSlug)),
    );
    matchedInBatch += results.filter(
      (r) => r.status === 'fulfilled' && r.value === true,
    ).length;
    console.log(`[E-Store Content] Batch ${Math.floor(i / BATCH_SIZE) + 1}: processed ${batch.length} products`);
  }

  // Update running totals
  totalProductCount += newProducts.length;
  matchedProductCount += matchedInBatch;

  console.log(`[E-Store Content] Batch complete: ${matchedInBatch}/${newProducts.length} matched, overall: ${matchedProductCount}/${totalProductCount}`);

  // Step 5: Report counts to background for badge icon
  reportProductCounts();
}

/**
 * Report matched/total product counts to the background worker.
 *
 * The background uses these counts to update the extension icon badge
 * (e.g., showing "12" on the icon when 12 products are matched).
 */
function reportProductCounts(): void {
  sendToBackground({
    type: 'PRODUCTS_PROCESSED',
    matchedCount: matchedProductCount,
    totalCount: totalProductCount,
  }).catch((error) => {
    console.warn('[E-Store Content] Failed to report product counts:', error);
  });
}

/**
 * Process a single product — match it and add badges.
 *
 * FLOW:
 *   1. Send the scraped product data to the background worker
 *   2. Background worker runs the multi-strategy matcher
 *   3. If matched, we get back BadgeData (Nutri-Score, NOVA, etc.)
 *   4. We inject the badge HTML into the product card
 *
 * @param product - The scraped product data (from the adapter)
 * @param adapter - The store adapter (needed for getInjectionPoint)
 * @param storeSlug - The store identifier
 * @returns true if the product was matched, false otherwise
 */
async function processProduct(
  product: ScrapedProductData,
  adapter: StoreAdapter,
  storeSlug: string,
): Promise<boolean> {
  try {
    // Send the product data to the background worker for matching
    const response = await sendToBackground<MatchProductResponse>({
      type: 'MATCH_PRODUCT',
      identifier: product.identifier,
      name: product.name,
      brand: product.brand,
      storeSlug,
    });

    console.log(
      `[E-Store Content] Product "${product.name?.substring(0, 30)}" →`,
      response.success ? `MATCHED (${response.match?.matchMethod})` : `no match: ${response.error}`,
    );

    if (response.success && response.badgeData) {
      // Match found! Inject badges into the product card
      injectBadges(product.element, adapter, response.badgeData, response.match?.confidence ?? 0);
      return true;
    } else {
      // No match — mark the card so we don't try again
      markAsBadged(product.element);
      return false;
    }

  } catch (error) {
    console.warn(
      `[E-Store Content] Failed to process product "${product.name}":`,
      error,
    );
    return false;
  }
}

// ─── Badge Injection ─────────────────────────────────────────────────

/**
 * Inject nutrition badges into a product card's DOM.
 *
 * This creates the visual badge overlay that the user sees:
 *   🟢 Nutri-Score: A    🔵 NOVA: 1    🌿 Eco-Score: B
 *
 * NOTE: This is a simplified placeholder implementation.
 * In a later phase (Badge UI System), this will be replaced with
 * proper Vue components with animations and styling.
 *
 * @param cardElement - The product card DOM element
 * @param adapter - The store adapter (to find the injection point)
 * @param badgeData - The pre-computed badge data to display
 * @param confidence - How confident we are in this match (0-1)
 */
function injectBadges(
  cardElement: Element,
  adapter: StoreAdapter,
  badgeData: import('@/types').BadgeData,
  confidence: number,
): void {
  // Find the spot in the product card where we should inject badges
  let injectionPoint = adapter.getInjectionPoint(cardElement);

  // Fallback: if no specific injection point found, append directly to the card
  if (!injectionPoint) {
    console.warn('[E-Store Content] No specific injection point — appending to card directly');
    injectionPoint = cardElement as Element;
  }

  // Use the badge renderer to create a styled badge container
  const container = createBadgeContainer(badgeData, confidence);

  // Insert the badges into the product card
  injectionPoint.appendChild(container);

  // Mark this card as "badged" so we don't add duplicate badges
  markAsBadged(cardElement);
}

/**
 * Mark a product card as having been processed (badges added or skipped).
 *
 * We add a data attribute to the card element so that on future scans
 * (from MutationObserver), we know not to process it again.
 *
 * @param element - The product card element to mark
 */
function markAsBadged(element: Element): void {
  element.setAttribute('data-estore-badge', 'true');
}

/**
 * Remove ALL badges from the page.
 *
 * Called when the user disables the extension or this store via settings.
 * Removes badge containers and clears the "badged" marker from all cards.
 */
function removeAllBadges(): void {
  // Remove all badge containers
  const containers = document.querySelectorAll('.estore-badge-container');
  containers.forEach((c) => c.remove());

  // Remove the marker from all cards so badges can be re-added later
  const marked = document.querySelectorAll('[data-estore-badge]');
  marked.forEach((el) => el.removeAttribute('data-estore-badge'));

  // Reset counts
  matchedProductCount = 0;
  totalProductCount = 0;

  // Report zero to background (clears the badge icon)
  reportProductCounts();

  console.log(`[E-Store Content] Removed ${containers.length} badge containers`);
}

// ─── Dynamic Content Observers ───────────────────────────────────────

/**
 * Set up a MutationObserver to detect new products added dynamically.
 *
 * WHAT THIS HANDLES:
 *   - Infinite scroll (user scrolls down, new products load)
 *   - Lazy loading (product details load after the initial page)
 *   - AJAX updates (page content changes without a full reload)
 *
 * HOW IT WORKS:
 *   - We tell the browser: "Watch the product list for changes"
 *   - When new elements are added, the observer fires our callback
 *   - We re-scan the page and badge any new products
 *
 * DEBOUNCING:
 * When lots of products load at once (infinite scroll), the observer
 * fires many times in quick succession. We use a debounce timer
 * to wait until the loading settles down before re-scanning.
 *
 * @param adapter - The store adapter
 * @param storeSlug - The store identifier
 */
function setupDynamicContentObserver(
  adapter: StoreAdapter,
  storeSlug: string,
): void {
  // Debounce timer — prevents scanning too frequently
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // How long to wait after the last DOM change before scanning (in ms)
  const DEBOUNCE_DELAY = 500; // Half a second

  // The adapter sets up the MutationObserver on the right container
  adapter.observeDynamicContent(() => {
    // Clear any existing timer (reset the debounce)
    if (debounceTimer) clearTimeout(debounceTimer);

    // Wait for the DOM to settle, then scan for new products
    debounceTimer = setTimeout(async () => {
      console.log('[E-Store Content] New content detected, scanning...');
      await scanAndBadgeProducts(adapter, storeSlug);
    }, DEBOUNCE_DELAY);
  });

  console.log('[E-Store Content] Dynamic content observer active');
}

/**
 * Set up a listener for SPA navigation (URL changes without page reload).
 *
 * WHAT THIS HANDLES:
 *   - Walmart's SPA routing (clicking categories loads new content)
 *   - Metro's AJAX page transitions
 *   - Any URL change that doesn't trigger a full page reload
 *
 * WHY THIS IS NEEDED:
 * When a normal page reload happens, Chrome re-injects our content script.
 * But SPA navigation doesn't trigger a reload — the URL changes but
 * our content script stays alive, so we need to manually re-scan.
 *
 * @param adapter - The store adapter
 * @param storeSlug - The store identifier
 */
function setupNavigationObserver(
  adapter: StoreAdapter,
  storeSlug: string,
): void {
  navigationCleanup = adapter.observeNavigation(async (newUrl) => {
    console.log('[E-Store Content] SPA navigation detected:', newUrl);

    // Reset product counts for the new page
    matchedProductCount = 0;
    totalProductCount = 0;

    // Small delay to let the new page content load
    setTimeout(async () => {
      await scanAndBadgeProducts(adapter, storeSlug);
    }, 1000); // Wait 1 second for the new content to render
  });

  console.log('[E-Store Content] Navigation observer active');
}

// ─── Settings Change Listener ────────────────────────────────────────

/**
 * Listen for settings change broadcasts from the background worker.
 *
 * WHEN THIS FIRES:
 * The background worker broadcasts a SETTINGS_CHANGED message when the
 * user changes settings in the popup (e.g., disabling a store).
 *
 * WHAT WE DO:
 *   - If the extension is globally disabled → remove all badges
 *   - If THIS store is disabled → remove all badges
 *   - If THIS store is re-enabled → re-scan and add badges
 *
 * @param adapter - The store adapter
 * @param storeSlug - The store identifier
 */
function setupSettingsChangeListener(
  adapter: StoreAdapter,
  storeSlug: string,
): void {
  browser.runtime.onMessage.addListener(
    (message: { type: string; settings?: { enabled: boolean; stores: Record<string, { enabled: boolean }> } }) => {
      if (message.type !== 'SETTINGS_CHANGED') return;

      const settings = message.settings;
      if (!settings) return;

      // Check if extension is globally disabled
      if (!settings.enabled) {
        console.log('[E-Store Content] Extension disabled via settings, removing badges');
        removeAllBadges();
        return;
      }

      // Check if THIS store is disabled
      const storeEnabled = settings.stores[storeSlug]?.enabled ?? true;

      if (!storeEnabled) {
        console.log(`[E-Store Content] Store "${adapter.config.name}" disabled, removing badges`);
        removeAllBadges();
      } else {
        // Store was re-enabled — re-scan and add badges
        console.log(`[E-Store Content] Store "${adapter.config.name}" re-enabled, scanning`);
        scanAndBadgeProducts(adapter, storeSlug);
      }
    },
  );

  console.log('[E-Store Content] Settings change listener active');
}
