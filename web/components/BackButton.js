'use client';

import { useRouter, usePathname } from 'next/navigation';

// One control for the whole app rather than a link hand-picked per page — placed once in
// AppShell so every page gets it "for free", including ones that never had a way back before
// (Reports, Payroll, Settings, ...). Uses real browser history (router.back()), not a fixed
// href, so it always lands wherever the visitor actually came from.
const TOP_LEVEL_PATHS = new Set(['/admin', '/leader', '/me']);

export default function BackButton() {
  const router = useRouter();
  const pathname = usePathname();

  // A "back" control on the role's own home page has nowhere meaningful to go — hide it there
  // rather than let it silently leave the app (browser history before sign-in) or no-op.
  if (TOP_LEVEL_PATHS.has(pathname)) return null;

  return (
    <button
      type="button"
      className="btn"
      onClick={() => router.back()}
      style={{ marginBottom: 14 }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      Back
    </button>
  );
}
