import { LandingPage } from '@/components/landing-page';
import { APP_NAME } from '@/lib/data';

export const metadata = {
  title: { absolute: `${APP_NAME} · Find an HDB. Know the neighbourhood.` },
  description: 'Research HDB neighbourhoods with past resale prices, nearby amenities and side-by-side comparisons. Browse without an account.',
};

export default function Page() {
  return <LandingPage />;
}
