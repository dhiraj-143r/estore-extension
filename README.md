# E-Store Extension

A browser extension that overlays nutritional and environmental data from [Open Food Facts](https://world.openfoodfacts.org/) onto Canadian online grocery stores.

## Features

- **Nutri-Score** badges (A–E nutrition grade)
- **NOVA Group** badges (1–4 food processing level)
- **Eco-Score** badges (A–F environmental impact)
- **Health Canada** "High In" front-of-package warning symbols
- Per-store toggle controls (Metro, SuperC, Walmart)
- Smart product matching via barcode, SKU, and text search fallback
- Built-in caching for fast repeat visits

## Supported Stores

| Store   | Domain       |
|---------|-------------|
| Metro   | metro.ca    |
| SuperC  | superc.ca   |
| Walmart | walmart.ca  |

## Tech Stack

- [WXT](https://wxt.dev/) — Browser extension framework (Manifest V3)
- [Vue 3](https://vuejs.org/) — Popup UI
- TypeScript
- Open Food Facts API

## Development

```bash
npm install
npm run dev            # Chrome development
npm run dev:firefox    # Firefox development
npm run build          # Production build
```

## Project Structure

```
├── adapters/          # Store-specific DOM scrapers
├── api/               # Open Food Facts API client
├── components/        # Badge renderer (vanilla DOM)
├── entrypoints/       # Content script, background worker, popup
├── types/             # TypeScript type definitions
└── utils/             # Cache, matcher, storage, Health Canada logic
```

## License

This project is part of the Open Food Facts ecosystem.
