/**
 * ============================================================================
 * Open Food Facts API Types
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * Defines TypeScript types for everything related to the OFF API:
 *   - What data we SEND to the API (request params)
 *   - What data we RECEIVE from the API (response shapes)
 *   - What data we COMPUTE from the API response (badge data, warnings)
 *
 * WHY TYPES MATTER:
 * The OFF API returns big JSON objects with hundreds of fields.
 * Without types, we'd have to guess what fields exist and what types
 * they are. TypeScript types let us:
 *   1. Get autocomplete in our editor (type "product." and see all fields)
 *   2. Catch bugs at compile time (trying to use a field that doesn't exist)
 *   3. Document the API response shape for other developers
 * ============================================================================
 */

// ─── Nutriment Data ──────────────────────────────────────────────────

/**
 * Nutriment values from the OFF API.
 *
 * All values are "per 100 grams" of the product. This is the standard
 * way nutritional data is reported in Europe and Canada.
 *
 * EXAMPLE: If a product has 10g of sugar per 100g, then sugars_100g = 10.
 *
 * These values are used to:
 *   1. Compute Health Canada "High In" warnings
 *   2. Show nutritional details in tooltips
 */
export interface Nutriments {
    /** Energy in kJ per 100g (kilojoules — metric energy unit) */
    energy_100g?: number;

    /** Energy in kcal per 100g (calories — what most people know) */
    'energy-kcal_100g'?: number;

    /** Total fat in grams per 100g */
    fat_100g?: number;

    /** Saturated fat in grams per 100g (the "bad" fat) */
    'saturated-fat_100g'?: number;

    /** Total carbohydrates in grams per 100g */
    carbohydrates_100g?: number;

    /** Total sugars in grams per 100g */
    sugars_100g?: number;

    /** Dietary fiber in grams per 100g */
    fiber_100g?: number;

    /** Protein in grams per 100g */
    proteins_100g?: number;

    /** Sodium in grams per 100g (related to salt content) */
    sodium_100g?: number;

    /** Salt in grams per 100g (sodium × 2.5) */
    salt_100g?: number;

    /** Calcium in grams per 100g */
    calcium_100g?: number;

    /** Iron in grams per 100g */
    iron_100g?: number;

    /** Vitamin A in grams per 100g */
    'vitamin-a_100g'?: number;

    /** Vitamin C in grams per 100g */
    'vitamin-c_100g'?: number;
}

// ─── Score Grade Types ───────────────────────────────────────────────

/**
 * Nutri-Score grade: a letter from A (best) to E (worst).
 * "unknown" means the product doesn't have a computed Nutri-Score.
 *
 * WHAT IS NUTRI-SCORE?
 * A color-coded nutrition rating system:
 *   🟢 A = Excellent nutritional quality
 *   🟢 B = Good nutritional quality
 *   🟡 C = Average nutritional quality
 *   🟠 D = Poor nutritional quality
 *   🔴 E = Bad nutritional quality
 */
export type NutriScoreGrade = 'a' | 'b' | 'c' | 'd' | 'e' | 'unknown';

/**
 * NOVA processing group: a number from 1 (best) to 4 (worst).
 *
 * WHAT IS NOVA?
 * A classification system based on how much a food is processed:
 *   1 = Unprocessed or minimally processed (e.g., fresh apple, rice)
 *   2 = Processed culinary ingredients (e.g., olive oil, butter)
 *   3 = Processed foods (e.g., canned tuna, cheese)
 *   4 = Ultra-processed food products (e.g., chips, instant noodles, soda)
 */
export type NovaGroup = 1 | 2 | 3 | 4;

/**
 * Eco-Score grade: a letter from A (best) to F (worst).
 * "unknown" means the product doesn't have a computed Eco-Score.
 *
 * WHAT IS ECO-SCORE?
 * A rating of the environmental impact of a food product:
 *   🟢 A = Very low environmental impact
 *   🟢 B = Low environmental impact
 *   🟡 C = Moderate environmental impact
 *   🟠 D = High environmental impact
 *   🔴 E = Very high environmental impact
 *   ⚫ F = Extremely high environmental impact
 */
export type EcoScoreGrade = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'unknown';

// ─── Health Canada ───────────────────────────────────────────────────

/**
 * Health Canada "High In" front-of-package warning symbols.
 *
 * BACKGROUND:
 * Since 2022, Canada requires certain foods to display a warning symbol
 * on the front of the package if they're high in:
 *   ⚠️ Saturated fat
 *   ⚠️ Sugars
 *   ⚠️ Sodium
 *
 * Our extension computes these warnings from the nutritional data
 * and displays them as badges on the product card.
 */
export interface HealthCanadaWarnings {
    /** true if the product has ≥ 5g saturated fat per 100g */
    highInSaturatedFat: boolean;

    /** true if the product has ≥ 15g sugars per 100g */
    highInSugars: boolean;

    /** true if the product has ≥ 600mg (0.6g) sodium per 100g */
    highInSodium: boolean;
}

// ─── OFF Product Data ────────────────────────────────────────────────

/**
 * Product data returned by the Open Food Facts API.
 *
 * This is the "answer" we get when we look up a product.
 * Not all fields are always present — that's why most are optional (?).
 * The completeness of data depends on how much the community has contributed.
 */
export interface OFFProduct {
    /** The product's barcode (EAN or UPC number) */
    code: string;

    /** Product name (language-neutral or default language) */
    product_name?: string;

    /** Product name in English */
    product_name_en?: string;

    /** Product name in French (important for Quebec!) */
    product_name_fr?: string;

    /** Brand name(s), comma-separated if multiple */
    brands?: string;

    /** Nutri-Score letter grade: "a", "b", "c", "d", or "e" */
    nutriscore_grade?: string;

    /** NOVA processing group: 1, 2, 3, or 4 */
    nova_group?: number;

    /** Eco-Score letter grade: "a" through "e" */
    ecoscore_grade?: string;

    /** Nutritional values per 100g (see Nutriments interface) */
    nutriments?: Nutriments;

    /** URL to the product's main image */
    image_url?: string;

    /** URL to the product's front image (what you see in the store) */
    image_front_url?: string;

    /** URL to a small version of the front image (for thumbnails) */
    image_front_small_url?: string;

    /** Category tags (e.g., ["en:snacks", "en:chocolate"]) */
    categories_tags?: string[];

    /** Country tags (e.g., ["en:canada", "en:france"]) */
    countries_tags?: string[];

    /** Label tags (e.g., ["en:organic", "en:fair-trade"]) */
    labels_tags?: string[];

    /** Allergen tags (e.g., ["en:milk", "en:nuts"]) */
    allergens_tags?: string[];

    /** Packaging description (e.g., "Plastic bottle") */
    packaging?: string;

    /** Packaging tags for structured data */
    packaging_tags?: string[];

    /** Product quantity (e.g., "750 g", "1 L") */
    quantity?: string;

    /**
     * How complete the product data is in the OFF database.
     * 0 = almost no data, 1 = very complete
     * We use this to warn users about unreliable data.
     */
    completeness?: number;
}

// ─── API Responses ───────────────────────────────────────────────────

/**
 * Response from: GET /api/v0/product/{barcode}.json
 *
 * This is what the OFF API returns when you look up a single product
 * by its barcode.
 *
 * EXAMPLE RESPONSE (for Nutella, barcode 3017620422003):
 * {
 *   "status": 1,
 *   "status_verbose": "product found",
 *   "product": { "code": "3017620422003", "nutriscore_grade": "e", ... }
 * }
 */
export interface OFFProductResponse {
    /**
     * 1 = product was found in the database
     * 0 = product was NOT found
     */
    status: 0 | 1;

    /** Human-readable status message (e.g., "product found") */
    status_verbose: string;

    /** The product data (only present when status === 1) */
    product?: OFFProduct;
}

/**
 * Response from: GET /cgi/search.pl?search_terms=...&json=1
 *
 * This is what the OFF API returns when you search by text (product name).
 * Returns a paginated list of matching products.
 *
 * EXAMPLE RESPONSE (searching for "Nutella"):
 * {
 *   "count": 42,
 *   "page": 1,
 *   "page_size": 10,
 *   "products": [ {...}, {...}, ... ]
 * }
 */
export interface OFFSearchResponse {
    /** Total number of matching products (across all pages) */
    count: number;

    /** Current page number (starts at 1) */
    page: number;

    /** How many products per page */
    page_size: number;

    /** Array of matching products on this page */
    products: OFFProduct[];
}

// ─── Match Results ───────────────────────────────────────────────────

/**
 * How a product was matched against the OFF database.
 *
 *   "barcode"     = We used the barcode to look up the product directly
 *   "text-search" = We searched by product name/brand text
 *   "cache"       = We found a previously cached match
 */
export type MatchMethod = 'barcode' | 'text-search' | 'cache';

/**
 * The result of matching a scraped product against the OFF database.
 *
 * DATA FLOW:
 *   ScrapedProductData → (matcher) → MatchResult → (processor) → BadgeData
 *   [from the DOM]                  [from OFF API]                [for rendering]
 */
export interface MatchResult {
    /** The matching OFF product data */
    product: OFFProduct;

    /**
     * How confident we are in this match (0 to 1).
     *   1.0 = Perfect barcode match
     *   0.8 = Good text search match
     *   0.5 = Okay text search match
     *   0.3 = Weak text search match
     */
    confidence: number;

    /** How this match was found */
    matchMethod: MatchMethod;
}

// ─── Badge Rendering Data ────────────────────────────────────────────

/**
 * Pre-computed data ready for the badge renderer.
 *
 * WHAT THIS IS:
 * The OFF API returns a huge product object with hundreds of fields.
 * The badge renderer only needs a few specific values. This type
 * contains exactly what the badges need — nothing more, nothing less.
 *
 * COMPUTED FIELDS:
 * Some fields (like Health Canada warnings) are COMPUTED from the raw
 * product data using Health Canada's thresholds. They don't come directly
 * from the API.
 */
export interface BadgeData {
    /** Nutri-Score grade (a–e or "unknown") */
    nutriScore: NutriScoreGrade;

    /** NOVA processing group (1–4 or null if not available) */
    novaGroup: NovaGroup | null;

    /** Eco-Score / Green-Score grade (a–f or "unknown") */
    ecoScore: EcoScoreGrade;

    /** Health Canada "High In" warnings (computed from nutrient data) */
    healthCanada: HealthCanadaWarnings;

    /** Full URL to the product page on openfoodfacts.org (for click-through) */
    offUrl: string;

    /** Data completeness (0–1) — used to show "partial data" warnings */
    completeness: number;
}
