'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bookmark, Check, ChevronDown, MapPin, MapPinned, Moon, Scale, Search, Sun } from 'lucide-react';
import { useAppTheme } from '@/components/theme-provider';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { requestJson } from '@/lib/api-client';
import './landing-page.css';

const tour = [
  { id: 'map', icon: MapPinned, title: 'Get to know the neighbourhood.', description: 'Put schools, childcare, parks and care services on the same map as past HDB sales.', image: '/images/explore-map.webp', alt: 'HomeCompass Explore with a Singapore map and recorded HDB resale transactions' },
  { id: 'details', icon: Search, title: 'Look beyond the price.', description: 'Check floor area, remaining lease and dated source details before a place makes your shortlist.', image: '/images/explore-details.webp', alt: 'A recorded HDB transaction opened in the right-hand details panel' },
  { id: 'compare', icon: Scale, title: 'Make the trade-offs clear.', description: 'Save the places you like. Compare two or three side by side, then decide what matters to you.', image: '/images/explore-compare.webp', alt: 'Two HDB transaction records compared side by side in HomeCompass' },
];
const townSuggestions = ['Bishan', 'Tampines', 'Toa Payoh'];

export function LandingPage() {
  const { theme, setTheme } = useAppTheme();
  const { user } = useAuth();
  const router = useRouter();
  const [towns, setTowns] = useState([]);
  const [town, setTown] = useState('');
  const [budget, setBudget] = useState('');
  const [activeTour, setActiveTour] = useState(0);
  const tourButtons = useRef([]);
  const isDark = theme === 'dark';

  useEffect(() => {
    const controller = new AbortController();
    requestJson('/api/v1/search/options', { signal: controller.signal })
      .then(data => setTowns(Array.isArray(data.towns) ? data.towns : []))
      .catch(() => {}); // Browsing all towns and suggested towns remain available.
    return () => controller.abort();
  }, []);

  function explore(event) {
    event.preventDefault();
    const params = new URLSearchParams({ search: '1' });
    if (town) params.set('town', town);
    if (budget) params.set('budget', budget);
    router.push(`/explore?${params}`);
  }
  function navigateTour(event, index) {
    const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index + 1) % tour.length
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index + tour.length - 1) % tour.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tour.length - 1 : null;
    if (next == null) return;
    event.preventDefault(); setActiveTour(next); tourButtons.current[next]?.focus();
  }

  return <div className="home-landing">
    <a className="landing-skip" href="#landing-main">Skip to content</a>
    <header className="landing-header landing-width">
      <Link className="landing-brand" href="/" aria-label="HomeCompass home"><span><MapPinned aria-hidden="true" /></span>HomeCompass</Link>
      <nav aria-label="Landing page navigation"><a href="#how-it-works">How it works</a><a href="#our-data">Our data</a><Link href="/explore">Explore <ArrowRight aria-hidden="true" className="size-4" /></Link></nav>
      <div className="landing-header-actions"><Button variant="ghost" size="icon" aria-label={isDark ? 'Use light theme' : 'Use dark theme'} onClick={() => setTheme(isDark ? 'light' : 'dark')}>{isDark ? <Sun aria-hidden="true" className="size-4" /> : <Moon aria-hidden="true" className="size-4" />}</Button><Link className="landing-account" href={user ? '/shortlist' : '/login'}>{user ? 'Your saved places' : 'Sign in'}<ArrowRight aria-hidden="true" className="size-4" /></Link></div>
    </header>

    <main id="landing-main">
      <section className="landing-hero landing-width" aria-labelledby="landing-title">
        <div className="landing-introduction"><h1 id="landing-title">Find an HDB.<br /><span>Know the neighbourhood.</span></h1><p>Compare past resale prices, check what’s nearby, and keep your favourites together.</p></div>
        <div className="landing-neighbourhood">
          <Image className="landing-photo" src="/images/holland-hdb.jpg" alt="An aerial view of HDB housing and trees in Holland, Singapore" fill sizes="(max-width: 767px) 100vw, (max-width: 1440px) 94vw, 1320px" loading="eager" fetchPriority="high" />
          <span className="landing-photo-place"><MapPin aria-hidden="true" className="size-4" />Holland, Singapore</span>
          <form className="landing-search" action="/explore" method="get" onSubmit={explore} aria-label="Start your HDB search">
            <input type="hidden" name="search" value="1" />
            <label className="landing-search-field"><span>Where are you looking?</span><span className="landing-select"><MapPin aria-hidden="true" className="size-5" /><select name="town" value={town} onChange={event => setTown(event.target.value)} aria-label="Town"><option value="">All towns</option>{[...new Set([...towns, ...townSuggestions])].sort().map(value => <option key={value} value={value}>{value}</option>)}</select><ChevronDown aria-hidden="true" className="size-4" /></span></label>
            <label className="landing-search-field"><span>Maximum resale price</span><span className="landing-select"><select name="budget" value={budget} onChange={event => setBudget(event.target.value)} aria-label="Maximum resale price"><option value="">Any price</option>{[400000,500000,600000,700000,800000,1000000,1200000,1500000].map(value => <option key={value} value={value}>S${value.toLocaleString('en-SG')}</option>)}</select><ChevronDown aria-hidden="true" className="size-4" /></span></label>
            <Button type="submit" className="landing-search-submit">Explore HDBs <ArrowRight aria-hidden="true" className="size-5" /></Button>
          </form>
        </div>
        <div className="landing-search-foot"><div className="landing-town-suggestions"><span>Start with a town</span>{townSuggestions.map(value => <Link key={value} href={`/explore?search=1&town=${encodeURIComponent(value)}`}>{value}<ArrowRight aria-hidden="true" className="size-3.5" /></Link>)}</div><p>Past transactions, not live listings.<br className="landing-note-break" /> Browse without an account.</p></div>
      </section>

      <section id="how-it-works" className="landing-tour landing-width" aria-labelledby="tour-title">
        <div className="landing-tour-copy"><h2 id="tour-title">Know the area.<br />Check the details.</h2><p>The price is a starting point. The places around it matter too.</p>
          <div className="landing-tour-tabs" role="tablist" aria-label="Take a look inside Explore" aria-orientation="vertical">{tour.map(({ id, icon: Icon, title, description }, index) => <button key={id} ref={node => { tourButtons.current[index] = node; }} type="button" id={`tour-tab-${id}`} role="tab" aria-selected={activeTour === index} aria-controls={`tour-panel-${id}`} tabIndex={activeTour === index ? 0 : -1} onClick={() => setActiveTour(index)} onKeyDown={event => navigateTour(event, index)}><Icon aria-hidden="true" className="size-5" /><span><strong>{title}</strong><span>{description}</span></span><ArrowRight aria-hidden="true" className="size-4" /></button>)}</div>
          <Link className="landing-text-link" href="/explore">Try it in Explore <ArrowRight aria-hidden="true" className="size-4" /></Link>
        </div>
        <div className="landing-tour-preview">{tour.map(({ id, image, alt }, index) => <div key={id} id={`tour-panel-${id}`} role="tabpanel" aria-labelledby={`tour-tab-${id}`} hidden={activeTour !== index} tabIndex={0}><Image unoptimized src={image} alt={alt} width={1280} height={800} sizes="(max-width: 767px) 94vw, 65vw" /></div>)}<p><span className="landing-preview-dot" aria-hidden="true" />A look inside Explore · historical resale records</p></div>
      </section>

      <section id="our-data" className="landing-evidence" aria-labelledby="evidence-title"><div className="landing-width landing-evidence-inner"><div><h2 id="evidence-title">Know what you’re<br />looking at.</h2><p>HomeCompass brings public resale and neighbourhood data into one place. Check the source and its date as you go.</p><Link className="landing-text-link" href="/sources">See our data sources <ArrowRight aria-hidden="true" className="size-4" /></Link></div><dl><div><dt><Check aria-hidden="true" className="size-4" />Past prices, with dates</dt><dd>Recorded HDB sales help you research an area. They don’t tell you which flats are for sale today.</dd></div><div><dt><Check aria-hidden="true" className="size-4" />Nearby, with context</dt><dd>Amenities come from public source snapshots. Check opening hours, school admissions and routes separately.</dd></div><div><dt><Bookmark aria-hidden="true" className="size-4" />Save now, come back later</dt><dd>Guest saves stay in this browser. Sign in to sync saved records across devices.</dd></div></dl></div></section>

      <section className="landing-closing landing-width"><div><h2>Which neighbourhood<br />feels like home?</h2><p>Start with a town. Take a look around.</p></div><Button asChild className="landing-closing-button"><Link href="/explore">Explore HDBs <ArrowRight aria-hidden="true" className="size-5" /></Link></Button></section>
    </main>
    <footer className="landing-footer landing-width"><Link className="landing-brand" href="/"><MapPinned aria-hidden="true" className="size-5" />HomeCompass</Link><p>Independent HDB research. Not affiliated with HDB.</p><a href="https://commons.wikimedia.org/wiki/File:Block_21_HDB_Holland,_Singapore_(Unsplash).jpg" target="_blank" rel="noreferrer">Photo: CHUTTERSNAP · CC0</a></footer>
  </div>;
}
