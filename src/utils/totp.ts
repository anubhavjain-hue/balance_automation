import { TOTP } from 'otpauth';

export function generateTotp(secret: string): string {
  const totp = new TOTP({
    issuer: 'Unlimit',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
  return totp.generate();
}
