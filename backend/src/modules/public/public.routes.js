'use strict';

const express = require('express');
const { db } = require('../../db');
const { storage } = require('../../storage');
const { asyncHandler } = require('../../utils/http');
const { notFound } = require('../../utils/errors');

// Nothing here needs a sign-in: it is what a company's login page shows before anyone has
// signed in. Only the look (name, colour, logo) is exposed, never anything about its people.
const router = express.Router();

async function bySlug(slug) {
  const row = await db()('companies').where({ slug: String(slug).toLowerCase() }).first();
  if (!row) throw notFound('Unknown company');
  return row;
}

// The company that owns a verified custom domain (track.acme.com), for its login page.
router.get(
  '/brand-by-host',
  asyncHandler(async (req, res) => {
    const host = String(req.query.host || '').toLowerCase().split(':')[0];
    const row = host
      ? await db()('companies').where({ custom_domain: host, custom_domain_verified: true }).first()
      : null;
    if (!row) throw notFound('Unknown company');
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      slug: row.slug,
      name: row.brand_name || row.name,
      color: row.brand_color || null,
      hasLogo: Boolean(row.logo_key),
      version: Number(row.updated_at) || 0,
    });
  })
);

router.get(
  '/brand/:slug',
  asyncHandler(async (req, res) => {
    const row = await bySlug(req.params.slug);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      slug: row.slug,
      name: row.brand_name || row.name,
      color: row.brand_color || null,
      hasLogo: Boolean(row.logo_key),
      version: Number(row.updated_at) || 0,
    });
  })
);

router.get(
  '/brand/:slug/logo',
  asyncHandler(async (req, res) => {
    const row = await bySlug(req.params.slug);
    if (!row.logo_key) throw notFound('No logo');
    const buffer = await storage().get(row.logo_key);
    res.set('Content-Type', row.logo_content_type || 'image/png');
    // The logo's address carries ?v=<version>, so a long cache is safe.
    res.set('Cache-Control', 'public, max-age=86400');
    // Belt and braces: an uploaded image must never run as a page.
    res.set('Content-Security-Policy', "default-src 'none'");
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  })
);

module.exports = router;
