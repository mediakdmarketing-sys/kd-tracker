import './globals.css';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import InstallPrompt from '@/components/InstallPrompt';

export const metadata = {
  title: 'KD Tracker',
  description: 'Attendance and work monitoring portal',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'KD Tracker',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/icon-192.png',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2f5cff',
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
