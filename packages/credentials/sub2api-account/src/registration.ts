/** Public signup policy and email-bound registration attempts for one local account Host. */
import { z } from 'zod'
import { AccountError, parse, type PlatformClient } from './http.ts'
import type { RegistrationId, RegistrationInput, RegistrationOptions } from './types.ts'

const policy = z.object({
  registration_enabled: z.boolean(), email_verify_enabled: z.boolean(), registration_code_enabled: z.boolean().optional(),
  invitation_code_enabled: z.boolean().optional(), affiliate_enabled: z.boolean().optional(), promo_code_enabled: z.boolean().optional(),
  turnstile_enabled: z.boolean().optional(), tencent_captcha_enabled: z.boolean().optional(),
  aliyun_captcha_enabled: z.boolean().optional(),
  site_subtitle: z.string().optional(), login_agreement_enabled: z.boolean().optional(),
  login_agreement_documents: z.array(z.object({ id: z.string(), title: z.string() })).nullish(),
})

/** @param http - Trusted platform API transport. @returns currently enabled signup fields and policy documents. */
export async function registrationOptions(http: PlatformClient): Promise<RegistrationOptions> {
  const data = parse(policy, await http.request('/api/v1/settings/public'))
  return { enabled: data.registration_enabled, emailVerification: data.email_verify_enabled,
    registrationCode: data.registration_code_enabled ?? data.invitation_code_enabled ?? false,
    affiliate: !!data.affiliate_enabled, promo: !!data.promo_code_enabled, notice: data.site_subtitle ?? '',
    captcha: !!(data.turnstile_enabled || data.tencent_captcha_enabled || data.aliyun_captcha_enabled),
    agreements: data.login_agreement_enabled ? data.login_agreement_documents ?? [] : [] }
}

/** Keeps the platform's attempt token on the Host between email delivery, resend and signup. */
export class RegistrationFlow {
  private active?: { id: RegistrationId; email: string; code: string; token: string }

  private async token(http: PlatformClient, id: RegistrationId, email: string, code: string): Promise<string> {
    if (!z.uuid().safeParse(id).success || !z.email().safeParse(email).success) throw new AccountError('registration-input')
    if (this.active?.id === id) {
      if (this.active.email !== email || this.active.code !== code) throw new AccountError('registration-input')
      return this.active.token
    }
    const result = parse(z.object({ attempt_token: z.string().min(1) }), await http.request('/api/v1/auth/registration-attempts', {
      body: { client_attempt_id: id, email, registration_code: code, signup_source: 'email', registration_url: http.origin + '/register' },
    }))
    this.active = { id, email, code, token: result.attempt_token }
    return result.attempt_token
  }

  /** @param http - Account transport. @param id - Form attempt. @param email - Recipient. @param code - Platform registration code.
   * @returns platform resend delay in seconds.
   */
  async send(http: PlatformClient, id: RegistrationId, email: string, code: string): Promise<number> {
    const token = await this.token(http, id, email, code)
    return parse(z.object({ countdown: z.number().int().nonnegative() }), await http.request('/api/v1/auth/send-verify-code', {
      body: { email, registration_code: code, registration_attempt_token: token },
    })).countdown
  }

  /** @param http - Account transport. @param input - Confirmed form fields.
   * @returns website refresh token for immediate revocation after signup.
   */
  async submit(http: PlatformClient, input: RegistrationInput): Promise<string | undefined> {
    if (input.password.length < 6) throw new AccountError('registration-input')
    const token = await this.token(http, input.id, input.email, input.registrationCode)
    const result = parse(z.object({ access_token: z.string().min(1), refresh_token: z.string().optional() }),
      await http.request('/api/v1/auth/register', { body: { email: input.email, password: input.password, verify_code: input.emailCode,
        registration_code: input.registrationCode, aff_code: input.affiliate, promo_code: input.promo,
        registration_attempt_token: token } }))
    delete this.active
    return result.refresh_token
  }
}
