/**
 * ============================================================================
 * Walmart Canada Store Adapter
 * ============================================================================
 *
 * Scrapes product data from walmart.ca
 * Walmart's site is a full SPA (React-based) with very different DOM
 * patterns from Metro/SuperC.
 *
 * IDENTIFIER EXTRACTION STRATEGY (in priority order):
 *   1. JSON-LD structured data — Walmart uses schema.org extensively for SEO
 *   2. Meta tags — <meta itemprop="gtin13"> on detail pages
 *   3. Hidden UPC spans — Some detail pages have UPC in hidden <span> elements
 *   4. data-product-id / data-item-id — Walmart's internal product identifiers
 *   5. URL-based extraction — /ip/product-name/ITEMID patterns
 *
 * KEY OBSERVATIONS FROM NUTRIBANNER:
 *   - UPC sometimes available in hidden spans on DETAIL pages only
 *   - Listing pages rarely have UPCs — only internal IDs
 *   - SPA navigation requires pushState interception (no page reloads)
 *   - Walmart's React rendering means DOM can change after initial load
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

const BADGE_MARKER = 'data-estore-badge';

// ─── Store Configuration ─────────────────────────────────────────────

/**
 * Walmart Canada's CSS selectors.
 *
 * NOTE: Walmart.ca uses data-automation attributes extensively for
 * testing, which makes them relatively stable for our scraping.
 * However, they ARE a React SPA — elements may not exist on initial
 * DOM load and could render asynchronously.
 */
export const walmartConfig: StoreConfig = {
    name: 'Walmart',
    slug: 'walmart',
    domain: /walmart\.ca/,
    logoPath: 'logos/walmart_logo.svg',
    brandColor: '#0071DC',
    supportedPageTypes: ['listing', 'search', 'detail', 'cart'],
    selectors: {
        productCard: '[data-item-id], [data-automation="product"], .product-tile',
        productName: '.ld_Ej, [data-automation="product-title"], .product-name, [data-testid="product-title"]',
        productBrand: '[data-automation="product-brand"], .product-brand',
        productPrice: '[data-automation="current-price"], .price-current, [data-testid="price"]',
        productImage: 'img[srcset], [data-automation="product-image"] img, .product-image img, img[data-testid="product-image"]',
        productIdentifier: '.mv0 > span, [data-testid="upc"]',
        badgeInjectionPoint: '[data-automation="product-price-section"], .product-tile__bottom, [data-testid="price-section"]',
        productListContainer: '[data-automation="product-list"], .search-result-gridview, [data-testid="product-grid"], [data-testid="item-stack"]',
    },
};

// ─── Adapter Implementation ──────────────────────────────────────────

export const walmartAdapter: StoreAdapter = {
    config: walmartConfig,

    // ── Page Type Detection ────────────────────────────────────────

    /**
     * Walmart's URL patterns:
     *   - Search:  /search?q=nutella
     *   - Detail:  /ip/nutella-750g/12345678  (note: /ip/ = "item page")
     *   - Cart:    /cart
     *   - Flyer:   /flyer
     *   - Listing: /browse/category-name/12345 or homepage
     */
    detectPageType(url: string, _document: Document): PageType {
        if (/\/search\?/.test(url)) return 'search';
        if (/\/ip\//.test(url) || /\/product\//.test(url)) return 'detail';
        if (/\/cart/.test(url)) return 'cart';
        if (/\/flyer/.test(url)) return 'flyer';
        return 'listing';
    },

    // ── Product Scraping ───────────────────────────────────────────

    scrapeProducts(root: Element): ScrapedProductData[] {
        const cards = root.querySelectorAll(walmartConfig.selectors.productCard);

        return Array.from(cards).map((card) => {
            // Walmart product links follow the /ip/product-name/ID pattern
            const detailLink = card.querySelector('a[href*="/ip/"]')
                ?? card.querySelector('a[data-automation="product-title"]')
                ?? card.closest('a[href*="/ip/"]');
            const detailUrl = detailLink?.getAttribute('href')
                ? new URL(detailLink.getAttribute('href')!, window.location.origin).href
                : undefined;

            return {
                element: card,
                identifier: this.extractIdentifier(card),
                name: this.extractProductName(card),
                brand: card.querySelector(walmartConfig.selectors.productBrand ?? '')
                    ?.textContent?.trim(),
                price: card.querySelector(walmartConfig.selectors.productPrice ?? '')
                    ?.textContent?.trim(),
                imageUrl: card.querySelector(walmartConfig.selectors.productImage ?? '')
                    ?.getAttribute('src') ?? undefined,
                detailUrl,
            };
        });
    },

    // ── Identifier Extraction ──────────────────────────────────────

    /**
     * Walmart uses a multi-layered strategy for barcode discovery.
     */
    extractIdentifier(card: Element): ProductIdentifier | null {
        // Strategy 1: JSON-LD
        const jsonLd = extractJsonLdBarcode(card.ownerDocument);
        if (jsonLd) return jsonLd;

        // Strategy 2: Meta tags
        const meta = extractMetaBarcode(card.ownerDocument);
        if (meta) return meta;

        // Strategy 3: Hidden UPC spans
        const upcSpan = card.ownerDocument.querySelector(walmartConfig.selectors.productIdentifier ?? '');
        const upcText = upcSpan?.textContent?.trim();
        if (upcText && isValidBarcode(upcText)) {
            return { type: 'barcode', value: upcText, confidence: 0.95 };
        }

        // Strategy 4: data-item-id attribute wrapper
        const itemId = card.getAttribute('data-item-id');
        if (itemId) {
            return { type: 'sku', value: itemId, confidence: 0.4 };
        }
        
        // Strategy 5: URL-based item ID
        const link = card.querySelector('a[href*="/ip/"]');
        const href = link?.getAttribute('href') ?? '';
        if (href) {
            const match = href.match(/\/ip\/[^/]+\/(\d+)/);
            if (match) {
                return { type: 'sku', value: match[1], confidence: 0.2 };
            }
        }

        return null;
    },

    // ── Name Extraction ────────────────────────────────────────────

    extractProductName(card: Element): string {
        // Find the title span directly using the configured selector
        const titleSpan = card.querySelector(walmartConfig.selectors.productName);
        if (titleSpan?.textContent) {
            return titleSpan.textContent.trim();
        }

        // Fallback: Walmart often puts the title in a span inside an element with data-automation-id="product-title"
        const titleContainer = card.querySelector('[data-automation-id="product-title"]');
        if (titleContainer) {
            // Get the first span with actual text context
            const spans = Array.from(titleContainer.querySelectorAll('span'));
            for (const span of spans) {
                const text = span.textContent?.trim();
                if (text && text.length > 5) { // Ensure it's not a tiny formatting span
                    return text;
                }
            }
            if (titleContainer.textContent) {
                return titleContainer.textContent.trim();
            }
        }

        return '';
    },

    // ── Badge Injection ────────────────────────────────────────────

    getInjectionPoint(card: Element): Element | null {
        return card.querySelector(walmartConfig.selectors.badgeInjectionPoint);
    },

    hasBadges(card: Element): boolean {
        return card.hasAttribute(BADGE_MARKER);
    },

    // ── Dynamic Content Observers ──────────────────────────────────

    /**
     * Walmart is a React SPA — content is VERY dynamic.
     * Products can appear/disappear as React re-renders the virtual DOM.
     */
    observeDynamicContent(callback: () => void): MutationObserver {
        return createContentObserver(
            walmartConfig.selectors.productListContainer ?? 'body',
            callback,
        );
    },

    /**
     * Walmart's SPA navigation — uses pushState for all page transitions.
     * This replaces Nutribanner's problematic `window.location.reload()` hack.
     */
    observeNavigation(callback: (newUrl: string) => void): () => void {
        return createNavigationObserver(callback);
    },
};
