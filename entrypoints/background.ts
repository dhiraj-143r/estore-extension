import type {
  BackgroundMessage,
  LookupBarcodeResponse,
  MatchProductResponse,
  GetSettingsResponse,
  CacheStatsResponse,
  ClearCacheResponse,
  BatchLookupResponse,
  ProductsProcessedResponse,
} from '@/types/messages';
import type { ProductIdentifier, ScrapedProductData, OFFProduct } from '@/types';
import { fetchProductByBarcode, searchProducts, toBadgeData } from '@/api/off-client';
import { matchProduct } from '@/utils/matcher';
import { purgeExpiredCache, getCacheStats, clearAllCache } from '@/utils/cache';
import { loadSettings } from '@/utils/storage';

const CACHE_CLEANUP_ALARM = 'estore-cache-cleanup';
const CACHE_CLEANUP_INTERVAL_MINUTES = 360;
const KEEPALIVE_ALARM = 'estore-keepalive';
const KEEPALIVE_INTERVAL_MINUTES = 0.5;

const inFlightRequests = new Map<string, Promise<OFFProduct | null>>();

async function deduplicatedBarcodeLookup(barcode: string): Promise<OFFProduct | null> {
  const existing = inFlightRequests.get(barcode);
  if (existing) return existing;

  const promise = fetchProductByBarcode(barcode).finally(() => {
    inFlightRequests.delete(barcode);
  });

  inFlightRequests.set(barcode, promise);
  return promise;
}

async function updateBadgeForTab(
  tabId: number,
  matchedCount: number,
  totalCount: number,
): Promise<void> {
  try {
    if (matchedCount > 0) {
      await browser.action.setBadgeText({ text: String(matchedCount), tabId });

      const ratio = matchedCount / totalCount;
      let color: string;
      if (ratio >= 0.7) color = '#4CAF50';
      else if (ratio >= 0.3) color = '#FF9800';
      else color = '#F44336';

      await browser.action.setBadgeBackgroundColor({ color, tabId });
    } else {
      await browser.action.setBadgeText({ text: '', tabId });
    }
  } catch {
    // Tab may have been closed
  }
}

async function startKeepAlive(): Promise<void> {
  await browser.alarms.create(KEEPALIVE_ALARM, {
    periodInMinutes: KEEPALIVE_INTERVAL_MINUTES,
  });
}

async function stopKeepAlive(): Promise<void> {
  await browser.alarms.clear(KEEPALIVE_ALARM);
}

async function broadcastSettingsChange(settings: unknown): Promise<void> {
  try {
    const tabs = await browser.tabs.query({
      url: ['*://*.metro.ca/*', '*://*.superc.ca/*', '*://*.walmart.ca/*'],
    });

    for (const tab of tabs) {
      if (tab.id) {
        browser.tabs.sendMessage(tab.id, {
          type: 'SETTINGS_CHANGED',
          settings,
        }).catch(() => {});
      }
    }
  } catch {
    // Broadcast failure is non-critical
  }
}

export default defineBackground(() => {
  console.log('[E-Store] Background service worker started');

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'update') {
      purgeExpiredCache().catch(console.error);
    }
    setupCacheCleanupAlarm();
  });

  purgeExpiredCache().catch(console.error);

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CACHE_CLEANUP_ALARM) {
      purgeExpiredCache().catch(console.error);
    }
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['estore_settings']) {
      const newSettings = changes['estore_settings'].newValue;
      if (newSettings) {
        broadcastSettingsChange(newSettings);
      }
    }
  });

  browser.runtime.onMessage.addListener(
    (
      message: BackgroundMessage,
      sender: browser.Runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ) => {
      handleMessage(message, sender)
        .then(sendResponse)
        .catch((error) => {
          console.error('[E-Store] Message handler error:', message.type, error);
          sendResponse({ success: false, error: String(error) });
        });

      return true;
    },
  );
});

async function setupCacheCleanupAlarm(): Promise<void> {
  const existing = await browser.alarms.get(CACHE_CLEANUP_ALARM);
  if (!existing) {
    await browser.alarms.create(CACHE_CLEANUP_ALARM, {
      delayInMinutes: CACHE_CLEANUP_INTERVAL_MINUTES,
      periodInMinutes: CACHE_CLEANUP_INTERVAL_MINUTES,
    });
  }
}

async function handleMessage(
  message: BackgroundMessage,
  sender: browser.Runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'LOOKUP_BARCODE':
      return handleLookupBarcode(message.barcode);
    case 'SEARCH_PRODUCT':
      return handleSearchProduct(message.name, message.brand, message.storeSlug);
    case 'MATCH_PRODUCT':
      return handleMatchProduct(message);
    case 'BATCH_LOOKUP':
      return handleBatchLookup(message.barcodes);
    case 'PRODUCTS_PROCESSED':
      return handleProductsProcessed(sender.tab?.id, message.matchedCount, message.totalCount);
    case 'SETTINGS_CHANGED':
      await broadcastSettingsChange(message.settings);
      return { success: true };
    case 'GET_SETTINGS':
      return handleGetSettings();
    case 'GET_CACHE_STATS':
      return handleGetCacheStats();
    case 'CLEAR_CACHE':
      return handleClearCache();
    default:
      return { success: false, error: 'Unknown message type' };
  }
}

async function handleLookupBarcode(barcode: string): Promise<LookupBarcodeResponse> {
  try {
    const product = await deduplicatedBarcodeLookup(barcode);
    if (product) {
      return { success: true, product, badgeData: toBadgeData(product) };
    }
    return { success: false, error: `Barcode ${barcode} not found in Open Food Facts` };
  } catch (error) {
    return { success: false, error: `Lookup failed: ${String(error)}` };
  }
}

async function handleSearchProduct(
  name: string,
  brand: string | undefined,
  storeSlug: string,
): Promise<MatchProductResponse> {
  try {
    const product: ScrapedProductData = {
      element: null as unknown as Element,
      identifier: { type: 'name', value: name, confidence: 0.1 },
      name,
      brand,
    };

    const match = await matchProduct(product, storeSlug);
    if (match) {
      return { success: true, match, badgeData: toBadgeData(match.product) };
    }
    return { success: false, error: `No match found for "${name}"` };
  } catch (error) {
    return { success: false, error: `Search failed: ${String(error)}` };
  }
}

async function handleMatchProduct(
  message: {
    identifier: { type: 'barcode' | 'sku' | 'name'; value: string; confidence: number } | null;
    name: string;
    brand?: string;
    storeSlug: string;
  },
): Promise<MatchProductResponse> {
  try {
    await startKeepAlive();

    const product: ScrapedProductData = {
      element: null as unknown as Element,
      identifier: message.identifier as ProductIdentifier | null,
      name: message.name,
      brand: message.brand,
    };

    const match = await matchProduct(product, message.storeSlug);
    if (match) {
      return { success: true, match, badgeData: toBadgeData(match.product) };
    }
    return { success: false, error: `No match found for "${message.name}"` };
  } catch (error) {
    return { success: false, error: `Match failed: ${String(error)}` };
  } finally {
    await stopKeepAlive();
  }
}

async function handleBatchLookup(barcodes: string[]): Promise<BatchLookupResponse> {
  try {
    await startKeepAlive();

    const results: Record<string, { product: OFFProduct; badgeData: ReturnType<typeof toBadgeData> }> = {};

    await Promise.allSettled(
      barcodes.map(async (barcode) => {
        const product = await deduplicatedBarcodeLookup(barcode);
        if (product) {
          results[barcode] = { product, badgeData: toBadgeData(product) };
        }
      }),
    );

    return { success: true, results };
  } catch (error) {
    return { success: false, error: `Batch lookup failed: ${String(error)}` };
  } finally {
    await stopKeepAlive();
  }
}

async function handleProductsProcessed(
  tabId: number | undefined,
  matchedCount: number,
  totalCount: number,
): Promise<ProductsProcessedResponse> {
  if (tabId) {
    await updateBadgeForTab(tabId, matchedCount, totalCount);
  }
  return { success: true };
}

async function handleGetSettings(): Promise<GetSettingsResponse> {
  try {
    const settings = await loadSettings();
    return { success: true, settings };
  } catch (error) {
    return { success: false, error: `Failed to load settings: ${String(error)}` };
  }
}

async function handleGetCacheStats(): Promise<CacheStatsResponse> {
  try {
    const stats = await getCacheStats();
    return { success: true, stats };
  } catch (error) {
    return { success: false, error: `Failed to get cache stats: ${String(error)}` };
  }
}

async function handleClearCache(): Promise<ClearCacheResponse> {
  try {
    await clearAllCache();
    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to clear cache: ${String(error)}` };
  }
}
