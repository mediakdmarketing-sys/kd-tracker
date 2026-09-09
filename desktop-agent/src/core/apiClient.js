'use strict';

// The agent's only route to the backend.
//
// Deliberately dependency-free and Electron-free: `fetch` and the token store are injected, so
// the whole retry and refresh story is testable in plain Node without launching a window.

const logger = require('./logger');

class ApiClient {
  /**
   * @param {object}   opts
   * @param {string}   opts.baseUrl
   * @param {object}   opts.tokenStore  { load(), save(tokens), clear() }
   * @param {Function} [opts.fetchImpl]
   * @param {number}   [opts.timeoutMs]
   */
  constructor({ baseUrl, tokenStore, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.tokens = tokenStore;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    // One refresh in flight at a time: a drain sends several requests at once and they would
    // otherwise each rotate the refresh token, invalidating each other's.
    this.refreshing = null;
  }

  async login(email, password) {
    const res = await this.#send('/api/auth/login', {
      method: 'POST',
      body: { email, password, client: 'desktop' },
      auth: false,
    });

    if (res.status !== 200) {
      const error = new Error(res.body?.error?.message || 'Sign-in failed');
      error.status = res.status;
      throw error;
    }

    this.tokens.save({
      accessToken: res.body.accessToken,
      refreshToken: res.body.refreshToken,
    });
    return res.body.employee;
  }

  async logout() {
    const { refreshToken } = this.tokens.load() || {};
    if (refreshToken) {
      // Best effort: the local tokens are cleared either way.
      await this.#send('/api/auth/logout', {
        method: 'POST',
        body: { refreshToken },
        auth: false,
      }).catch(() => {});
    }
    this.tokens.clear();
  }

  /**
   * Authenticated request. A 401 triggers one refresh and one retry; a second 401 means the
   * session is genuinely over and the caller has to prompt for sign-in.
   *
   * Returns `{ status, body, networkError }` rather than throwing on HTTP status — the
   * uploader needs to classify every outcome, not just the happy path.
   */
  async request(path, { method = 'GET', body } = {}) {
    const first = await this.#send(path, { method, body });
    if (first.status !== 401) return first;

    const refreshed = await this.#refreshOnce();
    if (!refreshed) return first;

    return this.#send(path, { method, body });
  }

  async #refreshOnce() {
    if (this.refreshing) return this.refreshing;

    this.refreshing = (async () => {
      const { refreshToken } = this.tokens.load() || {};
      if (!refreshToken) return false;

      const res = await this.#send('/api/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        auth: false,
      });

      if (res.status === 200) {
        this.tokens.save({
          accessToken: res.body.accessToken,
          refreshToken: res.body.refreshToken,
        });
        return true;
      }

      if (res.networkError) {
        // The server is unreachable, not hostile. Keep the tokens — they are probably fine.
        logger.warn('Could not reach the server to refresh the session');
        return false;
      }

      // 401 here means revoked, expired, or the account was deactivated. Any of those need a
      // human, so drop the tokens rather than retrying with them forever.
      logger.warn('Session ended by the server; sign-in required', { status: res.status });
      this.tokens.clear();
      return false;
    })();

    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  async #send(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';

    if (auth) {
      const { accessToken } = this.tokens.load() || {};
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const isJson = res.headers.get('content-type')?.includes('json');
      return {
        status: res.status,
        body: isJson ? await res.json() : null,
        retryAfterSeconds: Number(res.headers.get('retry-after')) || null,
      };
    } catch (err) {
      // Offline, DNS failure, TLS problem, timeout. All the same to the caller: try later.
      return { status: 0, body: null, networkError: err.name === 'AbortError' ? 'timeout' : err.message };
    } finally {
      clearTimeout(timer);
    }
  }

  isSignedIn() {
    return Boolean(this.tokens.load()?.refreshToken);
  }
}

module.exports = { ApiClient };
