'use strict';

// Vercel entry point.
//
// Vercel auto-detects an Express app exported here and serves the whole thing as one
// Function — no serverless-http, no wrapper, no vercel.json routing needed. See
// https://vercel.com/kb/guide/ship-a-express-app-on-vercel
//
// Deliberately NOT src/server.js: that also runs a migration check and starts the in-process
// node-cron scheduler, neither of which belongs in a frozen-between-requests serverless
// function. Scheduled jobs run as GitHub Actions workflows (.github/workflows/cron-*.yml)
// against the same Supabase database and Backblaze bucket.
//
// Local development and any long-lived host still use `npm start` -> src/server.js.

module.exports = require('./src/app').createApp();
