/** Locale keys for redacted platform failures. */
import type { AccountFailure } from '../types.ts'
import type { AccountKey } from './locales.ts'

/** Shared account and native platform failure copy. */
export const failureKeys: Record<AccountFailure, AccountKey> = {
  network: 'network', timeout: 'connectionTimeout', server: 'serverUnavailable', authorization: 'authorization', credentials: 'credentials', captcha: 'captcha', 'two-factor': 'otpError',
  protocol: 'protocol', storage: 'storage', expired: 'expired', busy: 'busy', 'no-models': 'noModels', revocation: 'revocation',
  'upgrade-required': 'upgradeRequired', 'usage-filter': 'usageFilter', validation: 'validation', unavailable: 'unavailable',
  uncertain: 'uncertain', conflict: 'conflict', 'invoice-evidence': 'invoiceEvidence', 'gateway-unavailable': 'gatewayUnavailable',
  'insecure-gateway': 'insecureGateway', balance: 'insufficientBalance',
  'model-limits': 'modelLimitsInvalid', 'payment-gateway': 'paymentGatewayError',
  'account-line-unavailable': 'accountLineUnavailable',
}
