'use client';

import {useEffect,useId,useMemo,useState} from 'react';
import {requestJson} from '@/lib/api-client';
import {money} from '@/lib/utils';
import {Button} from '@/components/ui/button';
import { LoadingScene } from '@/components/loading-scene';

export function MarketExplorer({towns=[],flatTypes=[],initialTown='',initialFlatType=''}) {
  const [town,setTown]=useState(initialTown);
  const [flatType,setFlatType]=useState(initialFlatType);
  const [months,setMonths]=useState(24);
  const [result,setResult]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [retry,setRetry]=useState(0);
  const [selected,setSelected]=useState(null);
  const chartId=useId();
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');setSelected(null);setResult(null);
    const query=new URLSearchParams({months:String(months)});
    if(town)query.set('town',town);
    if(flatType)query.set('flat_type',flatType);
    requestJson(`/api/v1/market/history?${query}`,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setResult(data);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[town,flatType,months,retry]);
  const points=result?.points||[];
  const coords=useMemo(()=>{
    if(!points.length)return[];
    const min=Math.min(...points.map(p=>Number(p.p25??p.median)))*0.95;
    const max=Math.max(...points.map(p=>Number(p.p75??p.median)))*1.05;
    const y=value=>200-160*(Number(value)-min)/(max-min||1);
    return points.map((p,i)=>({...p,x:50+i*530/Math.max(1,points.length-1),y:y(p.median),low:y(p.p25??p.median),high:y(p.p75??p.median)}));
  },[points]);
  const total=points.reduce((sum,p)=>sum+Number(p.count||0),0);
  const current=selected||points.at(-1);
  return <section className="space-y-5" aria-label="Historical neighbourhood price explorer">
    <div className="grid gap-3 sm:grid-cols-3">{[['Town',town,setTown,towns],['Flat type',flatType,setFlatType,flatTypes]].map(([label,value,set,options])=><label key={label} className="space-y-1.5 text-xs font-semibold">{label}<select className="h-10 w-full rounded-lg border bg-background px-3 text-sm font-normal" value={value} onChange={e=>set(e.target.value)}><option value="">All {label==='Town'?'towns':'flat types'}</option>{[...new Set([...options,...(value?[value]:[])])].map(o=><option key={o}>{o}</option>)}</select></label>)}<label className="space-y-1.5 text-xs font-semibold">Period<select className="h-10 w-full rounded-lg border bg-background px-3 text-sm font-normal" value={months} onChange={e=>setMonths(Number(e.target.value))}><option value="12">Latest 12 months</option><option value="24">Latest 24 months</option><option value="60">Latest 5 years</option></select></label></div>
    <p className="text-xs leading-5 text-muted-foreground">Historical resale transactions grouped by month, town and flat type. Cohorts can contain different floor areas, leases and storeys. These figures describe recorded sales, not a valuation or current asking prices.</p>
    {loading?<LoadingScene label="Finding dated transaction evidence…" detail="Grouping the recorded sales for your chosen area." />:error?<div role="alert" className="rounded-xl border p-5 text-sm">{error}<Button variant="outline" className="ml-3" onClick={()=>setRetry(n=>n+1)}>Retry prices</Button></div>:!points.length?<p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No transactions in this cohort. Choose another town, flat type or period.</p>:<>
      <div className="rounded-xl border bg-background/40 p-4"><div aria-live="polite" className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-sm font-semibold">{current?.month}: median {money(current?.median)}</p><p className="text-xs text-muted-foreground">{Number(current?.count||0).toLocaleString()} transactions that month</p></div><svg viewBox="0 0 620 250" className="mt-3 w-full text-primary" role="img" aria-labelledby={chartId}><title id={chartId}>Monthly median resale prices with the middle 50 percent of recorded prices. Full figures are in the table below.</title><path d={`M ${coords.map(p=>`${p.x},${p.high}`).join(' L ')} L ${[...coords].reverse().map(p=>`${p.x},${p.low}`).join(' L ')} Z`} fill="currentColor" opacity="0.12"/><polyline points={coords.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2.5"/>{coords.map(p=><circle key={p.month} cx={p.x} cy={p.y} r={selected?.month===p.month?6:4} fill="currentColor" tabIndex="0" role="button" aria-label={`${p.month}: median ${money(p.median)}, ${p.count} transactions`} onFocus={()=>setSelected(p)} onMouseEnter={()=>setSelected(p)} onClick={()=>setSelected(p)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(p);}}}><title>{p.month}: {money(p.median)}</title></circle>)}{[coords[0],coords.at(-1)].map((p,i)=><text key={i} x={p.x} y="235" textAnchor={i?'end':'start'} fill="currentColor" fontSize="12">{p.month}</text>)}</svg><p className="text-[11px] text-muted-foreground">Line: median · shaded band: 25th–75th percentile. {total.toLocaleString()} transactions across {points.length} reported months. Missing months are omitted; gaps are connected.</p></div>
      <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold">View the transaction figures</summary><div className="mt-3 max-h-64 overflow-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Historical monthly price distribution</caption><thead><tr>{['Month','Sales','25th percentile','Median','75th percentile'].map(t=><th key={t} className="p-2">{t}</th>)}</tr></thead><tbody>{[...points].reverse().map(p=><tr key={p.month} className="border-t"><td className="p-2">{p.month}</td><td className="p-2">{p.count}</td><td className="p-2">{money(p.p25)}</td><td className="p-2 font-semibold">{money(p.median)}</td><td className="p-2">{money(p.p75)}</td></tr>)}</tbody></table></div></details>
      <p className="text-[11px] leading-5 text-muted-foreground">Period: {result?.periodStart||points[0]?.month} to {result?.periodEnd||points.at(-1)?.month}. Source snapshot: {result?.sourceUpdated||'not supplied'}. <a className="text-primary underline" href="https://data.gov.sg/datasets/d_8b84c4ee58e3cfc0ece0d773c8ca6abc/view" target="_blank" rel="noreferrer">HDB resale data</a>. The period is anchored to the latest imported transaction, which may lag today.</p>
    </>}
  </section>;
}
