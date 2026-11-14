'use strict';

/**
 * Server-Sent Events hub.
 *
 * A lightweight in-process pub/sub channel between backend services and open browser
 * connections. No external broker (Redis, etc.) — this is a single-process server.
 *
 * Usage — emit an event from anywhere in the backend:
 *
 *   const sse = require('./sse');
 *   sse.emit('attendance_changed', { employeeId, state: 'working' });
 *
 * The browser keeps one SSE connection per tab, authenticated by the same JWT flow as every
 * other request. Each connection is registered here and receives all events whose `audience`
 * includes the connected user's role or id.
 *
 * Audience rules:
 *   attendance_changed  → admins + leaders of the affected department + the employee themselves
 *   status_changed      → the employee themselves (their own shift panel)
 *   notification        → a specific employee id
 *   dashboard_refresh   → all admins and leaders
 */

const { EventEmitter } = require('events');

const bus = new EventEmitter();
// Many employees + many browser tabs; bump the default to avoid the Node.js warning.
bus.setMaxListeners(0);

/** Map<connectionId, { res, userId, role, department }> */
const connections = new Map();
let _nextId = 1;

/**
 * Register an open SSE response object.
 * Returns an `unregister` function — call it when the connection closes.
 */
function register(res, { userId, role, department }) {
  const id = _nextId++;
  connections.set(id, { res, userId, role, department });
  return () => connections.delete(id);
}

/**
 * Send an SSE event to all connections that should receive it.
 *
 * @param {string} event  - Event name (e.g. 'attendance_changed')
 * @param {object} payload - JSON-serialisable data
 * @param {object} [audience] - Targeting options:
 *   audience.employeeId   - send only to this employee (and admins/leaders of their dept)
 *   audience.department   - send to leaders of this department + all admins
 *   audience.role         - 'admin'|'leader' — send to everyone with this role
 *   audience.all          - true  — broadcast to everyone
 */
function emit(event, payload, audience = {}) {
  const data = JSON.stringify({ event, payload, ts: Date.now() });
  const line = `data: ${data}\n\n`;

  for (const [, conn] of connections) {
    if (shouldReceive(conn, audience)) {
      try {
        conn.res.write(line);
      } catch {
        // Client already disconnected; the 'close' listener will clean it up.
      }
    }
  }
}

function shouldReceive(conn, audience) {
  if (audience.all) return true;

  // Admins receive all attendance/dashboard events.
  if (conn.role === 'admin') return true;

  // The employee themselves always gets their own events.
  if (audience.employeeId && conn.userId === audience.employeeId) return true;

  // Leaders of the affected department.
  if (audience.department && conn.role === 'leader' && conn.department === audience.department) {
    return true;
  }

  // Explicit role broadcast (e.g. dashboard_refresh to all admins+leaders).
  if (audience.role && conn.role === audience.role) return true;

  return false;
}

/** How many live connections are open right now. Useful for /health/jobs. */
function connectionCount() {
  return connections.size;
}

module.exports = { register, emit, connectionCount };
