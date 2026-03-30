import type { HealthCanadaWarnings, Nutriments } from '@/types';

/**
 * Simplified per-100g thresholds derived from Health Canada's Front-of-Package
 * Nutrition Symbol regulations (SOR/2022-168).
 *
 * Official thresholds use per-reference-amount values that vary by food category.
 * We approximate with per-100g thresholds since OFF provides universal per-100g data.
 *
 * @see https://www.canada.ca/en/health-canada/services/food-nutrition/food-labelling/front-of-package.html
 */
export const HC_THRESHOLDS = {
    saturatedFat: {
        per100g: 5,
        perRefAmount: 2,
        dailyValue: 13,
        labelEn: 'High in Saturated Fat',
        labelFr: 'Élevé en Gras saturés',
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
        per100g: 0.6,
        perRefAmount: 0.345,
        dailyValue: 2.3,
        labelEn: 'High in Sodium',
        labelFr: 'Élevé en Sodium',
        offField: 'sodium_100g' as const,
    },
} as const;

/** Evaluate "High In" warnings for a product based on its nutriment data. */
export function computeWarnings(nutriments: Nutriments | undefined): HealthCanadaWarnings {
    if (!nutriments) {
        return { highInSaturatedFat: false, highInSugars: false, highInSodium: false };
    }

    return {
        highInSaturatedFat: (nutriments['saturated-fat_100g'] ?? 0) >= HC_THRESHOLDS.saturatedFat.per100g,
        highInSugars: (nutriments.sugars_100g ?? 0) >= HC_THRESHOLDS.sugars.per100g,
        highInSodium: (nutriments.sodium_100g ?? 0) >= HC_THRESHOLDS.sodium.per100g,
    };
}

/** Count active warnings (0–3). */
export function countWarnings(warnings: HealthCanadaWarnings): number {
    let count = 0;
    if (warnings.highInSaturatedFat) count++;
    if (warnings.highInSugars) count++;
    if (warnings.highInSodium) count++;
    return count;
}

/** Return localized labels for all active warnings. */
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

/** Compute percent Daily Value for each tracked nutrient. */
export function computePercentDailyValue(
    nutriments: Nutriments | undefined,
    servingGrams: number = 100,
): { saturatedFat: number; sugars: number; sodium: number } {
    if (!nutriments) {
        return { saturatedFat: 0, sugars: 0, sodium: 0 };
    }

    const scale = servingGrams / 100;

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

/**
 * Check whether a product is likely exempt from FOP labelling based on
 * its OFF category tags (e.g., raw meats, fresh produce, eggs).
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

/** Assess overall severity based on warning count and threshold excess. */
export function assessSeverity(
    nutriments: Nutriments | undefined,
    warnings: HealthCanadaWarnings,
): 'none' | 'low' | 'moderate' | 'high' {
    const count = countWarnings(warnings);

    if (count === 0) return 'none';
    if (count >= 3) return 'high';
    if (!nutriments) return 'low';

    const satFatExcess = (nutriments['saturated-fat_100g'] ?? 0) / HC_THRESHOLDS.saturatedFat.per100g;
    const sugarsExcess = (nutriments.sugars_100g ?? 0) / HC_THRESHOLDS.sugars.per100g;
    const sodiumExcess = (nutriments.sodium_100g ?? 0) / HC_THRESHOLDS.sodium.per100g;
    const maxExcess = Math.max(satFatExcess, sugarsExcess, sodiumExcess);

    if (count >= 2 || maxExcess >= 2) return 'high';
    if (maxExcess >= 1.5) return 'moderate';

    return 'low';
}
