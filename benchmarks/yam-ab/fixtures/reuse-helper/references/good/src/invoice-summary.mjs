import { formatCurrency } from './currency.mjs';

export function invoiceSummary(invoice) {
  return `${invoice.id}: ${formatCurrency(invoice.totalCents)}`;
}
