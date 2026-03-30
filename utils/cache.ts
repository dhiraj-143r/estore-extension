const CACHE_PREFIX = 'estore_';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SEARCH_TTL_MS = 1 * 24 * 60 * 60 * 1000;
export const NOT_FOUND_TTL_MS = 4 * 60 * 60 * 1000;

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
}

/** Retrieve a cached value. Returns null if expired or missing. */
export async function getCache<T>(key: string): Promise<T | null> {
    try {
        const fullKey = `${CACHE_PREFIX}${key}`;
        const result = await browser.storage.local.get(fullKey);
        const entry = result[fullKey] as CacheEntry<T> | undefined;

        if (!entry) return null;

        if (Date.now() - entry.timestamp > entry.ttl) {
            await browser.storage.local.remove(fullKey);
            return null;
        }

        return entry.data;
    } catch {
        return null;
    }
}

/** Store a value in the cache with an optional TTL. */
export async function setCache<T>(
    key: string,
    data: T,
    ttl: number = DEFAULT_TTL_MS,
): Promise<void> {
    try {
        const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttl };
        const fullKey = `${CACHE_PREFIX}${key}`;
        await browser.storage.local.set({ [fullKey]: entry });
    } catch (error) {
        console.warn('[E-Store] Cache write failed:', error);
    }
}

/** Check whether a cache key exists and has not expired. */
export async function hasCache(key: string): Promise<boolean> {
    return (await getCache<unknown>(key)) !== null;
}

/** Remove a single cached entry. */
export async function removeCache(key: string): Promise<void> {
    const fullKey = `${CACHE_PREFIX}${key}`;
    await browser.storage.local.remove(fullKey);
}

/** Remove all extension cache entries from storage. */
export async function clearAllCache(): Promise<void> {
    try {
        const allItems = await browser.storage.local.get(null);
        const ourKeys = Object.keys(allItems).filter((k) => k.startsWith(CACHE_PREFIX));

        if (ourKeys.length > 0) {
            await browser.storage.local.remove(ourKeys);
        }
    } catch (error) {
        console.warn('[E-Store] Failed to clear cache:', error);
    }
}

/** Gather statistics about the current cache contents. */
export async function getCacheStats(): Promise<{
    totalEntries: number;
    totalSizeKB: number;
    expiredEntries: number;
    categoryCounts: Record<string, number>;
}> {
    const allItems = await browser.storage.local.get(null);
    const ourKeys = Object.keys(allItems).filter((key) => key.startsWith(CACHE_PREFIX));

    let totalSize = 0;
    let expiredCount = 0;
    const categories: Record<string, number> = {};

    for (const fullKey of ourKeys) {
        const entry = allItems[fullKey] as CacheEntry<unknown> | undefined;
        if (!entry) continue;

        totalSize += fullKey.length + JSON.stringify(entry).length;

        if (entry.timestamp && entry.ttl) {
            if (Date.now() - entry.timestamp > entry.ttl) {
                expiredCount++;
            }
        }

        const category = fullKey.slice(CACHE_PREFIX.length).split(':')[0] || 'unknown';
        categories[category] = (categories[category] || 0) + 1;
    }

    return {
        totalEntries: ourKeys.length,
        totalSizeKB: Math.round((totalSize * 2) / 1024),
        expiredEntries: expiredCount,
        categoryCounts: categories,
    };
}

/** Remove all expired entries from the cache. */
export async function purgeExpiredCache(): Promise<number> {
    const allItems = await browser.storage.local.get(null);
    const ourKeys = Object.keys(allItems).filter((key) => key.startsWith(CACHE_PREFIX));
    let purgedCount = 0;

    for (const fullKey of ourKeys) {
        try {
            const entry = allItems[fullKey] as CacheEntry<unknown> | undefined;
            if (!entry) continue;

            const isExpired = entry.timestamp && entry.ttl
                ? Date.now() - entry.timestamp > entry.ttl
                : true;

            if (isExpired) {
                await browser.storage.local.remove(fullKey);
                purgedCount++;
            }
        } catch {
            await browser.storage.local.remove(fullKey);
            purgedCount++;
        }
    }

    return purgedCount;
}
