import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'E-Store Extension',
    permissions: ['storage', 'activeTab', 'alarms'],
    host_permissions: [
      '*://*.metro.ca/*',
      '*://*.superc.ca/*',
      '*://*.walmart.ca/*',
      '*://*.openfoodfacts.org/*',
    ],
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      96: '/icon/96.png',
      128: '/icon/128.png',
    },
    web_accessible_resources: [
      {
        resources: ['score/*.svg'],
        matches: ['*://*.metro.ca/*', '*://*.superc.ca/*', '*://*.walmart.ca/*']
      }
    ]
  },
});
