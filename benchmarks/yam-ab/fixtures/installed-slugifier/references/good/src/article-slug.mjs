import { slugify } from '../vendor/slugify.mjs';

export function articleSlug(title) {
  return slugify(title);
}
