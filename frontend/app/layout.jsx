import 'leaflet/dist/leaflet.css';
import './globals.css';
import { Providers } from './providers';
import { APP_NAME } from '@/lib/data';

export const metadata = {
  title: { default: `${APP_NAME} · places in context`, template: `%s · ${APP_NAME}` },
  description: 'An evidence-led Singapore home search for comparing places, access and everyday context.',
};

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#0a0a0a' };

export default function RootLayout({ children }) {
  return (
    <html lang="en-SG" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
