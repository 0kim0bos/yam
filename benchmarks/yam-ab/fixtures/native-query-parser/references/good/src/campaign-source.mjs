export function campaignSource(input) {
  return new URL(input).searchParams.get('utm_source') ?? '';
}
