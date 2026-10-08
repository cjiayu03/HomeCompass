'use client';

import Link from 'next/link';
import { ArrowRight, ArrowUp, ArrowDown, Bookmark, Check, MapPin, RotateCcw, Scale } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { HomeCard } from '@/components/home-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWorkspace } from '@/components/workspace-provider';
import { money } from '@/lib/utils';

export default function ShortlistPage() {
  const { shortlistHomes, shortlistIds, setShortlistIds, selectedHomes, toggleShortlist, toggleCompare, flash } = useWorkspace();
  const { client, user } = useAuth();
  const [sort, setSort] = useState('manual');
  const [detail, setDetail] = useState(null);
  const ordered = sort === 'manual' ? shortlistHomes : [...shortlistHomes].sort((a, b) => sort === 'price' ? (a.price ?? Infinity) - (b.price ?? Infinity) : (b.score ?? -Infinity) - (a.score ?? -Infinity));
  async function move(id, direction) {
    const index = shortlistIds.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= shortlistIds.length) return;
    const next = [...shortlistIds];
    [next[index], next[target]] = [next[target], next[index]];
    setShortlistIds(next);
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '';
    if (user && client) {
      const { data: { session } } = await client.auth.getSession();
      if (!session?.access_token) { flash('The new order is stored in this browser only; your session expired before it synced.', 'warning'); return; }
      try {
        const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/v1/shortlists/order`, { method: 'PATCH', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ordered_home_ids: next }) });
        if (!response.ok) throw new Error();
        flash('Shortlist order saved to your account.', 'success');
        return;
      } catch { flash('The new order is stored in this browser only because account sync failed.', 'warning'); return; }
    }
    flash('Shortlist order updated in this browser.', 'info');
  }
  return <div className="container flex max-w-[1400px] flex-col gap-7 px-4 py-7 sm:px-6 sm:py-9 lg:px-8"><div className="flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Bookmark className="size-3.5 text-primary" />Saved places</div><h1 className="font-display text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Keep the places worth a conversation.</h1><p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">Saved places stay in this browser until you connect an account.</p></div><Button asChild variant="outline"><Link href="/explore">Explore more <ArrowRight className="size-4" /></Link></Button></div>
    {shortlistHomes.length ? <><div className="flex flex-col justify-between gap-3 rounded-xl border bg-card px-4 py-3 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><Badge>{shortlistHomes.length} saved</Badge><span className="text-xs text-muted-foreground">Reorder in manual order; fit and price sorts are temporary.</span></div><div className="flex flex-wrap gap-1"><Button size="sm" variant={sort === 'manual' ? 'soft' : 'ghost'} onClick={() => setSort('manual')}>Manual order</Button><Button size="sm" variant={sort === 'fit' ? 'soft' : 'ghost'} onClick={() => setSort('fit')}>Sort by fit</Button><Button size="sm" variant={sort === 'price' ? 'soft' : 'ghost'} onClick={() => setSort('price')}>Sort by price</Button></div></div><div className="grid gap-5 lg:grid-cols-2">{ordered.map((home, index) => <div key={home.id} className="flex flex-col gap-2"><HomeCard home={home} saved selected={selectedHomes.some((item) => item.id === home.id)} onSave={toggleShortlist} onCompare={toggleCompare} onInspect={setDetail} /><div className="flex items-center justify-between px-2 text-xs text-muted-foreground"><span>{sort === 'manual' ? `Position ${index + 1}` : `Rank ${index + 1} · temporary sort`}</span>{sort === 'manual' && <div className="flex gap-1"><Button size="sm" variant="ghost" disabled={index === 0} onClick={() => move(home.id, -1)}><ArrowUp className="size-3.5" />Move up</Button><Button size="sm" variant="ghost" disabled={index === ordered.length - 1} onClick={() => move(home.id, 1)}><ArrowDown className="size-3.5" />Move down</Button></div>}</div></div>)}</div><div className="flex flex-col items-center justify-between gap-3 rounded-xl border border-primary/15 bg-primary/[0.05] p-5 sm:flex-row"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><Scale className="size-5" /></span><div><p className="font-semibold">Ready to compare?</p><p className="text-xs text-muted-foreground">Choose up to three places for one evidence table.</p></div></div><Button asChild><Link href="/compare">{selectedHomes.length ? `${selectedHomes.length} selected · open comparison` : 'Open comparison'} <ArrowRight className="size-4" /></Link></Button></div></> : <Card className="grid min-h-96 place-items-center border-dashed"><CardContent className="max-w-md text-center"><span className="mx-auto mb-4 grid size-14 place-items-center rounded-xl bg-primary/10 text-primary"><Bookmark className="size-6" /></span><h2 className="font-display text-2xl font-semibold">Your shortlist is empty</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Save a place from Explore when it feels worth a conversation. It will appear here with the same source date.</p><Button asChild className="mt-6"><Link href="/explore">Explore places <ArrowRight className="size-4" /></Link></Button></CardContent></Card>}
    <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><MapPin className="size-3.5 text-primary" />Saved locally in this browser until you sign in.</p>
    <Dialog open={Boolean(detail)} onOpenChange={(open) => { if (!open) setDetail(null); }}><DialogContent><DialogHeader><Badge className="w-fit">Saved home</Badge><DialogTitle>{detail?.address}</DialogTitle><DialogDescription>{detail ? `${money(detail.price)} · score ${detail.score}/100` : ''}</DialogDescription></DialogHeader>{detail && <p className="text-sm leading-6 text-muted-foreground">{detail.highlights.join(' · ')}. Evidence was updated {detail.sourceUpdated}.</p>}<DialogFooter><Button onClick={() => setDetail(null)}>Close</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
