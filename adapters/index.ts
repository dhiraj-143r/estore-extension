import type { StoreAdapter } from '@/types';
import { metroAdapter } from './metro';
import { supercAdapter } from './superc';
import { walmartAdapter } from './walmart';

export const adapters: StoreAdapter[] = [
    metroAdapter,
    supercAdapter,
    walmartAdapter,
];

/** Find the adapter matching the given URL's hostname. */
export function getAdapterForUrl(url: string): StoreAdapter | null {
    return adapters.find((adapter) => adapter.config.domain.test(url)) ?? null;
}

/** Get all registered store configs (used by popup UI). */
export function getAllStoreConfigs() {
    return adapters.map((a) => a.config);
}
