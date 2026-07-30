export function initials(name) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}
