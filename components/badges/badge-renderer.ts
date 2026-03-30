import type { BadgeData, NutriScoreGrade, NovaGroup, EcoScoreGrade, HealthCanadaWarnings, BadgeState } from '@/types';

const PREFIX = 'estore';
const BADGE_MARKER = 'data-estore-badge';

/** Create a complete badge container with score badges, warnings, and tooltip. */
export function createBadgeContainer(
    badgeData: BadgeData,
    confidence: number,
): HTMLDivElement {
    const container = document.createElement('div');
    container.className = `${PREFIX}-badge-container`;
    container.setAttribute(BADGE_MARKER, 'true');

    const scoreRow = document.createElement('div');
    scoreRow.className = `${PREFIX}-badge-row`;

    if (badgeData.nutriScore !== 'unknown') {
        scoreRow.appendChild(createNutriscoreBadge(badgeData.nutriScore));
    }
    if (badgeData.novaGroup) {
        scoreRow.appendChild(createNovaBadge(badgeData.novaGroup));
    }
    if (badgeData.ecoScore !== 'unknown') {
        scoreRow.appendChild(createEcoScoreBadge(badgeData.ecoScore));
    }

    if (scoreRow.children.length > 0) {
        container.appendChild(scoreRow);
    }

    if (badgeData.healthCanada.highInSaturatedFat ||
        badgeData.healthCanada.highInSugars ||
        badgeData.healthCanada.highInSodium) {
        container.appendChild(createHealthCanadaBadge(badgeData.healthCanada));
    }

    if (confidence > 0 && confidence < 0.5) {
        container.appendChild(createConfidenceIndicator(confidence));
    }

    if (badgeData.completeness < 0.3) {
        container.appendChild(createCompletenessWarning(badgeData.completeness));
    }

    container.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        window.open(badgeData.offUrl, '_blank');
    });

    container.appendChild(createTooltip(badgeData, confidence));
    return container;
}

export function createNutriscoreBadge(grade: NutriScoreGrade): HTMLElement {
    const img = document.createElement('img');
    img.src = browser.runtime.getURL(`/score/nutriscore-${grade}-new-en.svg`);
    img.alt = `Nutri-Score ${grade.toUpperCase()}`;
    img.title = `Nutri-Score: ${grade.toUpperCase()}`;
    img.className = `${PREFIX}-badge ${PREFIX}-badge-nutriscore`;
    img.draggable = false;
    return img;
}

export function createNovaBadge(group: NovaGroup): HTMLElement {
    const img = document.createElement('img');
    img.src = browser.runtime.getURL(`/score/nova-group-${group}.svg`);
    img.alt = `NOVA Group ${group}`;
    img.title = `NOVA Group: ${group} — ${getNovaLabel(group)}`;
    img.className = `${PREFIX}-badge ${PREFIX}-badge-nova`;
    img.draggable = false;
    return img;
}

export function createEcoScoreBadge(grade: EcoScoreGrade): HTMLElement {
    const img = document.createElement('img');
    img.src = browser.runtime.getURL(`/score/green-score-${grade}.svg`);
    img.alt = `Eco-Score ${grade.toUpperCase()}`;
    img.title = `Eco-Score: ${grade.toUpperCase()}`;
    img.className = `${PREFIX}-badge ${PREFIX}-badge-ecoscore`;
    img.draggable = false;
    return img;
}

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

export function createLoadingBadge(): HTMLDivElement {
    const container = document.createElement('div');
    container.className = `${PREFIX}-badge-container ${PREFIX}-badge-loading`;
    container.setAttribute(BADGE_MARKER, 'loading');

    for (let i = 0; i < 3; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = `${PREFIX}-skeleton`;
        container.appendChild(skeleton);
    }

    return container;
}

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

function createWarningPill(label: string, tooltip: string): HTMLElement {
    const pill = document.createElement('span');
    pill.className = `${PREFIX}-hc-pill`;
    pill.textContent = `⚠ ${label}`;
    pill.title = tooltip;
    return pill;
}

export function createConfidenceIndicator(confidence: number): HTMLElement {
    const pill = document.createElement('span');
    pill.className = `${PREFIX}-confidence-pill`;
    pill.textContent = `⚠️ ${Math.round(confidence * 100)}% match`;
    pill.title = `This product was matched with ${Math.round(confidence * 100)}% confidence. The data may not be for the exact product.`;
    return pill;
}

function createCompletenessWarning(completeness: number): HTMLElement {
    const pill = document.createElement('span');
    pill.className = `${PREFIX}-completeness-pill`;
    pill.textContent = `📊 ${Math.round(completeness * 100)}% data`;
    pill.title = 'This product has limited data in Open Food Facts. Some scores may be missing or inaccurate.';
    return pill;
}

function createTooltip(badgeData: BadgeData, confidence: number): HTMLElement {
    const tooltip = document.createElement('div');
    tooltip.className = `${PREFIX}-tooltip`;

    const lines: string[] = [];

    if (badgeData.nutriScore !== 'unknown') {
        lines.push(`Nutri-Score: <strong>${badgeData.nutriScore.toUpperCase()}</strong>`);
    }
    if (badgeData.novaGroup) {
        lines.push(`NOVA: <strong>Group ${badgeData.novaGroup}</strong> — ${getNovaLabel(badgeData.novaGroup)}`);
    }
    if (badgeData.ecoScore !== 'unknown') {
        lines.push(`Eco-Score: <strong>${badgeData.ecoScore.toUpperCase()}</strong>`);
    }

    const hcWarnings: string[] = [];
    if (badgeData.healthCanada.highInSaturatedFat) hcWarnings.push('Saturated Fat');
    if (badgeData.healthCanada.highInSugars) hcWarnings.push('Sugars');
    if (badgeData.healthCanada.highInSodium) hcWarnings.push('Sodium');
    if (hcWarnings.length > 0) {
        lines.push(`⚠️ High in: <strong>${hcWarnings.join(', ')}</strong>`);
    }

    if (confidence > 0 && confidence < 1) {
        lines.push(`Match: ${Math.round(confidence * 100)}%`);
    }

    lines.push(`<em>Click to view on Open Food Facts →</em>`);
    tooltip.innerHTML = lines.join('<br>');
    return tooltip;
}

function getNovaLabel(group: NovaGroup): string {
    const labels: Record<NovaGroup, string> = {
        1: 'Unprocessed or minimally processed',
        2: 'Processed culinary ingredients',
        3: 'Processed foods',
        4: 'Ultra-processed food products',
    };
    return labels[group];
}

/** Replace an existing badge container with new data. */
export function updateBadgeContainer(
    existing: HTMLElement,
    badgeData: BadgeData,
    confidence: number,
): void {
    const newContainer = createBadgeContainer(badgeData, confidence);
    existing.replaceWith(newContainer);
}

/** Transition a loading badge to a resolved state with a fade animation. */
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

    loadingElement.style.opacity = '0';
    setTimeout(() => {
        loadingElement.replaceWith(replacement);
        replacement.style.opacity = '0';
        requestAnimationFrame(() => {
            replacement.style.opacity = '1';
        });
    }, 200);
}
