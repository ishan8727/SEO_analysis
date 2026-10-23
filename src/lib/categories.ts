import categories from "../../config/categories.json";

// Dropdown categories → Places (New) primary types, used to narrow Autocomplete.
// "other" has no types, so Autocomplete returns every kind of place. "restaurant" has none either:
// Indian restaurants carry dozens of specific primary types (south_indian_restaurant, ...), more than the
// 5-type limit. Lists were checked against real Bengaluru results in Phase 3 (TODO.md).

export interface Category {
  id: string;
  label: string;
  primaryTypes: string[]; // at most 5 (Places Autocomplete limit)
}

export const CATEGORIES: Category[] = categories;

export function getCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}
