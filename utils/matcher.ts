import type {
    MatchResult,
    MatchMethod,
    ProductIdentifier,
    ScrapedProductData,
    OFFProduct,
} from '@/types';
import { fetchProductByBarcode, searchProducts } from '@/api/off-client';
import { getCache, setCache } from '@/utils/cache';

const MINIMUM_CONFIDENCE = 0.3;
const MAX_TEXT_CONFIDENCE = 0.95;

function barcodeCacheKey(barcode: string): string {
    return `barcode:${barcode}`;
}

function skuCacheKey(storeSlug: string, sku: string): string {
    return `sku:${storeSlug}:${sku}`;
}

function searchCacheKey(name: string, brand?: string): string {
    const key = brand ? `${name}|${brand}` : name;
    return `search:${key.toLowerCase().trim()}`;
}

/**
 * Match a scraped product against the OFF database using a multi-strategy
 * approach: barcode lookup → SKU cache → text search fallback.
 */
export async function matchProduct(
    product: ScrapedProductData,
    storeSlug: string,
): Promise<MatchResult | null> {

    if (product.identifier?.type === 'barcode') {
        const barcode = product.identifier.value;

        const cached = await getCache<OFFProduct>(barcodeCacheKey(barcode));
        if (cached) {
            return { product: cached, confidence: 1.0, matchMethod: 'cache' };
        }

        const offProduct = await fetchProductByBarcode(barcode);

        if (offProduct) {
            await setCache(barcodeCacheKey(barcode), offProduct);
            return { product: offProduct, confidence: 1.0, matchMethod: 'barcode' };
        }
    }

    if (product.identifier?.type === 'sku') {
        const sku = product.identifier.value;
        const cached = await getCache<OFFProduct>(skuCacheKey(storeSlug, sku));

        if (cached) {
            return { product: cached, confidence: 0.9, matchMethod: 'cache' };
        }
    }

    if (product.name) {
        const cacheKey = searchCacheKey(product.name, product.brand);
        const cached = await getCache<MatchResult>(cacheKey);

        if (cached) {
            return cached;
        }

        const query = buildSearchQuery(product.name, product.brand);
        const searchResults = await searchProducts(query, 1, 5);

        if (searchResults && searchResults.products.length > 0) {
            const bestMatch = findBestTextMatch(
                product.name,
                product.brand,
                searchResults.products,
            );

            if (bestMatch) {
                await setCache(cacheKey, bestMatch);

                if (product.identifier?.type === 'sku') {
                    await setCache(
                        skuCacheKey(storeSlug, product.identifier.value),
                        bestMatch.product,
                    );
                }

                return bestMatch;
            }
        }
    }

    return null;
}

/**
 * Sanitize a product name and append the brand to build a search query
 * suitable for the OFF text search API.
 */
function buildSearchQuery(name: string, brand?: string): string {
    let cleanName = name
        .replace(/[®™©]/g, '')
        .replace(/,/g, '')
        .replace(/[-–—]\s*\$[\d.]+.*/g, '')
        .replace(/\d+\s*for\s*\$[\d.]+/gi, '')
        .replace(/\b\d+(\.\d+)?\s*(ml|l|g|kg|oz|lb|liters|liter|litre|litres)\b/gi, '')
        .replace(/\b(\d+\s*pack|cans|can|bottles|bottle|fridge pack|mini-cans)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (brand && !cleanName.toLowerCase().includes(brand.toLowerCase())) {
        cleanName = `${cleanName} ${brand}`;
    }

    return cleanName;
}

/**
 * Score each candidate product from a text search and return the best one
 * that exceeds the minimum confidence threshold.
 */
function findBestTextMatch(
    scrapedName: string,
    scrapedBrand: string | undefined,
    candidates: OFFProduct[],
): MatchResult | null {
    let bestMatch: MatchResult | null = null;
    let bestScore = 0;

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

    if (bestMatch && bestScore >= MINIMUM_CONFIDENCE) {
        return bestMatch;
    }

    return null;
}

/**
 * Compute a similarity score (0–0.95) between a scraped product and an OFF
 * candidate based on word overlap and brand matching.
 */
function computeMatchScore(
    scrapedName: string,
    scrapedBrand: string | undefined,
    candidate: OFFProduct,
): number {
    const candidateName = candidate.product_name
        || candidate.product_name_en
        || candidate.product_name_fr
        || '';

    if (!candidateName) return 0;

    const scrapedWords = tokenize(scrapedName);
    const candidateWords = tokenize(candidateName);

    if (scrapedWords.length === 0 || candidateWords.length === 0) return 0;

    let matchingWords = 0;
    for (const word of scrapedWords) {
        if (candidateWords.includes(word)) {
            matchingWords++;
        }
    }

    const nameScore = matchingWords / scrapedWords.length;

    let brandBonus = 0;
    if (scrapedBrand && candidate.brands) {
        const scrapedBrandLower = scrapedBrand.toLowerCase().trim();
        const candidateBrands = candidate.brands.toLowerCase();

        if (candidateBrands.includes(scrapedBrandLower)) {
            brandBonus = 0.1;
        }
    }

    return Math.min(nameScore + brandBonus, MAX_TEXT_CONFIDENCE);
}

/** Split text into lowercase word tokens, filtering out short noise words. */
function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[®™©]/g, '')
        .split(/[^a-z0-9àâäéèêëïîôùûüÿçœæ]+/)
        .filter((word) => word.length > 2);
}

/**
 * Match multiple products in parallel. Returns a map of DOM element to
 * match result for successfully matched products.
 */
export async function matchProductsBatch(
    products: ScrapedProductData[],
    storeSlug: string,
): Promise<Map<Element, MatchResult>> {
    const results = new Map<Element, MatchResult>();

    const promises = products.map(async (product) => {
        try {
            const match = await matchProduct(product, storeSlug);
            if (match) {
                results.set(product.element, match);
            }
        } catch (error) {
            console.warn(`[E-Store] Failed to match "${product.name}":`, error);
        }
    });

    await Promise.allSettled(promises);
    return results;
}
