import { LoadingScene } from '@/components/loading-scene';

export default function Loading() {
  return <div className="grid min-h-[55dvh] place-items-center px-6"><LoadingScene label="Opening HomeCompass…" detail="Your next view is on its way." /></div>;
}
