export function campaignSource(input) {
  return input.split('utm_source=')[1]?.split('&')[0] ?? '';
}
