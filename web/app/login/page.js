import { Suspense } from 'react';
import { headers } from 'next/headers';
import LoginForm from './LoginForm';
import { resolveSlug, fetchBrand, logoUrl, brandStyle } from '@/lib/brand';

// The company is known from the address it is opened on (acme.<domain>), or ?company=acme where
// there is no address per company yet.
async function brandFor(searchParams) {
  const params = (await searchParams) || {};
  const host = (await headers()).get('host');
  const slug = (await resolveSlug(host)) || (typeof params.company === 'string' ? params.company.toLowerCase() : null);
  return { slug, brand: await fetchBrand(slug) };
}

export async function generateMetadata({ searchParams }) {
  const { brand } = await brandFor(searchParams);
  return { title: `Sign in · ${brand ? brand.name : 'WorkBuddy'}` };
}

export default async function LoginPage({ searchParams }) {
  const { slug, brand } = await brandFor(searchParams);
  const name = brand ? brand.name : 'WorkBuddy';

  return (
    <div className="login-wrap" style={brand ? brandStyle(brand.color) : undefined}>
      <div className="login-card card">
        <div className="card-pad">
          <div className="login-head">
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={brand?.hasLogo ? logoUrl(brand.slug, brand.version) : '/icons/icon-192.png'}
                alt=""
                width={44}
                height={44}
                style={{ objectFit: 'contain', borderRadius: 8 }}
              />
              <span className="brand-word" style={{ fontSize: 27 }}>{name}</span>
            </h1>
            <p>Sign in with your work email.</p>
          </div>
          {/* LoginForm reads the ?next= param, which needs a Suspense boundary to prerender. */}
          <Suspense fallback={null}>
            <LoginForm companySlug={brand ? brand.slug : undefined} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
