import categories from "../../config/categories.json";

// Dropdown categories → Places (New) primary types, used to narrow Autocomplete.
// "other" has no types, so Autocomplete returns every kind of place. "restaurant" has none either:
// restaurants carry dozens of cuisine-specific primary types (south_indian_restaurant, sushi_restaurant, ...),
// more than the 5-type limit. Types are Google's global list; they were checked against real Bengaluru
// results in Phase 3 (TODO.md), not yet in other countries.

export interface Category {
  id: string;
  label: string;
  primaryTypes: string[]; // at most 5 (Places Autocomplete limit)
}

export const CATEGORIES: Category[] = categories;

export function getCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}
