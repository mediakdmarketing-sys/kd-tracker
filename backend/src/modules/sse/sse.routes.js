'use strict';

/**
 * GET /api/sse
 *
 * Opens a Server-Sent Events stream for the authenticated user. The browser keeps this
 * connection alive and receives push events (attendance changes, notifications, etc.) without
 * polling.
 *
 * Authentication: same JWT Bearer token used by every other route. The middleware already
 * ran before this handler; `req.user` is guaranteed to be set.
 *
 * Keep-alive: a comment ping is sent every 25 seconds so the connection is not closed by
 * proxies, load balancers, or Vercel's 30-second function timeout. On Vercel (serverless),
 * streaming responses work for up to ~25 s; for longer-lived connections use a traditional
 * Node host (see docs/DEPLOYMENT.md). The client reconnects automatically on close.
 *
 * The endpoint returns a 200 immediately (headers only), then keeps the socket open.
 * Any proxy that buffers responses must be configured to flush immediately
 * (nginx: proxy_buffering off; ALB: idle_timeout > 25 s).
 */

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const sse = require('../../services/sse');

const router = express.Router();

const PING_INTERVAL_MS = 25_000;

router.get(
  '/',
  authenticate,
  (req, res) => {
    // SSE requires these exact headers. Cache-Control prevents any proxy from buffering.
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Allow the BFF proxy to forward this response without Content-Encoding compression,
      // which would prevent streaming (gzip buffers until the stream closes).
      'X-Accel-Buffering': 'no',
    });

    // Flush the headers immediately so the browser knows the stream has started.
    res.flushHeaders();

    // Send a small hello event so the client knows the connection is live.
    res.write(`data: ${JSON.stringify({ event: 'connected', payload: { userId: req.user.id } })}\n\n`);

    // Register this connection. `unregister` removes it from the hub when the socket closes.
    const unregister = sse.register(res, {
      userId: req.user.id,
      role: req.user.role,
      department: req.user.department || null,
    });

    // Keep-alive ping — a comment line (": ping") is valid SSE and ignored by the browser,
    // but it keeps the TCP connection and any intervening proxies from timing it out.
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(ping);
      }
    }, PING_INTERVAL_MS);

    // Clean up when the browser tab closes or navigates away.
    req.on('close', () => {
      clearInterval(ping);
      unregister();
    });
  }
);

module.exports = router;
