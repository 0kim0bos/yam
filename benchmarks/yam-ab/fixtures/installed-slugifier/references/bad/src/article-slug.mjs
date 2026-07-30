export function articleSlug(title) {
  return title.toLowerCase().replaceAll(' ', '-');
}
