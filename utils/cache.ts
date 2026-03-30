/**
 * ============================================================================
 * Cache Utility — Local Storage Caching with Automatic Expiry
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * Caches data in the browser's localStorage so we don't have to call the
 * OFF API every time the user visits the same grocery store page.
 *
 * REAL-WORLD ANALOGY:
 * Imagine you look up a phone number in a phone book (the OFF API).
 * Instead of looking it up again next time, you write it on a sticky note
 * (the cache). The sticky note has a date — after 7 days, you throw it away
 * and look up the phone number again (in case it changed).
 *
 * WHY WE NEED CACHING:
 *   1. SPEED — localStorage is instant, API calls take 200-2000ms
 *   2. OFFLINE — Cached data works even without internet
 *   3. RATE LIMITS — Reduces the number of requests to the OFF server
 *   4. BETTER UX — Products show badges instantly on revisit
 *
 * HOW IT WORKS:
 *   - Every cached item has a TTL (Time To Live) — how long it stays valid
 *   - Default TTL is 7 days (product data doesn't change often)
 *   - When you read a cached item, we check if it's expired
 *   - Expired items are automatically deleted
 *   - All our cache keys start with "estore_" to avoid conflicts
 *
 * STORAGE LIMITS:
 *   - localStorage has a ~5MB limit per origin
 *   - Each cached product is roughly 1-3KB
 *   - So we can cache about 2000-5000 products — more than enough
 *
 * FUTURE UPGRADE:
 *   In a future phase, this could be upgraded to IndexedDB for:
 *   - More storage (~50MB+)
 *   - Better performance for large datasets
 *   - Structured queries
 *   But localStorage is simpler and good enough for now.
 * ============================================================================
 */

// ─── Configuration ───────────────────────────────────────────────────

/**
 * Prefix added to all cache keys in localStorage.
 *
 * WHY: localStorage is shared by ALL scripts on a page. If another
 * extension or script uses a key called "barcode:123", it would conflict
 * with ours. The prefix "estore_" makes our keys unique:
 *   "estore_barcode:123" — definitely ours
 *   "barcode:123" — could be anyone's
 */
const CACHE_PREFIX = 'estore_';

/**
 * Default time-to-live for cached items: 7 days in milliseconds.
 *
 * MATH: 7 days × 24 hours × 60 minutes × 60 seconds × 1000 milliseconds
 *
 * WHY 7 DAYS?
 *   - Product data (Nutri-Score, NOVA, etc.) rarely changes
 *   - 7 days is a good balance between freshness and cache efficiency
 *   - After 7 days, the data is re-fetched from the OFF API
 */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 604,800,000 ms

/**
 * Short TTL for search results: 1 day in milliseconds.
 *
 * WHY SHORTER?
 *   - Text search results depend on the OFF database content
 *   - New products are added to OFF daily by the community
 *   - A product that wasn't found today might be found tomorrow
 */
export const SEARCH_TTL_MS = 1 * 24 * 60 * 60 * 1000; // 86,400,000 ms

/**
 * Very short TTL for "not found" results: 4 hours in milliseconds.
 *
 * WHY EVEN SHORTER?
 *   - If a product wasn't found in OFF, we cache that fact briefly
 *   - This prevents hammering the API for unpopular products
 *   - But 4 hours is short enough that if someone adds the product
 *     to OFF, the user will see it fairly soon
 */
export const NOT_FOUND_TTL_MS = 4 * 60 * 60 * 1000; // 14,400,000 ms

// ─── Internal Types ──────────────────────────────────────────────────

/**
 * The structure of a cached item in localStorage.
 *
 * Every cached value is wrapped in this envelope which adds:
 *   - timestamp: when the item was saved
 *   - ttl: how long the item stays valid
 *
 * The generic type T means "data can be anything" — a product object,
 * a match result, a string, etc. TypeScript will enforce the correct
 * type when you read it back.
 *
 * EXAMPLE in localStorage:
 * Key:   "estore_barcode:3017620422003"
 * Value: '{"data": {"code":"3017620422003","nutriscore_grade":"e",...}, "timestamp": 1709900000000, "ttl": 604800000}'
 */
interface CacheEntry<T> {
    /** The actual data being cached (could be any type) */
    data: T;

    /** Unix timestamp (milliseconds) when this entry was saved */
    timestamp: number;

    /** How long this entry stays valid, in milliseconds */
    ttl: number;
}

// ─── Core Cache Functions ────────────────────────────────────────────

/**
 * Get a cached value by its key.
 */
export async function getCache<T>(key: string): Promise<T | null> {
    try {
        const fullKey = `${CACHE_PREFIX}${key}`;
        const result = await browser.storage.local.get(fullKey);
        const entry = result[fullKey] as CacheEntry<T> | undefined;

        if (!entry) return null;

        const age = Date.now() - entry.timestamp;

        if (age > entry.ttl) {
            await browser.storage.local.remove(fullKey);
            return null;
        }

        return entry.data;
    } catch {
        return null;
    }
}

/**
 * Save a value to the cache with an optional TTL (time-to-live).
 */
export async function setCache<T>(
    key: string,
    data: T,
    ttl: number = DEFAULT_TTL_MS,
): Promise<void> {
    try {
        const entry: CacheEntry<T> = {
            data,
            timestamp: Date.now(),
            ttl,
        };

        const fullKey = `${CACHE_PREFIX}${key}`;
        await browser.storage.local.set({ [fullKey]: entry });

    } catch (error) {
        console.warn('[E-Store] Failed to save to cache:', error);
    }
}

/**
 * Check if a cache key exists and is still valid (not expired).
 */
export async function hasCache(key: string): Promise<boolean> {
    return (await getCache<unknown>(key)) !== null;
}

/**
 * Delete a specific cached item.
 *
 * Use this when you know a cached item is stale and should be re-fetched.
 *
 * @param key - The cache key to delete
 *
 * @example
 *   // User manually refreshed a product — clear its cache
 *   removeCache("barcode:3017620422003");
 */
export async function removeCache(key: string): Promise<void> {
    const fullKey = `${CACHE_PREFIX}${key}`;
    await browser.storage.local.remove(fullKey);
}

/**
 * Clear ALL extension cache entries from storage.
 *
 * This only deletes keys that start with "estore_" — leaving
 * other scripts' data untouched.
 *
 * USE CASES:
 *   - User clicks "Clear Cache" in the extension settings
 *   - Extension is updated to a new version (old cache format might not work)
 *   - Debugging — start fresh
 *
 * @example
 *   // In the popup settings UI:
 *   clearAllCache();
 *   console.log("All cached data cleared!");
 */
export async function clearAllCache(): Promise<void> {
    try {
        const allItems = await browser.storage.local.get(null);
        const allKeys = Object.keys(allItems);
        
        // Find keys that belong to our app
        const ourKeys = allKeys.filter((k: string) => k.startsWith(CACHE_PREFIX));

        if (ourKeys.length > 0) {
            await browser.storage.local.remove(ourKeys);
            console.log(`[E-Store] Cleared ${ourKeys.length} cached items`);
        } else {
            console.log('[E-Store] No cache items to clear.');
        }
    } catch (error) {
        console.warn('[E-Store] Failed to clear cache:', error);
    }
}

/**
 * Get statistics about the current cache contents.
 *
 * Useful for:
 *   - Showing cache info in the extension popup
 *   - Debugging — understanding what's cached
 *   - Monitoring — tracking cache size over time
 *
 * @returns Object with cache statistics
 *
 * @example
 *   const stats = getCacheStats();
 *   console.log(`${stats.totalEntries} items cached, using ${stats.totalSizeKB}KB`);
 *   // "127 items cached, using 342KB"
 */
export async function getCacheStats(): Promise<{
    totalEntries: number;
    totalSizeKB: number;
    expiredEntries: number;
    categoryCounts: Record<string, number>;
}> {
    const allItems = await browser.storage.local.get(null);
    const allKeys = Object.keys(allItems);
    const ourKeys = allKeys.filter((key) => key.startsWith(CACHE_PREFIX));

    let totalSize = 0;         // Estimated bytes of cached data
    let expiredCount = 0;      // How many entries have expired
    const categories: Record<string, number> = {}; // Count by category

    for (const fullKey of ourKeys) {
        const entry = allItems[fullKey] as CacheEntry<unknown> | undefined;
        if (!entry) continue;

        // Estimate size based on JSON representation
        const sizeEstimation = JSON.stringify(entry).length;
        totalSize += fullKey.length + sizeEstimation;

        if (entry.timestamp && entry.ttl) {
            if (Date.now() - entry.timestamp > entry.ttl) {
                expiredCount++;
            }
        }

        const keyWithoutPrefix = fullKey.slice(CACHE_PREFIX.length);
        const category = keyWithoutPrefix.split(':')[0] || 'unknown';
        categories[category] = (categories[category] || 0) + 1;
    }

    return {
        totalEntries: ourKeys.length,
        totalSizeKB: Math.round((totalSize * 2) / 1024),
        expiredEntries: expiredCount,
        categoryCounts: categories,
    };
}

/**
 * Remove all expired entries from the cache.
 *
 * WHY THIS IS NEEDED:
 * Expired items aren't automatically deleted — they only get deleted
 * when someone tries to READ them (in getCache). This means unused
 * expired items sit around forever, wasting space.
 *
 * This "garbage collection" function cleans them up.
 *
 * WHEN TO CALL:
 *   - On extension startup (in the background service worker)
 *   - Periodically (e.g., once a day)
 *   - When the user opens the popup
 */
export async function purgeExpiredCache(): Promise<number> {
    const allItems = await browser.storage.local.get(null);
    const allKeys = Object.keys(allItems);
    const ourKeys = allKeys.filter((key) => key.startsWith(CACHE_PREFIX));
    let purgedCount = 0;

    for (const fullKey of ourKeys) {
        try {
            const entry = allItems[fullKey] as CacheEntry<unknown> | undefined;
            if (!entry) continue;

            if (entry.timestamp && entry.ttl) {
                if (Date.now() - entry.timestamp > entry.ttl) {
                    await browser.storage.local.remove(fullKey);
                    purgedCount++;
                }
            } else {
                 // Corrupted entry — remove it
                 await browser.storage.local.remove(fullKey);
                 purgedCount++;
            }
        } catch {
            // Guard against errors during removal
            await browser.storage.local.remove(fullKey);
            purgedCount++;
        }
    }

    if (purgedCount > 0) {
        console.log(`[E-Store] Purged ${purgedCount} expired cache entries`);
    }

    return purgedCount;
}
