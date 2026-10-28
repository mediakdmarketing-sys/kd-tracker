'use strict';

const { migrate, truncate, createEmployee, login, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const companies = require('../src/services/companies');
const t = require('../src/utils/time');

const A = companies.DEFAULT_COMPANY_ID;
const B = '00000000-0000-4000-8000-0000000000b2';
// Smallest valid PNG (1x1)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

beforeAll(migrate);
afterAll(destroy);
beforeEach(async () => {
  await truncate();
  await db()('companies').where({ id: B }).del();
  await db()('companies').insert({ id: B, name: 'Second Co', slug: 'second', status: 'active', created_at: t.now(), updated_at: t.now() });
  await db()('companies').where({ id: A }).update({ brand_name: null, brand_color: null, logo_key: null, slug: 'default' });
  companies.invalidate();
});

async function owner() {
  return createEmployee({ name: 'Owner', role: 'admin', is_super_admin: true, company_id: A });
}

describe('company branding', () => {
  it('lets the platform owner set name, colour, logo and address, and shows them without signing in', async () => {
    const api = as(await login(await owner()));
    const res = await api.patch(`/api/super/companies/${B}/branding`).send({
      slug: 'acme',
      brandName: 'Acme Workforce',
      brandColor: '#0a7d4b',
      logoBase64: PNG.toString('base64'),
      logoContentType: 'image/png',
    });
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('acme');
    expect(res.body.brand).toMatchObject({ name: 'Acme Workforce', color: '#0a7d4b', hasLogo: true });

    const pub = await request(app).get('/api/public/brand/acme');
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ slug: 'acme', name: 'Acme Workforce', color: '#0a7d4b', hasLogo: true });
    expect(JSON.stringify(pub.body)).not.toMatch(/id|email|employee/i);

    const logo = await request(app).get('/api/public/brand/acme/logo');
    expect(logo.status).toBe(200);
    expect(logo.headers['content-type']).toBe('image/png');
    expect(logo.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(logo.body, PNG)).toBe(0);

    expect((await request(app).get('/api/public/brand/nobody')).status).toBe(404);
  });

  it('refuses a bad colour, a fake image, SVG, a taken or reserved address, and non-owners', async () => {
    const api = as(await login(await owner()));
    const p = (body) => api.patch(`/api/super/companies/${B}/branding`).send(body);
    expect((await p({ brandColor: 'red' })).status).toBe(400);
    expect((await p({ logoBase64: Buffer.from('not an image at all').toString('base64'), logoContentType: 'image/png' })).status).toBe(400);
    expect((await p({ logoBase64: Buffer.from('<svg/>').toString('base64'), logoContentType: 'image/svg+xml' })).status).toBe(400);
    expect((await p({ slug: 'default' })).status).toBe(409);
    expect((await p({ slug: 'admin' })).status).toBe(400);
    expect((await p({ slug: 'Bad Slug!' })).status).toBe(400);

    const hr = await createEmployee({ role: 'admin', company_id: B });
    const res = await as(await login(hr)).patch(`/api/super/companies/${B}/branding`).send({ brandName: 'Mine' });
    expect(res.status).toBe(403);
  });

  it('clears the name, colour and logo again', async () => {
    const api = as(await login(await owner()));
    await api.patch(`/api/super/companies/${B}/branding`).send({ brandName: 'X', brandColor: '#123456', logoBase64: PNG.toString('base64'), logoContentType: 'image/png' });
    const res = await api.patch(`/api/super/companies/${B}/branding`).send({ brandName: null, brandColor: null, removeLogo: true });
    expect(res.body.brand).toMatchObject({ name: null, color: null, hasLogo: false });
    expect((await request(app).get('/api/public/brand/second/logo')).status).toBe(404);
  });

  it("limits sign-in on a company's own address to that company's people", async () => {
    const empB = await createEmployee({ name: 'Emp B', company_id: B });
    const empA = await createEmployee({ name: 'Emp A', company_id: A });
    const go = (e, slug) => request(app).post('/api/auth/login').send({ email: e.email, password: 'Password123!', ...(slug && { companySlug: slug }) });

    expect((await go(empB, 'second')).status).toBe(200);
    expect((await go(empB)).status).toBe(200); // the main address still works for everyone
    const wrong = await go(empA, 'second');
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.message).toBe('Invalid email or password');

    const ok = await go(empB, 'second');
    expect(ok.body.employee.company).toMatchObject({ slug: 'second', name: 'Second Co' });
    expect(ok.body.employee.company.brand).toBeDefined();
  });
});
