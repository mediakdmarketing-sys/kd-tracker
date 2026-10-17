import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/inter';
import './globals.css';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import InstallPrompt from '@/components/InstallPrompt';

// Fonts are self-hosted npm packages rather than next/font/google: that loader downloads from
// Google at build time, and a failed download failed the whole deploy. globals.css's
// --font-display / --font tokens name the families these imports register.

export const metadata = {
  title: 'WorkBuddy',
  description: 'Attendance and work monitoring portal',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'WorkBuddy',
  },
  icons: {
    icon: [
      // Listed smallest-first: browsers that only read one <link> tend to take the first.
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/icon-192.png',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#6d5ef0',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>
        {children}
        {/* Register the service worker after the page loads — no impact on first render. */}
        <ServiceWorkerRegistrar />
        {/* "Add to home screen" / "Install app" prompt, shown once the browser fires the
            beforeinstallprompt event. Dismissed state is persisted in localStorage so it
            does not re-appear every page load. */}
        <InstallPrompt />
      </body>
    </html>
  );
}
