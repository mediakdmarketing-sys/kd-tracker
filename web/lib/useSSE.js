'use client';

import { useEffect, useRef } from 'react';

/**
 * useSSE — subscribe to real-time events from the backend SSE stream.
 *
 * Opens one EventSource per browser tab at /bff/sse. The BFF route injects the auth token
 * server-side so this hook needs no credentials.
 *
 * The hook is designed to be called by multiple components on the same page — the
 * EventSource is shared via a module-level singleton so there is only ever one HTTP
 * connection per tab, regardless of how many components subscribe.
 *
 * Usage:
 *   useSSE('attendance_changed', (payload) => { ... });
 *   useSSE('status_changed',     (payload) => { ... });
 *   useSSE('notification',       (payload) => { ... });
 *
 * @param {string|string[]} eventName  - One event name or array of names to listen for.
 * @param {(payload: object) => void} handler - Called with the parsed payload on each event.
 */

// Module-level singleton — shared across all useSSE callers on the same page.
let _source = null;
let _refCount = 0;
const _listeners = new Map(); // eventName → Set<handler>

function getOrOpenSource() {
  if (_source && _source.readyState !== EventSource.CLOSED) {
    _refCount++;
    return;
  }
  _source = new EventSource('/bff/sse');
  _refCount = 1;

  _source.onmessage = (e) => {
    let parsed;
    try {
      parsed = JSON.parse(e.data);
    } catch {
      return;
    }
    const { event, payload } = parsed;
    if (!event) return;

    const set = _listeners.get(event);
    if (set) set.forEach((fn) => fn(payload));
  };

  _source.onerror = () => {
    // EventSource reconnects automatically on error; nothing to do here.
    // After 3 consecutive failures the browser may give up — that is acceptable,
    // since components still have their own fallback polling.
  };
}

function subscribe(events, handler) {
  for (const ev of events) {
    if (!_listeners.has(ev)) _listeners.set(ev, new Set());
    _listeners.get(ev).add(handler);
  }
}

function unsubscribe(events, handler) {
  for (const ev of events) {
    _listeners.get(ev)?.delete(handler);
  }
  _refCount--;
  if (_refCount <= 0 && _source) {
    _source.close();
    _source = null;
    _refCount = 0;
  }
}

export default function useSSE(eventName, handler) {
  // Keep handler stable across renders using a ref so the effect deps don't change.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (typeof EventSource === 'undefined') return; // SSR guard

    const events = Array.isArray(eventName) ? eventName : [eventName];
    const stable = (payload) => handlerRef.current(payload);

    getOrOpenSource();
    subscribe(events, stable);

    return () => {
      unsubscribe(events, stable);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(eventName) ? eventName.join(',') : eventName]);
}
