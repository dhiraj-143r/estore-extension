/**
 * ============================================================================
 * Metro Store Adapter
 * ============================================================================
 *
 * Scrapes product data from metro.ca
 * Metro is owned by Métro Inc. (Quebec-based grocery chain).
 *
 * IDENTIFIER EXTRACTION STRATEGY (in priority order):
 *   1. JSON-LD structured data — Most reliable, contains real GTIN barcodes
 *   2. Meta tags — <meta itemprop="gtin13"> etc.
 *   3. data-product-code attribute — Metro's internal SKU (NOT a UPC!)
 *   4. Product name fallback — Least reliable, text search only
 *
 * KEY INSIGHT FROM NUTRIBANNER:
 * Metro's `data-product-code` is their internal product code (like "226690"),
 * NOT a standard UPC/EAN barcode. We MUST look elsewhere first for real barcodes.
 * ============================================================================
 */
import type {
    StoreAdapter,
    StoreConfig,
    ScrapedProductData,
    ProductIdentifier,
    PageType,
} from '@/types';
import {
    extractJsonLdBarcode,
    extractMetaBarcode,
    isValidBarcode,
    createNavigationObserver,
    createContentObserver,
} from './helpers';

// ─── Constants ───────────────────────────────────────────────────────

/** Data attribute used to mark product cards that already have badges */
const BADGE_MARKER = 'data-estore-badge';

// ─── Store Configuration ─────────────────────────────────────────────

/**
 * Metro's CSS selectors and metadata.
 *
 * NOTE ON SELECTORS:
 * Metro has gone through multiple frontend redesigns. We include
 * selectors for BOTH the old and new layouts separated by commas:
 *   - Old: .product-tile, .product-name, .price-product
 *   - New: [data-product-code], .head__title, .pricing__sale-price
 *
 * If Metro redesigns again, these selectors will need updating.
 * Check metro.ca with DevTools to find the current class names.
 */
export const metroConfig: StoreConfig = {
    name: 'Metro',
    slug: 'metro',
    domain: /metro\.ca/,
    logoPath: 'logos/metro_logo.svg',
    brandColor: '#E31837',
    supportedPageTypes: ['listing', 'search', 'detail', 'cart'],
    selectors: {
        productCard: '.product-tile, [data-product-code]',
        productName: '.product-name, .head__title',
        productBrand: '.product-brand, .head__brand',
        productPrice: '.price-product, .pricing__sale-price',
        productImage: '.product-image img, .tile__product-image img',
        productIdentifier: '[data-product-code]',
        identifierAttribute: 'data-product-code',
        badgeInjectionPoint: '.product-tile__bottom, .tile__details',
        productListContainer: '.products-search--grid, .product-list',
    },
};

// ─── Adapter Implementation ──────────────────────────────────────────

export const metroAdapter: StoreAdapter = {
    config: metroConfig,

    // ── Page Type Detection ────────────────────────────────────────

    /**
     * Determine what type of page the user is on.
     *
     * Metro's URL patterns:
     *   - Search:  /search?term=nutella
     *   - Detail:  /en/online-grocery/product-name/p/123456
     *   - Cart:    /cart or /panier (French)
     *   - Flyer:   /flyer or /circulaire (French)
     *   - Listing: everything else (categories, homepage)
     */
    detectPageType(url: string, _document: Document): PageType {
        if (/\/search\?/.test(url)) return 'search';
        if (/\/p\//.test(url) || /\/product\//.test(url)) return 'detail';
        if (/\/cart/.test(url) || /\/panier/.test(url)) return 'cart';
        if (/\/flyer/.test(url) || /\/circulaire/.test(url)) return 'flyer';
        return 'listing';
    },

    // ── Product Scraping ───────────────────────────────────────────

    /**
     * Find and scrape all product cards on the current page.
     *
     * For each card, we extract:
     *   - Product identifier (barcode/SKU via multi-strategy extraction)
     *   - Name, brand, price, image
     *   - Detail page URL (for future barcode extraction from detail pages)
     */
    scrapeProducts(root: Element): ScrapedProductData[] {
        const cards = root.querySelectorAll(metroConfig.selectors.productCard);

        return Array.from(cards).map((card) => {
            // Try to find the product detail page link
            const detailLink = card.querySelector('a[href*="/p/"]')
                ?? card.querySelector('a.product-name')
                ?? card.closest('a[href*="/p/"]');
            const detailUrl = detailLink?.getAttribute('href')
                ? new URL(detailLink.getAttribute('href')!, window.location.origin).href
                : undefined;

            return {
                element: card,
                identifier: this.extractIdentifier(card),
                name: this.extractProductName(card),
                brand: card.querySelector(metroConfig.selectors.productBrand ?? '')
                    ?.textContent?.trim(),
                price: card.querySelector(metroConfig.selectors.productPrice ?? '')
                    ?.textContent?.trim(),
                imageUrl: card.querySelector(metroConfig.selectors.productImage ?? '')
                    ?.getAttribute('src') ?? undefined,
                detailUrl,
            };
        });
    },

    // ── Identifier Extraction ──────────────────────────────────────

    /**
     * Extract the product identifier from a product card.
     *
     * MULTI-STRATEGY APPROACH (in order of reliability):
     *
     *   Strategy 1: JSON-LD structured data
     *     → <script type="application/ld+json">{"gtin13": "3017620422003"}</script>
     *     → Confidence: 0.95 (structured data is very reliable)
     *
     *   Strategy 2: Meta tags
     *     → <meta itemprop="gtin13" content="3017620422003">
     *     → Confidence: 0.95
     *
     *   Strategy 3: data-product-code attribute
     *     → <div data-product-code="3017620422003">
     *     → If 8-14 digits: barcode (confidence 0.9)
     *     → Otherwise: internal SKU (confidence 0.3)
     *
     *   Strategy 4: Name fallback
     *     → Product name is used by the text search matcher
     *     → Confidence: 0.1
     *
     * @param card - The product card DOM element
     * @returns ProductIdentifier or null
     */
    extractIdentifier(card: Element): ProductIdentifier | null {
        // ── Strategy 1: JSON-LD structured data ──
        // Only works on detail pages (listing pages don't have per-card JSON-LD)
        const jsonLd = extractJsonLdBarcode(card.ownerDocument);
        if (jsonLd) {
            console.log(`[E-Store Metro] Found barcode via JSON-LD: ${jsonLd.value}`);
            return jsonLd;
        }

        // ── Strategy 2: Meta tag barcodes ──
        const meta = extractMetaBarcode(card.ownerDocument);
        if (meta) {
            console.log(`[E-Store Metro] Found barcode via meta tag: ${meta.value}`);
            return meta;
        }

        // ── Strategy 3: data-product-code attribute ──
        const el = card.closest('[data-product-code]')
            ?? card.querySelector('[data-product-code]');
        const code = el?.getAttribute('data-product-code');

        if (code) {
            // Metro's data-product-code is usually an internal SKU (6 digits).
            // But sometimes it IS a real barcode (8-14 digits).
            if (isValidBarcode(code)) {
                return {
                    type: 'barcode',
                    value: code,
                    confidence: 0.9, // Likely a real barcode
                };
            }

            // Not a barcode — treat as internal SKU
            return {
                type: 'sku',
                value: code,
                confidence: 0.3, // Low confidence — SKU won't match OFF
            };
        }

        // ── No identifier found ──
        return null;
    },

    // ── Name Extraction ────────────────────────────────────────────

    extractProductName(card: Element): string {
        return card.querySelector(metroConfig.selectors.productName)
            ?.textContent?.trim() ?? '';
    },

    // ── Badge Injection ────────────────────────────────────────────

    getInjectionPoint(card: Element): Element | null {
        return card.querySelector(metroConfig.selectors.badgeInjectionPoint);
    },

    hasBadges(card: Element): boolean {
        return card.hasAttribute(BADGE_MARKER);
    },

    // ── Dynamic Content Observers ──────────────────────────────────

    /**
     * Watch for new products added by infinite scroll or AJAX updates.
     * Uses the shared createContentObserver helper.
     */
    observeDynamicContent(callback: () => void): MutationObserver {
        return createContentObserver(
            metroConfig.selectors.productListContainer ?? 'body',
            callback,
        );
    },

    /**
     * Watch for SPA navigation (URL changes without page reload).
     * Uses the shared createNavigationObserver helper.
     */
    observeNavigation(callback: (newUrl: string) => void): () => void {
        return createNavigationObserver(callback);
    },
};
