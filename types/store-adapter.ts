export type PageType = 'listing' | 'detail' | 'search' | 'cart' | 'flyer' | 'unknown';

export type IdentifierType = 'barcode' | 'sku' | 'name';

export type BadgeState = 'loading' | 'matched' | 'partial' | 'not-found' | 'error';

export interface SelectorConfig {
    productCard: string;
    productName: string;
    productBrand?: string;
    productPrice?: string;
    productImage?: string;
    productIdentifier?: string;
    identifierAttribute?: string;
    badgeInjectionPoint: string;
    productListContainer?: string;
}

export interface ProductIdentifier {
    type: IdentifierType;
    value: string;
    confidence: number;
}

export interface ScrapedProductData {
    element: Element;
    identifier: ProductIdentifier | null;
    name: string;
    brand?: string;
    price?: string;
    imageUrl?: string;
    detailUrl?: string;
}

export interface StoreConfig {
    name: string;
    slug: string;
    domain: RegExp;
    logoPath: string;
    brandColor: string;
    supportedPageTypes: PageType[];
    selectors: SelectorConfig;
}

export interface StoreAdapter {
    readonly config: StoreConfig;
    detectPageType(url: string, document: Document): PageType;
    scrapeProducts(root: Element): ScrapedProductData[];
    extractIdentifier(card: Element): ProductIdentifier | null;
    extractProductName(card: Element): string;
    getInjectionPoint(card: Element): Element | null;
    hasBadges(card: Element): boolean;
    observeDynamicContent(callback: () => void): MutationObserver;
    observeNavigation(callback: (newUrl: string) => void): () => void;
}
