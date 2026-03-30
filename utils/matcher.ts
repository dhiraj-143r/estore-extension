/**
 * ============================================================================
 * Product Matcher — Multi-Strategy Matching Engine
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * This is the "brain" that figures out WHICH product in the OFF database
 * corresponds to a product on the grocery store's website. This is the
 * HARDEST problem in the entire extension (and why Nutribanner was paused).
 *
 * THE PROBLEM:
 * When you see "Nutella 750g" on metro.ca, we need to find the same product
 * in the OFF database. But there's no guaranteed way to connect them because:
 *   - Metro uses internal product codes (like "226690"), NOT standard barcodes
 *   - The product name on Metro might differ from the name in OFF
 *   - The same product might have different names in English and French
 *
 * THE SOLUTION — MULTI-STRATEGY MATCHING:
 * We try multiple strategies in order of reliability. The first one that
 * finds a match wins. Think of it like asking for directions:
 *
 *   Strategy 1: "Do you know the exact address?" (barcode = exact match)
 *   Strategy 2: "Can you look from this cached map?" (cache = fast repeat match)
 *   Strategy 3: "Can you search by name?" (text search = fuzzy match)
 *
 * CONFIDENCE SCORING:
 * Each match gets a confidence score from 0 to 1:
 *   1.0 = We KNOW this is the right product (exact barcode match)
 *   0.7 = Probably the right product (strong text match)
 *   0.3 = Might be the right product (weak text match)
 *
 * The confidence score helps the UI decide how to display the result.
 * Low confidence matches can show a "verify" prompt to the user.
 *
 * DATA FLOW:
 *   ScrapedProductData → matchProduct() → MatchResult → toBadgeData() → badges
 * ============================================================================
 */

import type {
    MatchResult,
    MatchMethod,
    ProductIdentifier,
    ScrapedProductData,
    OFFProduct,
} from '@/types';
import { fetchProductByBarcode, searchProducts } from '@/api/off-client';
import { getCache, setCache } from '@/utils/cache';

// ─── Cache Key Helpers ───────────────────────────────────────────────

/**
 * Build a cache key for a barcode lookup result.
 *
 * We cache barcode→product mappings so that when the user visits the same
 * page again, we don't need to call the OFF API — we just grab the
 * cached result instantly.
 *
 * @param barcode - The barcode to build a key for
 * @returns A string like "barcode:3017620422003"
 */
function barcodeCacheKey(barcode: string): string {
    return `barcode:${barcode}`;
}

/**
 * Build a cache key for an SKU→barcode mapping.
 *
 * Some stores (like Walmart) give us an SKU (internal product code).
 * If we successfully match that SKU to a barcode once, we cache the
 * mapping so we don't have to do a slow text search next time.
 *
 * @param storeSlug - The store identifier (e.g., "metro", "walmart")
 * @param sku - The store's internal product code
 * @returns A string like "sku:walmart:12345"
 */
function skuCacheKey(storeSlug: string, sku: string): string {
    return `sku:${storeSlug}:${sku}`;
}

/**
 * Build a cache key for a text search result.
 *
 * Text searches are slow (network call + fuzzy matching).
 * Caching them avoids repeating the same search on every page visit.
 *
 * @param name - Product name used in the search
 * @param brand - Optional brand name
 * @returns A string like "search:nutella 750g|ferrero"
 */
function searchCacheKey(name: string, brand?: string): string {
    const key = brand ? `${name}|${brand}` : name;
    return `search:${key.toLowerCase().trim()}`;
}

// ─── Main Matcher Function ──────────────────────────────────────────

/**
 * Match a scraped product against the OFF database.
 *
 * THIS IS THE MAIN FUNCTION — called for every product card on the page.
 *
 * It tries three strategies in order:
 *
 *   1. BARCODE LOOKUP — If we found a barcode in the DOM, directly look it up.
 *      This is the fastest and most accurate method. Confidence = 1.0.
 *
 *   2. CACHE LOOKUP — Check if we've seen this product before and cached
 *      the result. This is instant (no network call). Keeps original confidence.
 *
 *   3. TEXT SEARCH — Search the OFF API using the product's name and brand.
 *      This is the slowest method and least accurate, but sometimes it's
 *      all we have. Confidence depends on how well the names match.
 *
 * @param product - The product data scraped from the grocery store page
 * @param storeSlug - Which store this product is from (e.g., "metro")
 *                     Used for store-specific cache keys
 * @returns A MatchResult if a match was found, or null if no match
 *
 * @example
 *   // From the content script:
 *   const scraped = adapter.scrapeProducts(document.body);
 *   for (const product of scraped) {
 *     const match = await matchProduct(product, "metro");
 *     if (match) {
 *       // match.product has the OFF data
 *       // match.confidence tells us how sure we are
 *       renderBadges(product.element, match);
 *     }
 *   }
 */
export async function matchProduct(
    product: ScrapedProductData,
    storeSlug: string,
): Promise<MatchResult | null> {

    // ── Strategy 1: Direct Barcode Lookup ──────────────────────────
    // This is the BEST strategy — if we have a barcode, we can look up
    // the product directly. A barcode is like a product's "Social Security Number"
    // — it's unique and maps to exactly one product.

    if (product.identifier?.type === 'barcode') {
        const barcode = product.identifier.value;

        // First, check if we've already looked up this barcode before (cache)
        const cached = await getCache<OFFProduct>(barcodeCacheKey(barcode));
        if (cached) {
            // Cache hit! We don't need to call the API at all
            console.log(`[E-Store] Cache hit for barcode ${barcode}`);
            return {
                product: cached,
                confidence: 1.0,
                matchMethod: 'cache',
            };
        }

        // Cache miss — make the actual API call
        console.log(`[E-Store] Looking up barcode: ${barcode}`);
        const offProduct = await fetchProductByBarcode(barcode);

        if (offProduct) {
            // Found it! Cache the result for next time
            await setCache(barcodeCacheKey(barcode), offProduct);

            return {
                product: offProduct,
                confidence: 1.0,       // Barcode match = 100% confidence
                matchMethod: 'barcode',
            };
        }

        // Barcode was not found in OFF database.
        // This can happen if:
        //   - The product hasn't been added to OFF yet
        //   - The barcode is wrong (e.g., Metro's internal code, not a real UPC)
        console.log(`[E-Store] Barcode ${barcode} not found in OFF database`);
        // Don't return yet — fall through to text search
    }

    // ── Strategy 2: SKU Cache Lookup ───────────────────────────────
    // If we have an SKU (store internal code), check if we've previously
    // mapped this SKU to a barcode. This happens when:
    //   - On a previous visit, text search found the product
    //   - We cached the SKU→product mapping for fast future lookups

    if (product.identifier?.type === 'sku') {
        const sku = product.identifier.value;
        const cached = await getCache<OFFProduct>(skuCacheKey(storeSlug, sku));

        if (cached) {
            console.log(`[E-Store] Cache hit for SKU ${storeSlug}:${sku}`);
            return {
                product: cached,
                confidence: 0.9,    // High confidence — we matched this before
                matchMethod: 'cache',
            };
        }
    }

    // ── Strategy 3: Text Search Fallback ───────────────────────────
    // If we couldn't find the product by barcode or cached SKU,
    // our last resort is to search by the product's name and brand.
    //
    // This is the LEAST reliable method because:
    //   - Product names on stores might not match names in OFF
    //   - Multiple products might have similar names
    //   - French/English name differences
    //
    // But it's better than showing nothing at all!

    if (product.name) {
        // Check text search cache first
        const cacheKey = searchCacheKey(product.name, product.brand);
        const cached = await getCache<MatchResult>(cacheKey);

        if (cached) {
            console.log(`[E-Store] Cache hit for text search: "${product.name}"`);
            return cached;
        }

        // Build the search query from product name + brand
        // Example: "Nutella" + "Ferrero" → "Nutella Ferrero"
        const query = buildSearchQuery(product.name, product.brand);

        console.log(`[E-Store] Text searching: "${query}"`);
        const searchResults = await searchProducts(query, 1, 5);

        // If we got results, score them to find the best match
        if (searchResults && searchResults.products.length > 0) {
            const bestMatch = findBestTextMatch(
                product.name,
                product.brand,
                searchResults.products,
            );

            if (bestMatch) {
                // Cache the result so we don't search again next time
                await setCache(cacheKey, bestMatch);

                // Also cache the SKU→product mapping if we have an SKU
                if (product.identifier?.type === 'sku') {
                    await setCache(
                        skuCacheKey(storeSlug, product.identifier.value),
                        bestMatch.product,
                    );
                }

                return bestMatch;
            }
        }

        console.log(`[E-Store] No text match found for: "${query}"`);
    }

    // All strategies failed — we couldn't match this product
    return null;
}

// ─── Text Search Helpers ─────────────────────────────────────────────

/**
 * Build a clean search query from a product name and optional brand.
 *
 * WE CLEAN UP THE NAME because store websites often include extra info
 * that confuses the OFF search engine:
 *   - "Nutella® Hazelnut Spread 750g — 2 for $10" → "Nutella Hazelnut Spread 750g"
 *   - "PRESIDENT Butter, Unsalted (250 g)" → "PRESIDENT Butter Unsalted 250 g"
 *
 * @param name - Raw product name from the store's page
 * @param brand - Optional brand name
 * @returns A cleaned-up search query string
 */
function buildSearchQuery(name: string, brand?: string): string {
    // Step 1: Remove common noise from store product names
    let cleanName = name
        // Remove trademark/registered symbols (®, ™)
        .replace(/[®™©]/g, '')
        // Remove commas to prevent treating them as boundaries
        .replace(/,/g, '')
        // Remove pricing information ("— $4.99", "2 for $10")
        .replace(/[-–—]\s*\$[\d.]+.*/g, '')
        .replace(/\d+\s*for\s*\$[\d.]+/gi, '')
        // Remove common volume/weight metrics (e.g., "355 mL", "2 Liters", "500g", "222mL")
        .replace(/\b\d+(\.\d+)?\s*(ml|l|g|kg|oz|lb|liters|liter|litre|litres)\b/gi, '')
        // Remove packaging descriptors (e.g., "12 Pack", "Cans", "Bottles", "Fridge Pack", "Mini-Cans")
        .replace(/\b(\d+\s*pack|cans|can|bottles|bottle|fridge pack|mini-cans)\b/gi, '')
        // Clean up any double spaces that resulted from deletions
        .replace(/\s+/g, ' ')
        .trim();

    // Step 2: Add the brand to the search if it's not already in the name
    // Example: If name is "Hazelnut Spread" and brand is "Nutella",
    //          search for "Hazelnut Spread Nutella" (better results)
    if (brand && !cleanName.toLowerCase().includes(brand.toLowerCase())) {
        cleanName = `${cleanName} ${brand}`;
    }

    return cleanName;
}

/**
 * Find the best matching product from text search results.
 *
 * When we search for "Nutella 750g", the OFF API might return:
 *   1. "Nutella Hazelnut Spread 750g" — ✅ Great match!
 *   2. "Nutella & Go Breadsticks 52g" — ❌ Wrong product
 *   3. "Hazelnut chocolate spread" — ❌ Not Nutella
 *
 * This function scores each result and returns the best match
 * (only if the score is good enough to be trustworthy).
 *
 * @param scrapedName - The product name from the store's page
 * @param scrapedBrand - The brand name from the store's page (optional)
 * @param candidates - Array of products from the OFF text search
 * @returns The best MatchResult, or null if no result is good enough
 */
function findBestTextMatch(
    scrapedName: string,
    scrapedBrand: string | undefined,
    candidates: OFFProduct[],
): MatchResult | null {
    let bestMatch: MatchResult | null = null;
    let bestScore = 0;

    // Score each candidate and keep the best one
    for (const candidate of candidates) {
        const score = computeMatchScore(scrapedName, scrapedBrand, candidate);

        if (score > bestScore) {
            bestScore = score;
            bestMatch = {
                product: candidate,
                confidence: score,
                matchMethod: 'text-search',
            };
        }
    }

    // Only return the match if confidence is above our minimum threshold.
    // Below 0.3, the match is too unreliable to show to the user.
    //
    // WHY 0.3?
    //   - 0.3 means roughly 30% of the words match
    //   - Below this, we'd show wrong products more often than right ones
    //   - It's better to show "not found" than a wrong result
    const MINIMUM_CONFIDENCE = 0.3;

    if (bestMatch && bestScore >= MINIMUM_CONFIDENCE) {
        return bestMatch;
    }

    return null;
}

// ─── Match Scoring ───────────────────────────────────────────────────

/**
 * Compute a match score between a scraped product and an OFF candidate.
 *
 * HOW SCORING WORKS:
 * We compare two things:
 *   1. Product name similarity (how many words match)
 *   2. Brand match (bonus points if brands match)
 *
 * The score ranges from 0 (no match) to 1 (perfect match).
 *
 * EXAMPLE:
 *   Scraped: "Nutella Hazelnut Spread 750g"
 *   OFF:     "Nutella - Hazelnut Spread With Cocoa"
 *
 *   Common words: "nutella", "hazelnut", "spread" = 3 out of 4 scraped words
 *   Name score: 3/4 = 0.75
 *   Brand bonus: Scraped brand is "Ferrero", OFF brand is "Ferrero" → +0.1
 *   Final score: min(0.85, 0.95) = 0.85 (capped at 0.95 — never 1.0 for text)
 *
 * @param scrapedName - Product name from the store
 * @param scrapedBrand - Brand from the store (optional)
 * @param candidate - An OFF product to score against
 * @returns A score from 0 (no match) to 0.95 (near-perfect text match)
 */
function computeMatchScore(
    scrapedName: string,
    scrapedBrand: string | undefined,
    candidate: OFFProduct,
): number {
    // Get the candidate's name (OFF has names in multiple languages)
    const candidateName = candidate.product_name
        || candidate.product_name_en
        || candidate.product_name_fr
        || '';

    // If the OFF product has no name, it's not a valid match
    if (!candidateName) return 0;

    // ── Step 1: Compute name similarity ──

    // Break both names into individual words, all lowercase
    // "Nutella Hazelnut Spread 750g" → ["nutella", "hazelnut", "spread", "750g"]
    const scrapedWords = tokenize(scrapedName);
    const candidateWords = tokenize(candidateName);

    // If either name has no words, there's nothing to compare
    if (scrapedWords.length === 0 || candidateWords.length === 0) return 0;

    // Count how many scraped words appear in the candidate name
    // "nutella" in ["nutella", "hazelnut", "spread", "with", "cocoa"]? → YES
    // "750g" in ["nutella", "hazelnut", "spread", "with", "cocoa"]? → NO
    let matchingWords = 0;
    for (const word of scrapedWords) {
        if (candidateWords.includes(word)) {
            matchingWords++;
        }
    }

    // Name score = fraction of scraped words that matched
    // Example: 3 out of 4 words matched → 0.75
    const nameScore = matchingWords / scrapedWords.length;

    // ── Step 2: Brand matching bonus ──

    // If we know the brand from the store AND the OFF product has a brand,
    // and they match, we give bonus points. Brand match is a strong signal
    // that we found the right product.
    let brandBonus = 0;

    if (scrapedBrand && candidate.brands) {
        const scrapedBrandLower = scrapedBrand.toLowerCase().trim();
        const candidateBrands = candidate.brands.toLowerCase();

        // Check if the scraped brand appears anywhere in the OFF brands string
        // OFF stores brands as comma-separated: "Ferrero, Nutella"
        if (candidateBrands.includes(scrapedBrandLower)) {
            brandBonus = 0.1; // +10% confidence boost for brand match
        }
    }

    // ── Step 3: Combine scores ──

    // Final score = name similarity + brand bonus, capped at 0.95
    // We cap at 0.95 because text matches should NEVER be 100% confident —
    // only barcode matches get 1.0 confidence
    const finalScore = Math.min(nameScore + brandBonus, 0.95);

    return finalScore;
}

// ─── String Utilities ────────────────────────────────────────────────

/**
 * Break a string into individual "tokens" (words), all lowercase.
 *
 * This is a simple tokenizer that:
 *   1. Converts to lowercase ("Nutella" → "nutella")
 *   2. Splits on spaces and punctuation
 *   3. Removes very short words (1-2 characters like "g", "de", "le")
 *      because they cause false matches
 *
 * EXAMPLES:
 *   "Nutella Hazelnut Spread 750g" → ["nutella", "hazelnut", "spread", "750g"]
 *   "Beurre d'Érable du Québec" → ["beurre", "érable", "québec"]
 *   "PRESIDENT® Butter, Unsalted" → ["president", "butter", "unsalted"]
 *
 * @param text - The text to tokenize
 * @returns Array of lowercase word tokens
 */
function tokenize(text: string): string[] {
    return text
        // Convert to lowercase for case-insensitive comparison
        .toLowerCase()
        // Remove trademark/registered symbols
        .replace(/[®™©]/g, '')
        // Split on non-alphanumeric characters (spaces, commas, dashes, etc.)
        // But keep accented characters (é, è, ü) for French product names
        .split(/[^a-z0-9àâäéèêëïîôùûüÿçœæ]+/)
        // Remove empty strings and very short words
        .filter((word) => word.length > 2);
}

// ─── Batch Matching ──────────────────────────────────────────────────

/**
 * Match multiple products at once.
 *
 * WHY THIS EXISTS:
 * A grocery store page typically shows 20-50 products. Instead of matching
 * them one at a time (which would be slow because each match might need
 * a network call), this function matches all of them in parallel.
 *
 * The rate limiter in our API client (off-client.ts) ensures we don't
 * overwhelm the OFF server with too many requests at once.
 *
 * @param products - Array of scraped products from the store page
 * @param storeSlug - Which store (e.g., "metro") for cache keys
 * @returns Map of DOM element → MatchResult (only includes matched products)
 *
 * @example
 *   const products = adapter.scrapeProducts(document.body);
 *   const matches = await matchProductsBatch(products, "metro");
 *
 *   // matches is a Map: { element1 → MatchResult, element3 → MatchResult, ... }
 *   // Products that weren't found are NOT in the map
 *
 *   for (const [element, match] of matches) {
 *     renderBadges(element, match);
 *   }
 */
export async function matchProductsBatch(
    products: ScrapedProductData[],
    storeSlug: string,
): Promise<Map<Element, MatchResult>> {
    // Map to store results: DOM element → match result
    const results = new Map<Element, MatchResult>();

    // Fire all match attempts in parallel
    // Promise.allSettled waits for ALL to complete (even if some fail)
    // This is different from Promise.all which stops at the first failure
    const promises = products.map(async (product) => {
        try {
            const match = await matchProduct(product, storeSlug);
            if (match) {
                results.set(product.element, match);
            }
        } catch (error) {
            // If one product fails, don't crash — just skip it
            // The other products will still be processed
            console.warn(
                `[E-Store] Failed to match product "${product.name}":`,
                error,
            );
        }
    });

    // Wait for all matches to complete
    await Promise.allSettled(promises);

    console.log(
        `[E-Store] Matched ${results.size} out of ${products.length} products`,
    );

    return results;
}
