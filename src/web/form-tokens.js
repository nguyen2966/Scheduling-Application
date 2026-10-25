import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Stateless protection for the HTML POST fallback; no session or login is introduced.
export function createFormTokens({ secret = randomBytes(32), now = Date.now } = {}) {
  const sign = (value) => createHmac('sha256', secret).update(value).digest('hex');
  return {
    issue() {
      const value = `${now() + 2 * 60 * 60 * 1000}.${randomBytes(12).toString('hex')}`;
      return `${value}.${sign(value)}`;
    },
    verify(token) {
      if (typeof token !== 'string') return false;
      const match = /^(\d+)\.([a-f0-9]{24})\.([a-f0-9]{64})$/.exec(token);
      if (!match || Number(match[1]) <= now()) return false;
      return timingSafeEqual(Buffer.from(match[3], 'hex'), Buffer.from(sign(`${match[1]}.${match[2]}`), 'hex'));
    },
  };
}
