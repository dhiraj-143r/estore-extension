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

const OFF_API_BASE = 'https://world.openfoodfacts.org';
const OFF_CA_API_BASE = 'https://ca.openfoodfacts.org';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_REQUESTS = 5;
const USER_AGENT = 'EStoreExtension/0.1.0 (browser-extension)';

let activeRequests = 0;
const requestQueue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
    if (activeRequests < MAX_CONCURRENT_REQUESTS) {
        activeRequests++;
        return;
    }

    return new Promise<void>((resolve) => {
        requestQueue.push(() => {
            activeRequests++;
            resolve();
        });
    });
}

function releaseSlot(): void {
    activeRequests--;
    if (requestQueue.length > 0) {
        const next = requestQueue.shift()!;
        next();
    }
}

/** Rate-limited fetch wrapper with timeout and error handling. */
async function offFetch<T>(url: string): Promise<T | null> {
    await acquireSlot();

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const response = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.warn(`[E-Store] API error: ${response.status} for ${url}`);
            return null;
        }

        return await response.json() as T;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            console.warn(`[E-Store] API timeout for ${url}`);
        } else {
            console.warn(`[E-Store] API request failed for ${url}:`, error);
        }
        return null;
    } finally {
        releaseSlot();
    }
}

/** Look up a single product by barcode. */
export async function fetchProductByBarcode(barcode: string): Promise<OFFProduct | null> {
    const url = `${OFF_API_BASE}/api/v0/product/${encodeURIComponent(barcode)}.json`;
    const data = await offFetch<OFFProductResponse>(url);

    if (data && data.status === 1 && data.product) {
        return data.product;
    }

    return null;
}

/** Search for products by text, filtered to Canadian results. */
export async function searchProducts(
    query: string,
    page: number = 1,
    pageSize: number = 10,
): Promise<OFFSearchResponse | null> {
    const params = new URLSearchParams({
        search_terms: query,
        json: '1',
        page: String(page),
        page_size: String(pageSize),
        countries_tags_en: 'canada',
        sort_by: 'unique_scans_n',
    });

    return offFetch<OFFSearchResponse>(`${OFF_CA_API_BASE}/cgi/search.pl?${params}`);
}

/** Convert an OFF product into the data structure needed for badge rendering. */
export function toBadgeData(product: OFFProduct): BadgeData {
    return {
        nutriScore: parseNutriScore(product.nutriscore_grade),
        novaGroup: parseNovaGroup(product.nova_group),
        ecoScore: parseEcoScore(product.ecoscore_grade),
        healthCanada: computeWarnings(product.nutriments),
        offUrl: `${OFF_API_BASE}/product/${product.code}`,
        completeness: product.completeness ?? 0,
    };
}

function parseNutriScore(grade?: string): NutriScoreGrade {
    const valid: NutriScoreGrade[] = ['a', 'b', 'c', 'd', 'e'];
    const lower = grade?.toLowerCase();
    if (lower && valid.includes(lower as NutriScoreGrade)) {
        return lower as NutriScoreGrade;
    }
    return 'unknown';
}

function parseNovaGroup(group?: number): NovaGroup | null {
    if (group && group >= 1 && group <= 4) {
        return group as NovaGroup;
    }
    return null;
}

function parseEcoScore(grade?: string): EcoScoreGrade {
    const valid: EcoScoreGrade[] = ['a', 'b', 'c', 'd', 'e', 'f'];
    const lower = grade?.toLowerCase();
    if (lower && valid.includes(lower as EcoScoreGrade)) {
        return lower as EcoScoreGrade;
    }
    return 'unknown';
}

/** Look up multiple barcodes in parallel (rate-limited). */
export async function fetchProductsBatch(barcodes: string[]): Promise<Map<string, OFFProduct>> {
    const results = new Map<string, OFFProduct>();

    const promises = barcodes.map(async (barcode) => {
        const product = await fetchProductByBarcode(barcode);
        if (product) {
            results.set(barcode, product);
        }
    });

    await Promise.allSettled(promises);
    return results;
}
