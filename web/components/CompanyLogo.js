'use client';

import { useState } from 'react';

const FALLBACK = '/icons/icon-192.png';

/**
 * The company logo HR uploaded in Settings. With none uploaded (or if it fails to load) the
 * WorkBuddy mark is shown instead.
 *
 * @param {{ hasLogo?: boolean, version?: number|null, size?: number }} props
 */
export default function CompanyLogo({ hasLogo = false, version = null, size = 52 }) {
  const wanted = hasLogo ? `/company-logo?v=${version || 0}` : FALLBACK;
  const [failed, setFailed] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={failed ? FALLBACK : wanted}
      alt=""
      width={size}
      height={size}
      style={{ objectFit: 'contain', borderRadius: 8 }}
      onError={() => setFailed(true)}
    />
  );
}
