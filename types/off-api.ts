export interface Nutriments {
    energy_100g?: number;
    'energy-kcal_100g'?: number;
    fat_100g?: number;
    'saturated-fat_100g'?: number;
    carbohydrates_100g?: number;
    sugars_100g?: number;
    fiber_100g?: number;
    proteins_100g?: number;
    sodium_100g?: number;
    salt_100g?: number;
    calcium_100g?: number;
    iron_100g?: number;
    'vitamin-a_100g'?: number;
    'vitamin-c_100g'?: number;
}

export type NutriScoreGrade = 'a' | 'b' | 'c' | 'd' | 'e' | 'unknown';

export type NovaGroup = 1 | 2 | 3 | 4;

export type EcoScoreGrade = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'unknown';

export interface HealthCanadaWarnings {
    highInSaturatedFat: boolean;
    highInSugars: boolean;
    highInSodium: boolean;
}

export interface OFFProduct {
    code: string;
    product_name?: string;
    product_name_en?: string;
    product_name_fr?: string;
    brands?: string;
    nutriscore_grade?: string;
    nova_group?: number;
    ecoscore_grade?: string;
    nutriments?: Nutriments;
    image_url?: string;
    image_front_url?: string;
    image_front_small_url?: string;
    categories_tags?: string[];
    countries_tags?: string[];
    labels_tags?: string[];
    allergens_tags?: string[];
    packaging?: string;
    packaging_tags?: string[];
    quantity?: string;
    completeness?: number;
}

export interface OFFProductResponse {
    status: 0 | 1;
    status_verbose: string;
    product?: OFFProduct;
}

export interface OFFSearchResponse {
    count: number;
    page: number;
    page_size: number;
    products: OFFProduct[];
}

export type MatchMethod = 'barcode' | 'text-search' | 'cache';

export interface MatchResult {
    product: OFFProduct;
    confidence: number;
    matchMethod: MatchMethod;
}

export interface BadgeData {
    nutriScore: NutriScoreGrade;
    novaGroup: NovaGroup | null;
    ecoScore: EcoScoreGrade;
    healthCanada: HealthCanadaWarnings;
    offUrl: string;
    completeness: number;
}
