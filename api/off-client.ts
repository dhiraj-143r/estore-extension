/**
 * ============================================================================
 * OFF API Client — Open Food Facts API Communication Layer
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * This is the "phone line" to Open Food Facts. Whenever we need to look up
 * a product's nutrition data (Nutri-Score, NOVA group, Eco-Score), this file
 * makes the actual HTTP requests to the OFF servers.
 *
 * WHY IT EXISTS:
 * Instead of scattering fetch() calls all over the codebase, we centralize
 * ALL OFF API calls here. This gives us one place to:
 *   - Handle errors (network failures, timeouts, server errors)
 *   - Add rate limiting (don't spam the OFF server with 100 requests at once)
 *   - Set proper headers (User-Agent, so OFF knows who we are)
 *   - Log and debug API issues
 *
 * HOW IT'S USED:
 *   1. Content script scrapes a product barcode from the grocery store page
 *   2. Content script sends the barcode to the background service worker
 *   3. Background worker calls this API client to look up the product
 *   4. OFF API returns the product data (or "not found")
 *   5. Data flows back to the content script to render badges
 *
 * TWO WAYS TO LOOK UP A PRODUCT:
 *   1. By BARCODE (best) — Direct lookup, fast & accurate
 *   2. By TEXT SEARCH (fallback) — When barcode isn't available, search by name
 * ============================================================================
 */

import type {
    OFFProduct,
    OFFProductResponse,
    OFFSearchResponse,
    BadgeData,
    NutriScoreGrade,
    NovaGroup,
    EcoScoreGrade,
} from '@/types';
import { computeWarnings } from '@/utils/health-canada';

// ─── Configuration ───────────────────────────────────────────────────

/**
 * Base URL for the "world" (global) OFF API.
 * We use this for barcode lookups because barcodes are universal.
 */
const OFF_API_BASE = 'https://world.openfoodfacts.org';

/**
 * Base URL for the Canada-specific OFF API.
 * We use this for text searches to prioritize Canadian products.
 */
const OFF_CA_API_BASE = 'https://ca.openfoodfacts.org';

/**
 * How long to wait for an API response before giving up (in milliseconds).
 * 10 seconds = 10000ms. If the OFF server doesn't respond in 10 seconds,
 * we treat it as a failure and move on.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Maximum number of API requests we're allowed to make at the same time.
 * If we're on a page with 50 products, we don't want to fire 50 requests
 * simultaneously — that would overwhelm the OFF server. Instead, we
 * process them 5 at a time.
 */
const MAX_CONCURRENT_REQUESTS = 5;

/**
 * User-Agent string we send with every request.
 * OFF asks extensions to identify themselves so they can track usage
 * and contact us if there's a problem.
 */
const USER_AGENT = 'EStoreExtension/0.1.0 (browser-extension)';

// ─── Rate Limiting Tracker ───────────────────────────────────────────

/**
 * Simple counter to track how many requests are currently in flight.
 * When this hits MAX_CONCURRENT_REQUESTS, new requests wait in a queue.
 */
let activeRequests = 0;

/**
 * Queue of requests waiting to be sent.
 * Each entry is a "resolve" function — when called, it lets the
 * waiting request proceed.
 */
const requestQueue: Array<() => void> = [];

/**
 * Waits for a "slot" to open up for a new request.
 *
 * HOW IT WORKS:
 *   - If fewer than 5 requests are active → proceed immediately
 *   - If 5 requests are already active → wait in a queue
 *   - When another request finishes, it "releases" a slot and
 *     the next queued request gets to proceed
 *
 * This is like a line at a checkout counter with 5 cashiers.
 */
async function acquireSlot(): Promise<void> {
    // If there's room, just go ahead
    if (activeRequests < MAX_CONCURRENT_REQUESTS) {
        activeRequests++;
        return;
    }

    // No room — wait in line until a slot opens up
    return new Promise<void>((resolve) => {
        requestQueue.push(() => {
            activeRequests++;
            resolve();
        });
    });
}

/**
 * Releases a request slot after a request completes (success or failure).
 * If there are requests waiting in the queue, let the next one proceed.
 */
function releaseSlot(): void {
    activeRequests--;

    // If someone is waiting in line, let them go next
    if (requestQueue.length > 0) {
        const next = requestQueue.shift()!;
        next();
    }
}

// ─── Core HTTP Helper ────────────────────────────────────────────────

/**
 * Makes an HTTP GET request to the OFF API with proper error handling.
 *
 * This is a wrapper around the browser's built-in fetch() that adds:
 *   1. Timeout — gives up after 10 seconds
 *   2. Rate limiting — waits if too many requests are active
 *   3. Error handling — returns a clear error instead of crashing
 *   4. User-Agent header — identifies us to the OFF server
 *
 * @param url - The full URL to fetch (e.g., "https://world.openfoodfacts.org/api/v0/product/123.json")
 * @returns The parsed JSON response, or null if the request failed
 */
async function offFetch<T>(url: string): Promise<T | null> {
    // Step 1: Wait for a slot (rate limiting)
    await acquireSlot();

    try {
        // Step 2: Create an AbortController for timeout
        // An AbortController lets us cancel the fetch if it takes too long
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        // Step 3: Make the actual HTTP request
        const response = await fetch(url, {
            headers: {
                'User-Agent': USER_AGENT,
            },
            signal: controller.signal, // Attach the abort signal for timeout
        });

        // Step 4: Clear the timeout since the request completed
        clearTimeout(timeoutId);

        // Step 5: Check if the server returned an error (e.g., 500, 404)
        if (!response.ok) {
            console.warn(
                `[E-Store] OFF API error: ${response.status} ${response.statusText} for ${url}`,
            );
            return null;
        }

        // Step 6: Parse the JSON response body
        const data: T = await response.json();
        return data;
    } catch (error) {
        // Handle specific error types
        if (error instanceof DOMException && error.name === 'AbortError') {
            // The request was cancelled because it took longer than 10 seconds
            console.warn(`[E-Store] OFF API timeout for ${url}`);
        } else {
            // Some other error (network failure, DNS error, etc.)
            console.warn(`[E-Store] OFF API request failed for ${url}:`, error);
        }
        return null;
    } finally {
        // Step 7: ALWAYS release the slot, even if the request failed.
        // This ensures the queue keeps moving forward.
        releaseSlot();
    }
}

// ─── Public API Functions ────────────────────────────────────────────

/**
 * Look up a single product by its barcode (EAN/UPC).
 *
 * THIS IS THE PRIMARY LOOKUP METHOD — fastest and most accurate.
 *
 * HOW IT WORKS:
 *   - Sends: GET https://world.openfoodfacts.org/api/v0/product/3017620422003.json
 *   - Receives: { status: 1, product: { nutriscore_grade: "e", nova_group: 4, ... } }
 *   - If status is 0, the product was not found in the OFF database
 *
 * @param barcode - The product's barcode (UPC or EAN), e.g., "3017620422003"
 * @returns The product data if found, or null if not found or request failed
 *
 * @example
 *   const product = await fetchProductByBarcode("3017620422003");
 *   if (product) {
 *     console.log(product.nutriscore_grade); // "e"
 *     console.log(product.nova_group);       // 4
 *   }
 */
export async function fetchProductByBarcode(
    barcode: string,
): Promise<OFFProduct | null> {
    // Build the URL: /api/v0/product/{barcode}.json
    const url = `${OFF_API_BASE}/api/v0/product/${encodeURIComponent(barcode)}.json`;

    // Make the request
    const data = await offFetch<OFFProductResponse>(url);

    // Check the response:
    //   status === 1 means "product found"
    //   status === 0 means "product NOT found in the database"
    if (data && data.status === 1 && data.product) {
        return data.product;
    }

    return null;
}

/**
 * Search for products by text (product name, brand, etc.).
 *
 * THIS IS THE FALLBACK METHOD — used when no barcode is available.
 * Less accurate than barcode lookup, but sometimes it's all we have.
 *
 * HOW IT WORKS:
 *   - Sends: GET https://ca.openfoodfacts.org/cgi/search.pl?search_terms=Nutella&json=1
 *   - Receives: { count: 42, products: [...] }
 *   - Results are filtered to Canadian products (countries_tags_en=canada)
 *   - We use the Canada-specific API (ca.openfoodfacts.org) for better results
 *
 * @param query - The search text (e.g., "Nutella 750g" or "President butter")
 * @param page - Which page of results to fetch (starts at 1)
 * @param pageSize - How many results per page (default: 10, max: 100)
 * @returns Search results with product array, or null if request failed
 *
 * @example
 *   const results = await searchProducts("Nutella");
 *   if (results && results.products.length > 0) {
 *     console.log(results.products[0].product_name); // "Nutella"
 *   }
 */
export async function searchProducts(
    query: string,
    page: number = 1,
    pageSize: number = 10,
): Promise<OFFSearchResponse | null> {
    // Build the search URL with query parameters
    // URLSearchParams handles encoding special characters (spaces, accents, etc.)
    const params = new URLSearchParams({
        search_terms: query,        // What to search for
        json: '1',                  // Return JSON instead of HTML
        page: String(page),         // Page number (for pagination)
        page_size: String(pageSize), // Results per page
        countries_tags_en: 'canada', // Only Canadian products
        sort_by: 'unique_scans_n',  // Sort by popularity (most scanned first)
    });

    const url = `${OFF_CA_API_BASE}/cgi/search.pl?${params}`;

    // Make the request
    const data = await offFetch<OFFSearchResponse>(url);
    return data;
}

// ─── Data Processing Helpers ─────────────────────────────────────────

/**
 * Convert raw OFF product data into badge-ready rendering data.
 *
 * The OFF API returns a LOT of data (ingredients, images, categories, etc.).
 * Our badges only need a few specific fields. This function extracts
 * exactly what the badge components need and computes Health Canada warnings.
 *
 * @param product - Raw product data from the OFF API
 * @returns A clean BadgeData object ready for the badge renderer
 *
 * @example
 *   const product = await fetchProductByBarcode("3017620422003");
 *   if (product) {
 *     const badges = toBadgeData(product);
 *     // badges.nutriScore = "e"
 *     // badges.novaGroup = 4
 *     // badges.healthCanada = { highInSugars: true, ... }
 *   }
 */
export function toBadgeData(product: OFFProduct): BadgeData {
    return {
        // ── Nutri-Score ──
        // Maps the letter grade (a-e) from the API.
        // Falls back to "unknown" if the product doesn't have a computed score.
        nutriScore: parseNutriScore(product.nutriscore_grade),

        // ── NOVA Group ──
        // NOVA classifies food processing level from 1 (unprocessed) to 4 (ultra-processed).
        // Some products don't have NOVA data, so we fall back to null.
        novaGroup: parseNovaGroup(product.nova_group),

        // ── Eco-Score (Green-Score) ──
        // Environmental impact grade from a (best) to f (worst).
        ecoScore: parseEcoScore(product.ecoscore_grade),

        // ── Health Canada Warnings ──
        // Canada requires "High in" symbols on food that exceeds thresholds
        // for saturated fat, sugars, or sodium. We compute these from the
        // nutriment data if available.
        healthCanada: computeHealthCanadaWarnings(product),

        // ── OFF Product Page URL ──
        // Clicking a badge opens the full product page on Open Food Facts.
        offUrl: `${OFF_API_BASE}/product/${product.code}`,

        // ── Completeness ──
        // How "complete" the product data is in OFF (0 to 1).
        // If completeness is low, we show a "partial data" warning.
        completeness: product.completeness ?? 0,
    };
}

// ─── Grade Parsing Helpers ───────────────────────────────────────────

/**
 * Parse the Nutri-Score grade from the raw API value.
 *
 * The API might return "a", "b", "c", "d", "e", or undefined/null.
 * We normalize this to our NutriScoreGrade type.
 */
function parseNutriScore(grade?: string): NutriScoreGrade {
    const valid: NutriScoreGrade[] = ['a', 'b', 'c', 'd', 'e'];
    const lower = grade?.toLowerCase();

    // Check if the grade is one of the valid values
    if (lower && valid.includes(lower as NutriScoreGrade)) {
        return lower as NutriScoreGrade;
    }

    // If missing or unrecognized, return "unknown"
    return 'unknown';
}

/**
 * Parse the NOVA group from the raw API value.
 *
 * NOVA groups:
 *   1 = Unprocessed or minimally processed foods (fresh fruits, vegetables)
 *   2 = Processed culinary ingredients (oils, butter, sugar)
 *   3 = Processed foods (canned vegetables, cheese)
 *   4 = Ultra-processed food products (chips, sodas, instant noodles)
 */
function parseNovaGroup(group?: number): NovaGroup | null {
    // Check if it's a valid NOVA group (1, 2, 3, or 4)
    if (group && group >= 1 && group <= 4) {
        return group as NovaGroup;
    }

    // If missing or invalid, return null (we won't show a NOVA badge)
    return null;
}

/**
 * Parse the Eco-Score grade from the raw API value.
 *
 * Eco-Score measures the environmental impact of a food product:
 *   a = Low impact (best)
 *   b, c, d = Medium impact
 *   e, f = High impact (worst)
 */
function parseEcoScore(grade?: string): EcoScoreGrade {
    const valid: EcoScoreGrade[] = ['a', 'b', 'c', 'd', 'e', 'f'];
    const lower = grade?.toLowerCase();

    if (lower && valid.includes(lower as EcoScoreGrade)) {
        return lower as EcoScoreGrade;
    }

    return 'unknown';
}

// ─── Health Canada Computation ───────────────────────────────────────

/**
 * Compute Health Canada "High In" front-of-package warning symbols.
 *
 * Delegates to the dedicated Health Canada module which contains
 * the full regulation logic, bilingual labels, %DV computation,
 * exemption checks, and severity assessment.
 *
 * @param product - The OFF product with nutriment data
 * @returns Object with boolean flags for each "High In" warning
 */
function computeHealthCanadaWarnings(product: OFFProduct) {
    return computeWarnings(product.nutriments);
}

// ─── Batch Processing ────────────────────────────────────────────────

/**
 * Look up multiple products by barcode at once.
 *
 * WHY THIS EXISTS:
 * A grocery store page might show 20-50 products at once. Instead of
 * calling fetchProductByBarcode one at a time (which would be slow),
 * this function processes them in parallel (up to 5 at a time thanks
 * to our rate limiter).
 *
 * @param barcodes - Array of barcodes to look up
 * @returns Map of barcode → OFFProduct (only includes found products)
 *
 * @example
 *   const products = await fetchProductsBatch(["123", "456", "789"]);
 *   // products = Map { "123" => {...}, "789" => {...} }
 *   // (product "456" was not found, so it's not in the map)
 */
export async function fetchProductsBatch(
    barcodes: string[],
): Promise<Map<string, OFFProduct>> {
    // Create a Map to store results (barcode → product)
    const results = new Map<string, OFFProduct>();

    // Fire all requests in parallel
    // The rate limiter (acquireSlot/releaseSlot) ensures we never have
    // more than MAX_CONCURRENT_REQUESTS in flight at once
    const promises = barcodes.map(async (barcode) => {
        const product = await fetchProductByBarcode(barcode);
        if (product) {
            results.set(barcode, product);
        }
    });

    // Wait for ALL requests to complete (success or failure)
    await Promise.allSettled(promises);

    return results;
}
