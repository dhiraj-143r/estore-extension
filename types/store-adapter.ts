/**
 * ============================================================================
 * Store Adapter Type Definitions
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * Defines the "contract" (TypeScript interfaces) that every store adapter
 * must follow. Think of it like a blueprint — when we add support for a
 * new grocery store, we know exactly what methods and data it needs to provide.
 *
 * WHY INTERFACES MATTER:
 * Without interfaces, each store adapter could have different method names,
 * return different data shapes, etc. — making it impossible to write generic
 * code that works with ALL stores. Interfaces enforce consistency.
 *
 * KEY CONCEPT — THE ADAPTER PATTERN:
 * Each grocery store (Metro, SuperC, Walmart) has a DIFFERENT website with
 * different HTML structure. But our extension needs to do the SAME things
 * on every store:
 *   1. Find product cards on the page
 *   2. Extract product identifiers (barcodes, SKUs)
 *   3. Inject nutrition badges
 *   4. Handle dynamic content (infinite scroll, SPA navigation)
 *
 * The adapter pattern says: "Define a common interface, then let each store
 * implement it in its own way." The rest of the code just talks to the
 * interface — it doesn't care which store it is.
 * ============================================================================
 */

// ─── Enums & Constants ───────────────────────────────────────────────

/**
 * What kind of page the user is currently looking at.
 *
 * This matters because different page types have different DOM structures:
 *   - "listing" = Category page showing a grid of products
 *   - "detail"  = Single product page with full info
 *   - "search"  = Search results page
 *   - "cart"    = Shopping cart page
 *   - "flyer"   = Weekly flyer / promotional page
 *   - "unknown" = We couldn't figure out what page this is
 */
export type PageType = 'listing' | 'detail' | 'search' | 'cart' | 'flyer' | 'unknown';

/**
 * How a product was identified on the page.
 *
 *   - "barcode" = We found an actual UPC/EAN barcode (best case — 100% match)
 *   - "sku"     = We found a store-internal product code (might not match OFF)
 *   - "name"    = We only got the product name (least reliable, fuzzy search needed)
 */
export type IdentifierType = 'barcode' | 'sku' | 'name';

/**
 * Current state of a badge overlay on a product card.
 *
 * A badge goes through these states:
 *   "loading"   → We're looking up the product in the OFF database
 *   "matched"   → Found! Showing full Nutri-Score/NOVA/Eco-Score
 *   "partial"   → Found, but some data is missing (e.g., no Eco-Score)
 *   "not-found" → Product is not in the OFF database
 *   "error"     → Something went wrong (network error, timeout, etc.)
 */
export type BadgeState = 'loading' | 'matched' | 'partial' | 'not-found' | 'error';

// ─── CSS Selector Configuration ──────────────────────────────────────

/**
 * A structured map of CSS selectors for scraping a store's DOM.
 *
 * WHAT ARE CSS SELECTORS?
 * CSS selectors are like "addresses" for finding elements in a web page.
 * For example, ".product-name" finds all elements with class="product-name".
 *
 * WHY IS THIS A SEPARATE TYPE?
 * Each store uses different class names and HTML structure. By putting all
 * selectors in one config object, we can:
 *   1. See all the selectors for a store in one place
 *   2. Update them easily when a store changes their website
 *   3. Test them independently
 */
export interface SelectorConfig {
    /**
     * Finds the product card container.
     * A "product card" is the box that shows one product (image, name, price).
     * Example: ".product-tile" or "[data-product-code]"
     */
    productCard: string;

    /**
     * Finds the product name within a card.
     * Example: ".product-name" → "Nutella Hazelnut Spread 750g"
     */
    productName: string;

    /**
     * Finds the brand name within a card (optional — not all stores show it).
     * Example: ".product-brand" → "Ferrero"
     */
    productBrand?: string;

    /**
     * Finds the price within a card (optional).
     * Example: ".price-product" → "$5.99"
     */
    productPrice?: string;

    /**
     * Finds the product image within a card (optional).
     * Example: ".product-image img"
     */
    productImage?: string;

    /**
     * Finds the element containing the product identifier (barcode or SKU).
     * Example: "[data-product-code]"
     */
    productIdentifier?: string;

    /**
     * Which HTML attribute holds the identifier value.
     * For example, Metro uses: <div data-product-code="226690">
     * So the attribute name is "data-product-code".
     * If not set, we read the element's text content instead.
     */
    identifierAttribute?: string;

    /**
     * Where to inject our nutrition badges on a product card.
     * We need to find a good spot that doesn't break the store's layout.
     * Example: ".product-tile__bottom"
     */
    badgeInjectionPoint: string;

    /**
     * The container that holds all product cards (used for MutationObserver).
     * We watch this container for new products being added (infinite scroll).
     * Example: ".products-search--grid"
     */
    productListContainer?: string;
}

// ─── Scraped Product Data ────────────────────────────────────────────

/**
 * A product identifier extracted from the grocery store's DOM.
 *
 * This is what we found on the page BEFORE looking anything up in OFF.
 * Think of it as the "question" we'll ask the OFF API.
 */
export interface ProductIdentifier {
    /** How the product was identified (barcode, SKU, or name) */
    type: IdentifierType;

    /**
     * The raw value we found.
     * Examples: "3017620422003" (barcode), "226690" (SKU), "Nutella 750g" (name)
     */
    value: string;

    /**
     * How confident we are that this identifier will successfully match
     * a product in the OFF database.
     *
     * Scale: 0 (no confidence) to 1 (certain match)
     *   - 1.0 = Verified UPC/EAN barcode
     *   - 0.9 = Likely barcode (8-14 digits, from a reliable source)
     *   - 0.3 = Store-internal SKU (might not exist in OFF)
     *   - 0.1 = Product name only (fuzzy search, low accuracy)
     */
    confidence: number;
}

/**
 * Data scraped from a single product card in the store's DOM.
 *
 * This is the RAW data — extracted directly from the HTML page.
 * It has NOT been matched against the OFF database yet.
 *
 * FLOW: Store Page → ScrapedProductData → (API lookup) → MatchResult → BadgeData
 */
export interface ScrapedProductData {
    /** The actual HTML element of the product card in the DOM */
    element: Element;

    /** The product identifier we found, or null if we couldn't identify it */
    identifier: ProductIdentifier | null;

    /** Product name as displayed on the store's page */
    name: string;

    /** Brand name if visible (e.g., "Ferrero") */
    brand?: string;

    /** Price as displayed, kept as string to preserve formatting like "$4.99/kg" */
    price?: string;

    /** URL of the product's image on the store's website */
    imageUrl?: string;

    /** URL of the product's detail page on the store's website */
    detailUrl?: string;
}

// ─── Store Metadata ──────────────────────────────────────────────────

/**
 * Static configuration for a supported store.
 *
 * This is the "identity card" for a store — it never changes at runtime.
 * Contains the store's name, visual branding, and CSS selectors.
 */
export interface StoreConfig {
    /** Human-readable store name (e.g., "Metro") */
    name: string;

    /** URL-safe identifier (e.g., "metro") — used for storage keys, CSS classes */
    slug: string;

    /** Regular expression to match the store's domain (e.g., /metro\.ca/) */
    domain: RegExp;

    /** Path to the store's logo SVG in our assets folder */
    logoPath: string;

    /** The store's brand color in hex (e.g., "#E31837" for Metro's red) */
    brandColor: string;

    /** Which page types this adapter supports (e.g., listing, detail, search) */
    supportedPageTypes: PageType[];

    /** CSS selectors for finding elements on this store's pages */
    selectors: SelectorConfig;
}

// ─── Store Adapter Interface ─────────────────────────────────────────

/**
 * The main adapter interface — the core contract that each store implements.
 *
 * EVERY supported grocery store (Metro, SuperC, Walmart) has an adapter
 * that implements this interface. The content script doesn't need to know
 * which store it's on — it just calls adapter.scrapeProducts() and
 * adapter.getInjectionPoint() and everything works.
 *
 * METHODS OVERVIEW:
 *   📋 config            → Store metadata (name, selectors, branding)
 *   🔍 detectPageType()  → Figure out what kind of page we're on
 *   📦 scrapeProducts()  → Find all products on the page
 *   🏷️ extractIdentifier() → Get a product's barcode/SKU from the DOM
 *   📝 extractProductName() → Get a product's displayed name
 *   💉 getInjectionPoint() → Where to insert our badges
 *   ✅ hasBadges()        → Check if we already added badges (avoid duplicates)
 *   👁️ observeDynamicContent() → Watch for new products (infinite scroll)
 *   🧭 observeNavigation()     → Watch for SPA page changes
 */
export interface StoreAdapter {
    /** Store's static configuration (read-only at runtime) */
    readonly config: StoreConfig;

    // ── Page Detection ──

    /**
     * Detect what type of page the user is currently on.
     *
     * Different page types have different DOM structures:
     *   - Listing pages show a grid of product cards
     *   - Detail pages show one product with full info
     *   - Cart pages show items the user wants to buy
     *
     * @param url - The current page URL
     * @param document - The page's Document object
     * @returns The detected page type
     */
    detectPageType(url: string, document: Document): PageType;

    // ── Product Scraping ──

    /**
     * Find and scrape ALL product cards on the current page.
     *
     * This is the main workhorse method. It:
     *   1. Uses CSS selectors to find product card elements
     *   2. Extracts name, brand, price, image from each card
     *   3. Tries to find a product identifier (barcode/SKU)
     *   4. Returns an array of ScrapedProductData objects
     *
     * @param root - The root element to search within (usually document.body)
     * @returns Array of scraped product data
     */
    scrapeProducts(root: Element): ScrapedProductData[];

    /**
     * Extract the product identifier from a single card element.
     *
     * This is the critical method — it tries to find a barcode or SKU
     * that we can use to look up the product in the OFF database.
     *
     * @param card - A product card DOM element
     * @returns The identifier if found, or null if we can't identify the product
     */
    extractIdentifier(card: Element): ProductIdentifier | null;

    /**
     * Get the product name from a card element.
     * @param card - A product card DOM element
     * @returns The product name as a string
     */
    extractProductName(card: Element): string;

    // ── Badge Injection ──

    /**
     * Find where to inject our nutrition badges on a product card.
     *
     * We need to insert our badges in a spot that:
     *   1. Is visible to the user
     *   2. Doesn't break the store's page layout
     *   3. Makes visual sense (near the product info)
     *
     * @param card - A product card DOM element
     * @returns The element to inject badges into, or null if no good spot
     */
    getInjectionPoint(card: Element): Element | null;

    /**
     * Check if a product card already has our badges injected.
     *
     * This prevents duplicate badges when:
     *   - The MutationObserver fires multiple times
     *   - The user navigates back to a page they already visited
     *   - The extension re-scans the page
     *
     * @param card - A product card DOM element
     * @returns true if badges are already present
     */
    hasBadges(card: Element): boolean;

    // ── Dynamic Content ──

    /**
     * Watch for new product cards appearing on the page.
     *
     * Many grocery sites use "infinite scroll" — as the user scrolls down,
     * new products are loaded dynamically. We need to detect these new
     * products and add badges to them too.
     *
     * Uses MutationObserver to watch for DOM changes.
     *
     * @param callback - Function to call when new products appear
     * @returns The MutationObserver instance (call .disconnect() to stop)
     */
    observeDynamicContent(callback: () => void): MutationObserver;

    /**
     * Watch for SPA (Single Page Application) navigation.
     *
     * Modern websites like Walmart don't do full page reloads when you
     * click a link — they update the page content dynamically (SPA).
     * We need to detect these "fake" page changes to re-scan for products.
     *
     * @param callback - Function to call with the new URL when navigation occurs
     * @returns A cleanup function — call it to stop watching
     */
    observeNavigation(callback: (newUrl: string) => void): () => void;
}
