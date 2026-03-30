import { getAdapterForUrl } from '@/adapters';
import { sendToBackground } from '@/types/messages';
import type { MatchProductResponse } from '@/types/messages';
import type { StoreAdapter, ScrapedProductData } from '@/types';
import { createBadgeContainer } from '@/components/badges';
import './badges.css';

let matchedProductCount = 0;
let totalProductCount = 0;
let navigationCleanup: (() => void) | null = null;

export default defineContentScript({
  matches: [
    '*://*.metro.ca/*',
    '*://*.superc.ca/*',
    '*://*.walmart.ca/*',
  ],
  runAt: 'document_idle',

  async main() {
    let extensionEnabled = true;
    let badgeSettings: Record<string, boolean> = {};
    let storeSettings: Record<string, { enabled: boolean }> = {};

    try {
      const stored = await browser.storage.local.get('estore_settings');
      const settings = stored['estore_settings'] as {
        enabled?: boolean;
        stores?: Record<string, { enabled: boolean }>;
        badges?: Record<string, boolean>;
      } | undefined;

      if (settings) {
        extensionEnabled = settings.enabled ?? true;
        storeSettings   = settings.stores  ?? {};
        badgeSettings   = settings.badges  ?? {};
      }
    } catch {
      // Fall through with defaults
    }

    if (!extensionEnabled) return;

    const adapter = getAdapterForUrl(window.location.href);
    if (!adapter) return;

    const storeSlug = adapter.config.slug;
    const storeEnabled = storeSettings[storeSlug]?.enabled ?? true;
    if (!storeEnabled) return;

    const pageType = adapter.detectPageType(window.location.href, document);

    await scanAndBadgeProducts(adapter, storeSlug);
    setupDynamicContentObserver(adapter, storeSlug);
    setupNavigationObserver(adapter, storeSlug);
    setupSettingsChangeListener(adapter, storeSlug);
  },
});

async function scanAndBadgeProducts(
  adapter: StoreAdapter,
  storeSlug: string,
): Promise<void> {
  const products = adapter.scrapeProducts(document.body);
  if (products.length === 0) return;

  const newProducts = products.filter((p) => !adapter.hasBadges(p.element));
  if (newProducts.length === 0) return;

  const BATCH_SIZE = 5;
  let matchedInBatch = 0;

  for (let i = 0; i < newProducts.length; i += BATCH_SIZE) {
    const batch = newProducts.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((product) => processProduct(product, adapter, storeSlug)),
    );
    matchedInBatch += results.filter(
      (r) => r.status === 'fulfilled' && r.value === true,
    ).length;
  }

  totalProductCount += newProducts.length;
  matchedProductCount += matchedInBatch;
  reportProductCounts();
}

function reportProductCounts(): void {
  sendToBackground({
    type: 'PRODUCTS_PROCESSED',
    matchedCount: matchedProductCount,
    totalCount: totalProductCount,
  }).catch(() => {});
}

async function processProduct(
  product: ScrapedProductData,
  adapter: StoreAdapter,
  storeSlug: string,
): Promise<boolean> {
  try {
    const response = await sendToBackground<MatchProductResponse>({
      type: 'MATCH_PRODUCT',
      identifier: product.identifier,
      name: product.name,
      brand: product.brand,
      storeSlug,
    });

    if (response.success && response.badgeData) {
      injectBadges(product.element, adapter, response.badgeData, response.match?.confidence ?? 0);
      return true;
    } else {
      markAsBadged(product.element);
      return false;
    }
  } catch {
    return false;
  }
}

function injectBadges(
  cardElement: Element,
  adapter: StoreAdapter,
  badgeData: import('@/types').BadgeData,
  confidence: number,
): void {
  let injectionPoint = adapter.getInjectionPoint(cardElement);
  if (!injectionPoint) {
    injectionPoint = cardElement as Element;
  }

  const container = createBadgeContainer(badgeData, confidence);
  injectionPoint.appendChild(container);
  markAsBadged(cardElement);
}

function markAsBadged(element: Element): void {
  element.setAttribute('data-estore-badge', 'true');
}

function removeAllBadges(): void {
  document.querySelectorAll('.estore-badge-container').forEach((c) => c.remove());
  document.querySelectorAll('[data-estore-badge]').forEach((el) => el.removeAttribute('data-estore-badge'));

  matchedProductCount = 0;
  totalProductCount = 0;
  reportProductCounts();
}

function setupDynamicContentObserver(adapter: StoreAdapter, storeSlug: string): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  adapter.observeDynamicContent(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      await scanAndBadgeProducts(adapter, storeSlug);
    }, 500);
  });
}

function setupNavigationObserver(adapter: StoreAdapter, storeSlug: string): void {
  navigationCleanup = adapter.observeNavigation(async (newUrl) => {
    matchedProductCount = 0;
    totalProductCount = 0;

    setTimeout(async () => {
      await scanAndBadgeProducts(adapter, storeSlug);
    }, 1000);
  });
}

function setupSettingsChangeListener(adapter: StoreAdapter, storeSlug: string): void {
  browser.runtime.onMessage.addListener(
    (message: { type: string; settings?: { enabled: boolean; stores: Record<string, { enabled: boolean }> } }) => {
      if (message.type !== 'SETTINGS_CHANGED') return;

      const settings = message.settings;
      if (!settings) return;

      if (!settings.enabled) {
        removeAllBadges();
        return;
      }

      const storeEnabled = settings.stores[storeSlug]?.enabled ?? true;
      if (!storeEnabled) {
        removeAllBadges();
      } else {
        scanAndBadgeProducts(adapter, storeSlug);
      }
    },
  );
}
