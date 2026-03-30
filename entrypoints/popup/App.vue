<script lang="ts" setup>
import { ref, onMounted, watch } from 'vue';
import {
  loadSettings,
  saveSettings,
  type ExtensionSettings,
} from '@/utils/storage';
import { sendToBackground } from '@/types/messages';

const settings = ref<ExtensionSettings | null>(null);
const loading = ref(true);

const stores = [
  { slug: 'metro',   name: 'Metro',   domain: 'metro.ca',   color: '#E31837', letter: 'M' },
  { slug: 'superc',  name: 'SuperC',  domain: 'superc.ca',  color: '#FF6600', letter: 'S' },
  { slug: 'walmart', name: 'Walmart', domain: 'walmart.ca', color: '#0071DC', letter: 'W' },
];

const badgeTypes = [
  { key: 'showNutriScore',    label: 'Nutri-Score',        icon: '🟢', desc: 'Nutrition grade A-E' },
  { key: 'showNova',          label: 'NOVA Group',         icon: '🔵', desc: 'Processing level 1-4' },
  { key: 'showEcoScore',      label: 'Eco-Score',          icon: '🌿', desc: 'Environmental impact' },
  { key: 'showHealthCanada',  label: 'Health Canada',      icon: '⚠️', desc: '"High In" warnings' },
] as const;

onMounted(async () => {
  try {
    settings.value = await loadSettings();
  } catch (e) {
    console.error('[E-Store] Failed to load settings:', e);
  } finally {
    loading.value = false;
  }
});

watch(settings, async (newSettings) => {
  if (!newSettings) return;
  try {
    await saveSettings(newSettings);
    sendToBackground({
      type: 'SETTINGS_CHANGED',
      settings: newSettings,
    }).catch(() => {});
  } catch (e) {
    console.error('[E-Store] Failed to save settings:', e);
  }
}, { deep: true });

function isStoreEnabled(slug: string): boolean {
  return settings.value?.stores[slug]?.enabled ?? true;
}

function toggleStore(slug: string) {
  if (!settings.value) return;
  if (!settings.value.stores[slug]) {
    settings.value.stores[slug] = { enabled: true };
  }
  settings.value.stores[slug].enabled = !settings.value.stores[slug].enabled;
}

function toggleBadge(key: string) {
  if (!settings.value) return;
  (settings.value.badges as Record<string, boolean>)[key] =
    !(settings.value.badges as Record<string, boolean>)[key];
}

function isBadgeEnabled(key: string): boolean {
  return (settings.value?.badges as Record<string, boolean>)?.[key] ?? true;
}

const version = browser.runtime.getManifest().version ?? '1.0.0';
</script>

<template>
  <div v-if="loading" style="padding: 40px; text-align: center; color: #6b7280;">
    Loading...
  </div>

  <div v-else-if="settings" class="fade-in">
    <header class="popup-header">
      <div class="header-brand">
        <div class="header-logo">E</div>
        <div class="header-text">
          <h1>E-Store</h1>
          <span>Open Food Facts</span>
        </div>
      </div>
      <label class="toggle" title="Enable/disable extension globally">
        <input type="checkbox" v-model="settings.enabled">
        <span class="toggle-slider"></span>
      </label>
    </header>

    <div :class="{ 'disabled-overlay': !settings.enabled }">
      <section class="popup-section">
        <div class="section-title">Stores</div>
        <div
          v-for="store in stores"
          :key="store.slug"
          class="store-card"
          :class="{ disabled: !isStoreEnabled(store.slug) }"
        >
          <div
            class="store-icon"
            :style="{ background: store.color }"
          >
            {{ store.letter }}
          </div>
          <div class="store-info">
            <div class="store-name">{{ store.name }}</div>
            <div class="store-domain">{{ store.domain }}</div>
          </div>
          <label class="toggle" @click.stop>
            <input
              type="checkbox"
              :checked="isStoreEnabled(store.slug)"
              @change="toggleStore(store.slug)"
            >
            <span class="toggle-slider"></span>
          </label>
        </div>
      </section>

      <section class="popup-section">
        <div class="section-title">Badge Types</div>
        <div
          v-for="badge in badgeTypes"
          :key="badge.key"
          class="pref-row"
        >
          <div class="pref-label">
            <span class="pref-icon">{{ badge.icon }}</span>
            <span>{{ badge.label }}</span>
          </div>
          <label class="toggle" @click.stop>
            <input
              type="checkbox"
              :checked="isBadgeEnabled(badge.key)"
              @change="toggleBadge(badge.key)"
            >
            <span class="toggle-slider"></span>
          </label>
        </div>
      </section>

      <section class="popup-section">
        <div class="section-title">Settings</div>

        <div class="setting-row">
          <span class="setting-label">Language</span>
          <div class="setting-control">
            <select v-model="settings.language">
              <option value="en">English</option>
              <option value="fr">Français</option>
            </select>
          </div>
        </div>

        <div class="setting-row">
          <span class="setting-label">Badge Size</span>
          <div class="setting-control">
            <select v-model="settings.badgeSize">
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
        </div>

        <div class="slider-row">
          <div class="slider-header">
            <span class="slider-label">Min. Confidence</span>
            <span class="slider-value">{{ Math.round(settings.minimumConfidence * 100) }}%</span>
          </div>
          <input
            type="range"
            class="slider-input"
            min="0"
            max="1"
            step="0.05"
            v-model.number="settings.minimumConfidence"
          >
        </div>
      </section>
    </div>

    <footer class="popup-footer">
      <a
        class="footer-link"
        href="https://world.openfoodfacts.org/contribute"
        target="_blank"
      >
        Contribute to OFF →
      </a>
      <span class="footer-version">v{{ version }}</span>
    </footer>
  </div>
</template>
