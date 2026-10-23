import categories from "../../config/categories.json";

// Dropdown categories → Places (New) primary types, used to narrow Autocomplete.
// "other" has no types, so Autocomplete returns every kind of place.

export interface Category {
  id: string;
  label: string;
  primaryTypes: string[]; // at most 5 (Places Autocomplete limit)
}

export const CATEGORIES: Category[] = categories;

export function getCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}
