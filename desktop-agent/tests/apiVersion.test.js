import { describe, it, expect } from 'vitest';

const { ApiClient } = require('../src/core/apiClient');

const tokens = { load: () => ({ accessToken: 'a', refreshToken: 'r' }), save() {}, clear() {} };
const reply = () => ({ status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) });

describe('the agent says which version it is', () => {
  it('sends its version on every request, signed in or not, so HR can see who has updated', async () => {
    const seen = [];
    const api = new ApiClient({
      baseUrl: 'http://x',
      tokenStore: tokens,
      agentVersion: '0.8.1',
      fetchImpl: async (url, init) => { seen.push(init.headers); return reply(); },
    });
    await api.request('/api/attendance/status');
    await api.login('a@b.c', 'pw');
    expect(seen).toHaveLength(2);
    for (const h of seen) expect(h['X-Agent-Version']).toBe('0.8.1');
  });

  it('sends nothing when it has no version (tests, development)', async () => {
    let headers;
    const api = new ApiClient({ baseUrl: 'http://x', tokenStore: tokens, fetchImpl: async (u, init) => { headers = init.headers; return reply(); } });
    await api.request('/api/config');
    expect(headers['X-Agent-Version']).toBeUndefined();
  });
});
