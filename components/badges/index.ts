/**
 * Badge Components — Re-exports
 *
 * Central export point for all badge rendering functions.
 * Content scripts import from here to create badge DOM elements.
 */
export {
    createBadgeContainer,
    createNutriscoreBadge,
    createNovaBadge,
    createEcoScoreBadge,
    createHealthCanadaBadge,
    createLoadingBadge,
    createNotFoundBadge,
    createErrorBadge,
    createConfidenceIndicator,
    updateBadgeContainer,
    transitionBadge,
} from './badge-renderer';
