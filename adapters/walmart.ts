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

const BADGE_MARKER = 'data-estore-badge';

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

export const walmartAdapter: StoreAdapter = {
    config: walmartConfig,

    detectPageType(url: string, _document: Document): PageType {
        if (/\/search\?/.test(url)) return 'search';
        if (/\/ip\//.test(url) || /\/product\//.test(url)) return 'detail';
        if (/\/cart/.test(url)) return 'cart';
        if (/\/flyer/.test(url)) return 'flyer';
        return 'listing';
    },

    scrapeProducts(root: Element): ScrapedProductData[] {
        const cards = root.querySelectorAll(walmartConfig.selectors.productCard);

        return Array.from(cards).map((card) => {
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

    /**
     * Multi-strategy identifier extraction:
     * JSON-LD → meta tags → hidden UPC spans → data-item-id → URL-based item ID.
     */
    extractIdentifier(card: Element): ProductIdentifier | null {
        const jsonLd = extractJsonLdBarcode(card.ownerDocument);
        if (jsonLd) return jsonLd;

        const meta = extractMetaBarcode(card.ownerDocument);
        if (meta) return meta;

        const upcSpan = card.ownerDocument.querySelector(walmartConfig.selectors.productIdentifier ?? '');
        const upcText = upcSpan?.textContent?.trim();
        if (upcText && isValidBarcode(upcText)) {
            return { type: 'barcode', value: upcText, confidence: 0.95 };
        }

        const itemId = card.getAttribute('data-item-id');
        if (itemId) {
            return { type: 'sku', value: itemId, confidence: 0.4 };
        }

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

    extractProductName(card: Element): string {
        const titleSpan = card.querySelector(walmartConfig.selectors.productName);
        if (titleSpan?.textContent) {
            return titleSpan.textContent.trim();
        }

        const titleContainer = card.querySelector('[data-automation-id="product-title"]');
        if (titleContainer) {
            const spans = Array.from(titleContainer.querySelectorAll('span'));
            for (const span of spans) {
                const text = span.textContent?.trim();
                if (text && text.length > 5) {
                    return text;
                }
            }
            if (titleContainer.textContent) {
                return titleContainer.textContent.trim();
            }
        }

        return '';
    },

    getInjectionPoint(card: Element): Element | null {
        return card.querySelector(walmartConfig.selectors.badgeInjectionPoint);
    },

    hasBadges(card: Element): boolean {
        return card.hasAttribute(BADGE_MARKER);
    },

    observeDynamicContent(callback: () => void): MutationObserver {
        return createContentObserver(
            walmartConfig.selectors.productListContainer ?? 'body',
            callback,
        );
    },

    observeNavigation(callback: (newUrl: string) => void): () => void {
        return createNavigationObserver(callback);
    },
};
