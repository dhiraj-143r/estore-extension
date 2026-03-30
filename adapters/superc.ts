/**
 * ============================================================================
 * SuperC Store Adapter
 * ============================================================================
 *
 * Scrapes product data from superc.ca
 * SuperC is owned by Métro Inc. — shares most DOM patterns with Metro.
 *
 * WHY NOT JUST REUSE METRO DIRECTLY?
 * The old code delegated all methods to metroAdapter, but those methods
 * referenced metroConfig.selectors internally (via closure). If SuperC
 * ever diverges from Metro's DOM structure, those delegated methods
 * would silently use the WRONG selectors.
 *
 * Instead, this adapter has its OWN implementation that references
 * supercConfig.selectors. The logic is identical to Metro, but it
 * uses the correct config. The shared helpers (from helpers.ts) avoid
 * actual code duplication.
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
 * SuperC's CSS selectors.
 *
 * Currently identical to Metro (same parent company, same frontend).
 * Having them separate means we can update SuperC independently
 * if their site ever diverges from Metro's layout.
 */
export const supercConfig: StoreConfig = {
    name: 'SuperC',
    slug: 'superc',
    domain: /superc\.ca/,
    logoPath: 'logos/superc_logo.svg',
    brandColor: '#FF6600',
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

export const supercAdapter: StoreAdapter = {
    config: supercConfig,

    // ── Page Type Detection ────────────────────────────────────────

    /**
     * SuperC uses the same URL patterns as Metro (same parent company).
     */
    detectPageType(url: string, _document: Document): PageType {
        if (/\/search\?/.test(url)) return 'search';
        if (/\/p\//.test(url) || /\/product\//.test(url)) return 'detail';
        if (/\/cart/.test(url) || /\/panier/.test(url)) return 'cart';
        if (/\/flyer/.test(url) || /\/circulaire/.test(url)) return 'flyer';
        return 'listing';
    },

    // ── Product Scraping ───────────────────────────────────────────

    scrapeProducts(root: Element): ScrapedProductData[] {
        const cards = root.querySelectorAll(supercConfig.selectors.productCard);

        return Array.from(cards).map((card) => {
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
                brand: card.querySelector(supercConfig.selectors.productBrand ?? '')
                    ?.textContent?.trim(),
                price: card.querySelector(supercConfig.selectors.productPrice ?? '')
                    ?.textContent?.trim(),
                imageUrl: card.querySelector(supercConfig.selectors.productImage ?? '')
                    ?.getAttribute('src') ?? undefined,
                detailUrl,
            };
        });
    },

    // ── Identifier Extraction ──────────────────────────────────────

    /**
     * Same multi-strategy approach as Metro:
     *   1. JSON-LD structured data
     *   2. Meta tags
     *   3. data-product-code attribute
     */
    extractIdentifier(card: Element): ProductIdentifier | null {
        // Strategy 1: JSON-LD
        const jsonLd = extractJsonLdBarcode(card.ownerDocument);
        if (jsonLd) return jsonLd;

        // Strategy 2: Meta tags
        const meta = extractMetaBarcode(card.ownerDocument);
        if (meta) return meta;

        // Strategy 3: data-product-code
        const el = card.closest('[data-product-code]')
            ?? card.querySelector('[data-product-code]');
        const code = el?.getAttribute('data-product-code');

        if (code) {
            if (isValidBarcode(code)) {
                return { type: 'barcode', value: code, confidence: 0.9 };
            }
            return { type: 'sku', value: code, confidence: 0.3 };
        }

        return null;
    },

    // ── Name Extraction ────────────────────────────────────────────

    extractProductName(card: Element): string {
        return card.querySelector(supercConfig.selectors.productName)
            ?.textContent?.trim() ?? '';
    },

    // ── Badge Injection ────────────────────────────────────────────

    getInjectionPoint(card: Element): Element | null {
        return card.querySelector(supercConfig.selectors.badgeInjectionPoint);
    },

    hasBadges(card: Element): boolean {
        return card.hasAttribute(BADGE_MARKER);
    },

    // ── Dynamic Content Observers ──────────────────────────────────

    observeDynamicContent(callback: () => void): MutationObserver {
        return createContentObserver(
            supercConfig.selectors.productListContainer ?? 'body',
            callback,
        );
    },

    observeNavigation(callback: (newUrl: string) => void): () => void {
        return createNavigationObserver(callback);
    },
};
