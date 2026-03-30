/**
 * ============================================================================
 * Health Canada Front-of-Package (FOP) Symbol Logic
 * ============================================================================
 *
 * WHAT THIS FILE DOES:
 * Computes Health Canada "High In" front-of-package warning symbols
 * based on nutritional data. Since January 2026, Canada requires foods
 * that exceed thresholds for saturated fat, sugars, or sodium to display
 * a warning symbol on the front of the package.
 *
 * THE REGULATION:
 * Health Canada's FOP nutrition symbol regulations (SOR/2022-168) require
 * a magnifying glass symbol with "High in / Élevé en" text when a product
 * exceeds 15% of the Daily Value (%DV) per reference amount:
 *   - Saturated fat: ≥ 2g per reference amount (or ≥ 5g per 100g simplified)
 *   - Sugars: ≥ 10g per reference amount (or ≥ 15g per 100g simplified)
 *   - Sodium: ≥ 345mg per reference amount (or ≥ 600mg per 100g simplified)
 *
 * SIMPLIFICATION:
 * The official thresholds use "per reference amount" which varies by food
 * category (e.g., 30g for crackers, 250mL for milk). Since OFF provides
 * universal per-100g data, we use per-100g thresholds as an approximation.
 * This is noted in the UI with a disclaimer.
 *
 * REFERENCE:
 * https://www.canada.ca/en/health-canada/services/food-nutrition/food-labelling/front-of-package.html
 * ============================================================================
 */

import type { HealthCanadaWarnings, Nutriments } from '@/types';

// ─── Thresholds ──────────────────────────────────────────────────────

/**
 * Health Canada "High In" thresholds per 100g.
 *
 * These are simplified approximations of the official thresholds
 * (which use "per reference amount" varying by food category).
 *
 * OFFICIAL (per reference amount):
 *   Saturated fat: ≥ 2g  (15% DV based on 13g Daily Value)
 *   Sugars:        ≥ 10g (15% DV based on 65g Daily Value)
 *   Sodium:        ≥ 345mg (15% DV based on 2300mg Daily Value)
 *
 * SIMPLIFIED (per 100g — what we use):
 *   Saturated fat: ≥ 5g per 100g
 *   Sugars:        ≥ 15g per 100g
 *   Sodium:        ≥ 600mg (0.6g) per 100g
 */
export const HC_THRESHOLDS = {
    saturatedFat: {
        /** Grams per 100g */
        per100g: 5,
        /** Grams per reference amount (official) */
        perRefAmount: 2,
        /** Daily Value in grams */
        dailyValue: 13,
        /** Warning label text (English) */
        labelEn: 'High in Saturated Fat',
        /** Warning label text (French — for Quebec) */
        labelFr: 'Élevé en Gras saturés',
        /** Nutriment field in OFF API */
        offField: 'saturated-fat_100g' as const,
    },
    sugars: {
        per100g: 15,
        perRefAmount: 10,
        dailyValue: 65,
        labelEn: 'High in Sugars',
        labelFr: 'Élevé en Sucres',
        offField: 'sugars_100g' as const,
    },
    sodium: {
        /** Grams per 100g (600mg = 0.6g) */
        per100g: 0.6,
        /** Grams per reference amount (345mg = 0.345g) */
        perRefAmount: 0.345,
        dailyValue: 2.3,
        labelEn: 'High in Sodium',
        labelFr: 'Élevé en Sodium',
        offField: 'sodium_100g' as const,
    },
} as const;

// ─── Core Computation ────────────────────────────────────────────────

/**
 * Compute Health Canada "High In" warnings from nutriment data.
 *
 * @param nutriments - Per-100g nutriment values from the OFF API
 * @returns Boolean flags for each "High In" warning
 */
export function computeWarnings(nutriments: Nutriments | undefined): HealthCanadaWarnings {
    if (!nutriments) {
        return {
            highInSaturatedFat: false,
            highInSugars: false,
            highInSodium: false,
        };
    }

    return {
        highInSaturatedFat: (nutriments['saturated-fat_100g'] ?? 0) >= HC_THRESHOLDS.saturatedFat.per100g,
        highInSugars: (nutriments.sugars_100g ?? 0) >= HC_THRESHOLDS.sugars.per100g,
        highInSodium: (nutriments.sodium_100g ?? 0) >= HC_THRESHOLDS.sodium.per100g,
    };
}

/**
 * Count how many "High In" warnings a product triggers.
 *
 * @param warnings - Pre-computed warnings
 * @returns Number of active warnings (0-3)
 */
export function countWarnings(warnings: HealthCanadaWarnings): number {
    let count = 0;
    if (warnings.highInSaturatedFat) count++;
    if (warnings.highInSugars) count++;
    if (warnings.highInSodium) count++;
    return count;
}

/**
 * Get human-readable labels for active warnings.
 *
 * @param warnings - Pre-computed warnings
 * @param language - 'en' for English, 'fr' for French (Quebec)
 * @returns Array of label strings for active warnings
 */
export function getWarningLabels(
    warnings: HealthCanadaWarnings,
    language: 'en' | 'fr' = 'en',
): string[] {
    const labels: string[] = [];

    if (warnings.highInSaturatedFat) {
        labels.push(language === 'fr'
            ? HC_THRESHOLDS.saturatedFat.labelFr
            : HC_THRESHOLDS.saturatedFat.labelEn);
    }
    if (warnings.highInSugars) {
        labels.push(language === 'fr'
            ? HC_THRESHOLDS.sugars.labelFr
            : HC_THRESHOLDS.sugars.labelEn);
    }
    if (warnings.highInSodium) {
        labels.push(language === 'fr'
            ? HC_THRESHOLDS.sodium.labelFr
            : HC_THRESHOLDS.sodium.labelEn);
    }

    return labels;
}

// ─── %Daily Value Computation ────────────────────────────────────────

/**
 * Compute the percentage of Daily Value (%DV) for each nutrient.
 *
 * This provides more context than just "High In" — users can see
 * exactly how much of their daily limit a product contributes.
 *
 * @param nutriments - Per-100g nutriment values
 * @param servingGrams - Serving size in grams (default: 100g)
 * @returns %DV for saturated fat, sugars, and sodium
 */
export function computePercentDailyValue(
    nutriments: Nutriments | undefined,
    servingGrams: number = 100,
): { saturatedFat: number; sugars: number; sodium: number } {
    if (!nutriments) {
        return { saturatedFat: 0, sugars: 0, sodium: 0 };
    }

    const scale = servingGrams / 100; // Adjust from per-100g to per-serving

    return {
        saturatedFat: Math.round(
            ((nutriments['saturated-fat_100g'] ?? 0) * scale / HC_THRESHOLDS.saturatedFat.dailyValue) * 100,
        ),
        sugars: Math.round(
            ((nutriments.sugars_100g ?? 0) * scale / HC_THRESHOLDS.sugars.dailyValue) * 100,
        ),
        sodium: Math.round(
            ((nutriments.sodium_100g ?? 0) * scale / HC_THRESHOLDS.sodium.dailyValue) * 100,
        ),
    };
}

// ─── Exemption Check ─────────────────────────────────────────────────

/**
 * Check if a product is likely EXEMPT from FOP labelling.
 *
 * Health Canada exempts certain categories:
 *   - Raw single-ingredient meats, poultry, fish
 *   - Fresh fruits and vegetables (unprocessed)
 *   - Milk (unflavoured, unsweetened)
 *   - Eggs
 *   - Honey, maple syrup (single-ingredient sugars)
 *
 * We approximate this by checking OFF category tags.
 *
 * @param categoryTags - Product category tags from OFF
 * @returns true if the product is likely exempt
 */
export function isLikelyExempt(categoryTags: string[] | undefined): boolean {
    if (!categoryTags || categoryTags.length === 0) return false;

    const exemptPatterns = [
        'en:fresh-fruits',
        'en:fresh-vegetables',
        'en:raw-meats',
        'en:raw-poultry',
        'en:raw-fish',
        'en:eggs',
        'en:milks',
        'en:plain-milks',
        'en:honeys',
        'en:maple-syrups',
        'en:unflavored-milks',
    ];

    return categoryTags.some((tag) =>
        exemptPatterns.some((pattern) => tag.startsWith(pattern)),
    );
}

// ─── Severity Assessment ─────────────────────────────────────────────

/**
 * Assess the overall health concern severity for a product.
 *
 * Combines the number of warnings with the magnitude of excess
 * to give a simple severity level:
 *   - "none"     = No warnings
 *   - "low"      = 1 warning, values barely above threshold
 *   - "moderate" = 1-2 warnings, or values significantly above
 *   - "high"     = 2-3 warnings, values well above thresholds
 *
 * Used for badge color-coding and sorting.
 *
 * @param nutriments - Per-100g nutriment values
 * @param warnings - Pre-computed warnings
 * @returns Severity level string
 */
export function assessSeverity(
    nutriments: Nutriments | undefined,
    warnings: HealthCanadaWarnings,
): 'none' | 'low' | 'moderate' | 'high' {
    const count = countWarnings(warnings);

    if (count === 0) return 'none';
    if (count >= 3) return 'high';

    if (!nutriments) return 'low';

    // Check how far above thresholds
    const satFatExcess = ((nutriments['saturated-fat_100g'] ?? 0) / HC_THRESHOLDS.saturatedFat.per100g);
    const sugarsExcess = ((nutriments.sugars_100g ?? 0) / HC_THRESHOLDS.sugars.per100g);
    const sodiumExcess = ((nutriments.sodium_100g ?? 0) / HC_THRESHOLDS.sodium.per100g);

    const maxExcess = Math.max(satFatExcess, sugarsExcess, sodiumExcess);

    // More than 2x the threshold → high severity
    if (count >= 2 || maxExcess >= 2) return 'high';
    // More than 1.5x → moderate
    if (maxExcess >= 1.5) return 'moderate';

    return 'low';
}
