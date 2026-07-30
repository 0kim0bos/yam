export function invoiceSummary(invoice) {
  const total = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(invoice.totalCents / 100);
  return `${invoice.id}: ${total}`;
}
