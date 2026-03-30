/**
 * ============================================================================
 * Badge Renderer — Vanilla DOM Badge Creation for Content Scripts
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * Creates styled HTML elements for nutrition badges that get injected into
 * grocery store pages. Uses vanilla DOM manipulation (no frameworks) because:
 *   - Content scripts run inside third-party pages
 *   - Vue/React would add overhead and could conflict with store's JS
 *   - Direct DOM creation is lighter and faster
 *
 * BADGE TYPES:
 *   🟢 Nutri-Score (A-E)     — Nutrition quality grade
 *   🔵 NOVA (1-4)            — Food processing level
 *   🌿 Eco-Score (A-F)       — Environmental impact
 *   ⚠️  Health Canada         — "High In" warning symbols
 *   ⏳ Loading                — Skeleton shimmer placeholder
 *   ❌ Not Found              — Product not in OFF database
 *
 * ASSET PATHS:
 * All SVG badges are in public/score/ and accessed via browser.runtime.getURL():
 *   - /score/nutriscore-{a-e}-new-en.svg
 *   - /score/nova-group-{1-4}.svg
 *   - /score/green-score-{a-f}.svg
 * ============================================================================
 */

import type { BadgeData, NutriScoreGrade, NovaGroup, EcoScoreGrade, HealthCanadaWarnings, BadgeState } from '@/types';

// ─── Constants ───────────────────────────────────────────────────────

/** CSS class prefix for all badge elements (avoids collision with store CSS) */
const PREFIX = 'estore';

/** Data attribute used to mark cards that have badges */
const BADGE_MARKER = 'data-estore-badge';

// ─── Main Entry Point ────────────────────────────────────────────────

/**
 * Create a complete badge container with all relevant badges.
 *
 * This is the main function called by the content script. It takes
 * the pre-computed BadgeData and returns a fully styled DOM element
 * ready to be appended to a product card.
 *
 * @param badgeData - Pre-computed data from toBadgeData()
 * @param confidence - Match confidence (0-1)
 * @returns A styled HTMLDivElement containing all badges
 */
export function createBadgeContainer(
    badgeData: BadgeData,
    confidence: number,
): HTMLDivElement {
    const container = document.createElement('div');
    container.className = `${PREFIX}-badge-container`;
    container.setAttribute(BADGE_MARKER, 'true');

    // ── Row 1: Score badges ──
    const scoreRow = document.createElement('div');
    scoreRow.className = `${PREFIX}-badge-row`;

    // Nutri-Score
    if (badgeData.nutriScore !== 'unknown') {
        scoreRow.appendChild(createNutriscoreBadge(badgeData.nutriScore));
    }

    // NOVA Group
    if (badgeData.novaGroup) {
        scoreRow.appendChild(createNovaBadge(badgeData.novaGroup));
    }

    // Eco-Score
    if (badgeData.ecoScore !== 'unknown') {
        scoreRow.appendChild(createEcoScoreBadge(badgeData.ecoScore));
    }

    if (scoreRow.children.length > 0) {
        container.appendChild(scoreRow);
    }

    // ── Row 2: Health Canada warnings ──
    if (badgeData.healthCanada.highInSaturatedFat ||
        badgeData.healthCanada.highInSugars ||
        badgeData.healthCanada.highInSodium) {
        container.appendChild(createHealthCanadaBadge(badgeData.healthCanada));
    }

    // ── Row 3: Confidence / completeness warnings ──
    if (confidence > 0 && confidence < 0.5) {
        container.appendChild(createConfidenceIndicator(confidence));
    }

    if (badgeData.completeness < 0.3) {
        container.appendChild(createCompletenessWarning(badgeData.completeness));
    }

    // ── Click handler: open OFF product page ──
    container.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        window.open(badgeData.offUrl, '_blank');
    });

    // ── Tooltip on hover ──
    container.appendChild(createTooltip(badgeData, confidence));

    return container;
}

// ─── Individual Badge Creators ───────────────────────────────────────

/**
 * Create a Nutri-Score badge (A-E nutrition grade).
 *
 * Uses official Nutri-Score SVG images from public/score/:
 *   🟢 A = Excellent   🟢 B = Good   🟡 C = Average
 *   🟠 D = Poor        🔴 E = Bad
 */
export function createNutriscoreBadge(grade: NutriScoreGrade): HTMLElement {
    const img = document.createElement('img');
    img.src = browser.runtime.getURL(`/score/nutriscore-${grade}-new-en.svg`);
    img.alt = `Nutri-Score ${grade.toUpperCase()}`;
    img.title = `Nutri-Score: ${grade.toUpperCase()}`;
    img.className = `${PREFIX}-badge ${PREFIX}-badge-nutriscore`;
    img.draggable = false;
    return img;
}

/**
 * Create a NOVA group badge (1-4 processing level).
 *
 *   1 = Unprocessed   2 = Culinary ingredients
 *   3 = Processed     4 = Ultra-processed
 */
export function createNovaBadge(group: NovaGroup): HTMLElement {
    const img = document.createElement('img');
    img.src = browser.runtime.getURL(`/score/nova-group-${group}.svg`);
    img.alt = `NOVA Group ${group}`;
    img.title = `NOVA Group: ${group} — ${getNovaLabel(group)}`;
    img.className = `${PREFIX}-badge ${PREFIX}-badge-nova`;
    img.draggable = false;
    return img;
}

/**
 * Create an Eco-Score badge (environmental impact grade A-F).
 */
export function createEcoScoreBadge(grade: EcoScoreGrade): HTMLElement {
    const img = document.createElement('img');
    img.src = browser.runtime.getURL(`/score/green-score-${grade}.svg`);
    img.alt = `Eco-Score ${grade.toUpperCase()}`;
    img.title = `Eco-Score: ${grade.toUpperCase()}`;
    img.className = `${PREFIX}-badge ${PREFIX}-badge-ecoscore`;
    img.draggable = false;
    return img;
}

/**
 * Create Health Canada "High In" warning badges.
 *
 * Since 2022, Canada requires front-of-package warning symbols on foods
 * high in saturated fat, sugars, or sodium. We render these as small
 * warning pills below the score badges.
 */
export function createHealthCanadaBadge(warnings: HealthCanadaWarnings): HTMLElement {
    const row = document.createElement('div');
    row.className = `${PREFIX}-badge-row ${PREFIX}-hc-warnings`;

    if (warnings.highInSaturatedFat) {
        row.appendChild(createWarningPill('Sat. Fat', 'High in saturated fat (≥5g per 100g)'));
    }
    if (warnings.highInSugars) {
        row.appendChild(createWarningPill('Sugars', 'High in sugars (≥15g per 100g)'));
    }
    if (warnings.highInSodium) {
        row.appendChild(createWarningPill('Sodium', 'High in sodium (≥600mg per 100g)'));
    }

    return row;
}

// ─── State Badges ────────────────────────────────────────────────────

/**
 * Create a loading skeleton badge (shimmer placeholder).
 *
 * Displayed while the background worker is looking up a product.
 * Uses a CSS animation for a shimmer effect.
 */
export function createLoadingBadge(): HTMLDivElement {
    const container = document.createElement('div');
    container.className = `${PREFIX}-badge-container ${PREFIX}-badge-loading`;
    container.setAttribute(BADGE_MARKER, 'loading');

    // Three skeleton bars simulating score badges
    for (let i = 0; i < 3; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = `${PREFIX}-skeleton`;
        container.appendChild(skeleton);
    }

    return container;
}

/**
 * Create a "Not Found" badge for products not in the OFF database.
 */
export function createNotFoundBadge(): HTMLDivElement {
    const container = document.createElement('div');
    container.className = `${PREFIX}-badge-container ${PREFIX}-badge-notfound`;
    container.setAttribute(BADGE_MARKER, 'not-found');

    const label = document.createElement('span');
    label.className = `${PREFIX}-notfound-label`;
    label.textContent = 'Not in Open Food Facts';
    label.title = 'This product is not yet in the Open Food Facts database. Help by adding it!';

    container.appendChild(label);
    return container;
}

/**
 * Create an error badge for when lookup fails.
 */
export function createErrorBadge(errorMessage?: string): HTMLDivElement {
    const container = document.createElement('div');
    container.className = `${PREFIX}-badge-container ${PREFIX}-badge-error`;
    container.setAttribute(BADGE_MARKER, 'error');

    const label = document.createElement('span');
    label.className = `${PREFIX}-error-label`;
    label.textContent = '⚠️ Lookup failed';
    label.title = errorMessage ?? 'Could not look up this product. Try refreshing the page.';

    container.appendChild(label);
    return container;
}

// ─── Helper Components ───────────────────────────────────────────────

/**
 * Create a warning pill (used for Health Canada "High In" labels).
 *
 * Renders as: ⚠ Sat. Fat  or  ⚠ Sugars  or  ⚠ Sodium
 */
function createWarningPill(label: string, tooltip: string): HTMLElement {
    const pill = document.createElement('span');
    pill.className = `${PREFIX}-hc-pill`;
    pill.textContent = `⚠ ${label}`;
    pill.title = tooltip;
    return pill;
}

/**
 * Create a confidence indicator pill.
 *
 * Shown when match confidence is below 50% to warn the user.
 */
export function createConfidenceIndicator(confidence: number): HTMLElement {
    const pill = document.createElement('span');
    pill.className = `${PREFIX}-confidence-pill`;
    pill.textContent = `⚠️ ${Math.round(confidence * 100)}% match`;
    pill.title = `This product was matched with ${Math.round(confidence * 100)}% confidence. The data may not be for the exact product.`;
    return pill;
}

/**
 * Create a data completeness warning.
 *
 * Shown when the OFF product data is less than 30% complete.
 */
function createCompletenessWarning(completeness: number): HTMLElement {
    const pill = document.createElement('span');
    pill.className = `${PREFIX}-completeness-pill`;
    pill.textContent = `📊 ${Math.round(completeness * 100)}% data`;
    pill.title = 'This product has limited data in Open Food Facts. Some scores may be missing or inaccurate.';
    return pill;
}

/**
 * Create a hover tooltip with detailed product info.
 *
 * Hidden by default, appears on container hover (via CSS).
 * Shows a breakdown of all scores and Health Canada warnings.
 */
function createTooltip(badgeData: BadgeData, confidence: number): HTMLElement {
    const tooltip = document.createElement('div');
    tooltip.className = `${PREFIX}-tooltip`;

    const lines: string[] = [];

    // Nutri-Score
    if (badgeData.nutriScore !== 'unknown') {
        lines.push(`Nutri-Score: <strong>${badgeData.nutriScore.toUpperCase()}</strong>`);
    }

    // NOVA
    if (badgeData.novaGroup) {
        lines.push(`NOVA: <strong>Group ${badgeData.novaGroup}</strong> — ${getNovaLabel(badgeData.novaGroup)}`);
    }

    // Eco-Score
    if (badgeData.ecoScore !== 'unknown') {
        lines.push(`Eco-Score: <strong>${badgeData.ecoScore.toUpperCase()}</strong>`);
    }

    // Health Canada warnings
    const hcWarnings: string[] = [];
    if (badgeData.healthCanada.highInSaturatedFat) hcWarnings.push('Saturated Fat');
    if (badgeData.healthCanada.highInSugars) hcWarnings.push('Sugars');
    if (badgeData.healthCanada.highInSodium) hcWarnings.push('Sodium');
    if (hcWarnings.length > 0) {
        lines.push(`⚠️ High in: <strong>${hcWarnings.join(', ')}</strong>`);
    }

    // Confidence
    if (confidence > 0 && confidence < 1) {
        lines.push(`Match: ${Math.round(confidence * 100)}%`);
    }

    // Footer
    lines.push(`<em>Click to view on Open Food Facts →</em>`);

    tooltip.innerHTML = lines.join('<br>');
    return tooltip;
}

// ─── Utility Functions ───────────────────────────────────────────────

/**
 * Get a human-readable label for a NOVA group number.
 */
function getNovaLabel(group: NovaGroup): string {
    const labels: Record<NovaGroup, string> = {
        1: 'Unprocessed or minimally processed',
        2: 'Processed culinary ingredients',
        3: 'Processed foods',
        4: 'Ultra-processed food products',
    };
    return labels[group];
}

/**
 * Update an existing badge container with new data.
 *
 * Used when a product is re-matched (e.g., after a text search fallback
 * returns a better result than the initial SKU lookup).
 *
 * @param existing - The existing badge container element
 * @param badgeData - New badge data to render
 * @param confidence - New confidence score
 */
export function updateBadgeContainer(
    existing: HTMLElement,
    badgeData: BadgeData,
    confidence: number,
): void {
    const newContainer = createBadgeContainer(badgeData, confidence);
    existing.replaceWith(newContainer);
}

/**
 * Transition a loading badge to a matched/not-found/error state.
 *
 * @param loadingElement - The loading badge container
 * @param state - New state
 * @param badgeData - Badge data (required if state is 'matched' or 'partial')
 * @param confidence - Match confidence
 */
export function transitionBadge(
    loadingElement: HTMLElement,
    state: BadgeState,
    badgeData?: BadgeData,
    confidence?: number,
): void {
    let replacement: HTMLElement;

    switch (state) {
        case 'matched':
        case 'partial':
            if (!badgeData) return;
            replacement = createBadgeContainer(badgeData, confidence ?? 0);
            break;
        case 'not-found':
            replacement = createNotFoundBadge();
            break;
        case 'error':
            replacement = createErrorBadge();
            break;
        default:
            return;
    }

    // Smooth transition: fade out loading, fade in new badge
    loadingElement.style.opacity = '0';
    setTimeout(() => {
        loadingElement.replaceWith(replacement);
        replacement.style.opacity = '0';
        requestAnimationFrame(() => {
            replacement.style.opacity = '1';
        });
    }, 200);
}
