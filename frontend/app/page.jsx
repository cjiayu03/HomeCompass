import { LandingPage } from '@/components/landing-page';
import { APP_NAME } from '@/lib/data';

export const metadata = {
  title: { absolute: `${APP_NAME} · Find a place that fits everyone` },
  description: 'Explore Singapore homes with school, childcare, care access and source-dated price observations in one place.',
};

export default function Page() {
  return <LandingPage />;
}
