import type { ProductIdentifier } from '@/types';

/** Validate that a string matches a UPC/EAN barcode format (8–14 digits). */
export function isValidBarcode(value: string): boolean {
    return /^\d{8,14}$/.test(value.trim());
}

/** Extract a barcode from JSON-LD structured data embedded in the page. */
export function extractJsonLdBarcode(doc: Document): ProductIdentifier | null {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');

    for (const script of scripts) {
        try {
            const data = JSON.parse(script.textContent ?? '');
            const items = Array.isArray(data) ? data : [data];

            for (const item of items) {
                const barcode = findGtinInJsonLd(item);
                if (barcode) {
                    return { type: 'barcode', value: barcode, confidence: 0.95 };
                }
            }
        } catch {
            continue;
        }
    }

    return null;
}

/** Recursively search a JSON-LD object for GTIN barcode fields. */
function findGtinInJsonLd(obj: Record<string, unknown>): string | null {
    const gtinFields = ['gtin13', 'gtin12', 'gtin14', 'gtin', 'gtin8'];

    for (const field of gtinFields) {
        const value = obj[field];
        if (typeof value === 'string' && isValidBarcode(value)) {
            return value.trim();
        }
    }

    if (obj.offers) {
        const offers = Array.isArray(obj.offers) ? obj.offers : [obj.offers];
        for (const offer of offers) {
            if (typeof offer === 'object' && offer !== null) {
                const result = findGtinInJsonLd(offer as Record<string, unknown>);
                if (result) return result;
            }
        }
    }

    if (Array.isArray(obj['@graph'])) {
        for (const item of obj['@graph']) {
            if (typeof item === 'object' && item !== null) {
                const result = findGtinInJsonLd(item as Record<string, unknown>);
                if (result) return result;
            }
        }
    }

    return null;
}

/** Extract a barcode from HTML meta tags (itemprop, Open Graph, etc.). */
export function extractMetaBarcode(doc: Document): ProductIdentifier | null {
    const metaSelectors = [
        'meta[itemprop="gtin13"]',
        'meta[itemprop="gtin12"]',
        'meta[itemprop="gtin"]',
        'meta[property="product:upc"]',
        'meta[property="og:upc"]',
        'meta[name="upc"]',
        'meta[name="gtin"]',
    ];

    for (const selector of metaSelectors) {
        const meta = doc.querySelector(selector);
        const content = meta?.getAttribute('content');

        if (content && isValidBarcode(content)) {
            return { type: 'barcode', value: content.trim(), confidence: 0.95 };
        }
    }

    return null;
}

/**
 * Intercept SPA navigation events (pushState, replaceState, popstate)
 * and invoke a callback when the URL changes.
 */
export function createNavigationObserver(
    callback: (newUrl: string) => void,
): () => void {
    let lastUrl = window.location.href;

    const check = () => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            callback(lastUrl);
        }
    };

    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);

    history.pushState = (...args) => { origPush(...args); check(); };
    history.replaceState = (...args) => { origReplace(...args); check(); };
    window.addEventListener('popstate', check);

    return () => {
        history.pushState = origPush;
        history.replaceState = origReplace;
        window.removeEventListener('popstate', check);
    };
}

/** Set up a MutationObserver that fires when new nodes are added. */
export function createContentObserver(
    containerSelector: string,
    callback: () => void,
): MutationObserver {
    const container = document.querySelector(containerSelector) ?? document.body;

    const observer = new MutationObserver((mutations) => {
        const hasNewNodes = mutations.some((m) => m.addedNodes.length > 0);
        if (hasNewNodes) callback();
    });

    observer.observe(container, { childList: true, subtree: true });
    return observer;
}
