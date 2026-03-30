/**
 * Store Adapter Registry
 *
 * Central registry of all supported store adapters.
 * The content script uses getAdapterForUrl() to find the right adapter.
 */
import type { StoreAdapter } from '@/types';
import { metroAdapter } from './metro';
import { supercAdapter } from './superc';
import { walmartAdapter } from './walmart';

/** All registered store adapters */
export const adapters: StoreAdapter[] = [
    metroAdapter,
    supercAdapter,
    walmartAdapter,
];

/**
 * Find the adapter matching the given URL's hostname.
 * Returns null if no adapter matches (user is not on a supported store).
 */
export function getAdapterForUrl(url: string): StoreAdapter | null {
    return adapters.find((adapter) => adapter.config.domain.test(url)) ?? null;
}

/** Get all registered store configs (for popup UI display) */
export function getAllStoreConfigs() {
    return adapters.map((a) => a.config);
}
