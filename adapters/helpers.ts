/**
 * ============================================================================
 * Adapter Helpers — Shared Utilities for All Store Adapters
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * Contains reusable functions that multiple store adapters need.
 * Instead of duplicating logic in metro.ts, superc.ts, and walmart.ts,
 * we centralize it here.
 *
 * SHARED CAPABILITIES:
 *   - JSON-LD barcode extraction (structured data in <script> tags)
 *   - Meta tag barcode extraction (microdata / Open Graph)
 *   - SPA navigation observer (pushState / replaceState interception)
 *   - MutationObserver factory (infinite scroll detection)
 * ============================================================================
 */

import type { ProductIdentifier } from '@/types';

// ─── Barcode Validation ──────────────────────────────────────────────

/**
 * Check if a string looks like a valid UPC/EAN barcode.
 *
 * Valid barcodes are 8-14 digit numbers:
 *   - UPC-A: 12 digits (North American standard)
 *   - EAN-13: 13 digits (international standard)
 *   - EAN-8: 8 digits (compact version)
 *   - ITF-14: 14 digits (outer packaging)
 *
 * @param value - The string to check
 * @returns true if this looks like a valid barcode
 */
export function isValidBarcode(value: string): boolean {
    return /^\d{8,14}$/.test(value.trim());
}

// ─── JSON-LD Structured Data Extraction ──────────────────────────────

/**
 * Extract a barcode from JSON-LD structured data on the page.
 *
 * WHAT IS JSON-LD?
 * JSON-LD (JSON for Linking Data) is a standard way for websites to embed
 * structured data about their products. It looks like this in the HTML:
 *
 *   <script type="application/ld+json">
 *   {
 *     "@type": "Product",
 *     "name": "Nutella 750g",
 *     "gtin13": "3017620422003",
 *     "brand": { "name": "Ferrero" }
 *   }
 *   </script>
 *
 * WHY THIS IS VALUABLE:
 * This is the MOST RELIABLE source of barcode data (after explicit DOM attributes).
 * Google requires retailers to include valid GTINs for product search indexing,
 * so many grocery sites include them even if they're not visible in the UI.
 *
 * @param doc - The document to search (usually `document`)
 * @returns A ProductIdentifier if a barcode was found, or null
 */
export function extractJsonLdBarcode(doc: Document): ProductIdentifier | null {
    // Find all JSON-LD script tags on the page
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');

    for (const script of scripts) {
        try {
            const data = JSON.parse(script.textContent ?? '');

            // JSON-LD can be a single object or an array
            const items = Array.isArray(data) ? data : [data];

            for (const item of items) {
                const barcode = findGtinInJsonLd(item);
                if (barcode) {
                    return {
                        type: 'barcode',
                        value: barcode,
                        confidence: 0.95, // Very high — structured data is reliable
                    };
                }
            }
        } catch {
            // Malformed JSON — skip this script tag
            continue;
        }
    }

    return null;
}

/**
 * Recursively search a JSON-LD object for GTIN/barcode fields.
 *
 * Schema.org uses several field names for barcodes:
 *   - gtin13 (EAN-13, most common internationally)
 *   - gtin12 (UPC-A, common in North America)
 *   - gtin14 (ITF-14, for outer packaging)
 *   - gtin   (generic GTIN field)
 *   - gtin8  (EAN-8, compact)
 *   - productID (sometimes used for barcodes)
 *
 * @param obj - A parsed JSON-LD object
 * @returns The barcode string if found, or null
 */
function findGtinInJsonLd(obj: Record<string, unknown>): string | null {
    // List of Schema.org fields that might contain a barcode
    const gtinFields = ['gtin13', 'gtin12', 'gtin14', 'gtin', 'gtin8'];

    for (const field of gtinFields) {
        const value = obj[field];
        if (typeof value === 'string' && isValidBarcode(value)) {
            return value.trim();
        }
    }

    // Check nested "offers" (Schema.org often puts gtin inside offers)
    if (obj.offers) {
        const offers = Array.isArray(obj.offers) ? obj.offers : [obj.offers];
        for (const offer of offers) {
            if (typeof offer === 'object' && offer !== null) {
                const result = findGtinInJsonLd(offer as Record<string, unknown>);
                if (result) return result;
            }
        }
    }

    // Check @graph array (some pages wrap everything in {"@graph": [...]})
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

// ─── Meta Tag Extraction ─────────────────────────────────────────────

/**
 * Extract a barcode from HTML meta tags.
 *
 * Some stores embed barcode data in meta tags for SEO/microdata:
 *   <meta itemprop="gtin13" content="3017620422003">
 *   <meta property="product:upc" content="3017620422003">
 *   <meta name="upc" content="3017620422003">
 *
 * @param doc - The document to search
 * @returns A ProductIdentifier if a barcode was found, or null
 */
export function extractMetaBarcode(doc: Document): ProductIdentifier | null {
    // Selectors for meta tags that might contain barcode data
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
            return {
                type: 'barcode',
                value: content.trim(),
                confidence: 0.95,
            };
        }
    }

    return null;
}

// ─── SPA Navigation Observer ─────────────────────────────────────────

/**
 * Create a reusable SPA navigation observer.
 *
 * Modern grocery sites (especially Walmart) use client-side routing.
 * When the user clicks a link, the URL changes but the page doesn't
 * actually reload. This function detects those "fake" navigations.
 *
 * HOW IT WORKS:
 * We monkey-patch `history.pushState` and `history.replaceState` to
 * intercept URL changes, and also listen for the `popstate` event
 * (back/forward button).
 *
 * @param callback - Called with the new URL when navigation occurs
 * @returns A cleanup function to stop observing
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

    // Save original methods and monkey-patch
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);

    history.pushState = (...args) => { origPush(...args); check(); };
    history.replaceState = (...args) => { origReplace(...args); check(); };
    window.addEventListener('popstate', check);

    // Return cleanup function
    return () => {
        history.pushState = origPush;
        history.replaceState = origReplace;
        window.removeEventListener('popstate', check);
    };
}

// ─── MutationObserver Factory ────────────────────────────────────────

/**
 * Create a MutationObserver for detecting new product cards.
 *
 * Watches a container element for new child nodes being added
 * (infinite scroll, lazy loading, AJAX content updates).
 *
 * @param containerSelector - CSS selector for the container to watch
 * @param callback - Called when new nodes are added
 * @returns The MutationObserver instance
 */
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
