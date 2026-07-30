import { normalizeEmail } from './normalize-email.mjs';

export function createUser(email) {
  return { email: normalizeEmail(email) };
}
