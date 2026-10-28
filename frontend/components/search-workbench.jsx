'use client';

import { useState } from 'react';
import { SlidersHorizontal, X, Save, Check, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePlanning } from '@/components/planning-provider';
import { advancedFields, buildCriteria, evaluateHome, storeyRangeValidationError } from '@/lib/planning';
import { requestJson } from '@/lib/api-client';

export function AdvancedRequirements({brief,setBrief}) {
  const update=(key,value)=>setBrief(current=>({...current,[key]:value}));
  const strict=(key)=>brief.requirements?.[key]!==false;
  const storeyError=storeyRangeValidationError(brief);
  return <section className="space-y-4 border-t pt-5" aria-label="Property requirements">
    <div><h3 className="font-semibold">The details that matter</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Must-haves exclude records. Preferences keep alternatives in view and appear in the fit explanation. Missing required evidence does not count as a match.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">{Object.entries(advancedFields).map(([key,[,label,unit]])=><label key={key} className="space-y-1.5 text-xs font-medium">{label}{unit ? ` (${unit})` : ''}<Input aria-describedby={key==='minStorey'||key==='maxStorey' ? `storey-filter-help${storeyError ? ' storey-filter-error' : ''}` : undefined} aria-invalid={(key==='minStorey'||key==='maxStorey') && Boolean(storeyError) || undefined} type={key==='observedAfter'?'date':'number'} min={key==='minStorey'||key==='maxStorey'?1:0} max={key==='minStorey'||key==='maxStorey'?100:key==='minLease'?99:undefined} step={key==='observedAfter'?undefined:'1'} value={brief[key]??''} onChange={e=>update(key,e.target.value===''?'':key==='observedAfter'?e.target.value:Number(e.target.value))}/></label>)}</div>
    <p id="storey-filter-help" className="text-[11px] text-muted-foreground">Storey filters match reported bands that overlap your chosen range. The exact floor is unavailable.</p>{storeyError&&<p id="storey-filter-error" role="alert" className="text-xs text-destructive">{storeyError}</p>}<p className="text-[11px] text-muted-foreground">Lease estimates use a 99-year term and commencement year; exact lease dates may differ.</p>
    <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Which are must-haves?</legend>{[['budget','Budget'],['towns','Selected towns'],['flatType','Flat type'],['schoolDistance','School distance'],['childcareDistance','Childcare distance'],['careDistance','Care distance'],...Object.entries(advancedFields).map(([key,[,label]])=>[key,label])].map(([key,label])=><label key={key} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs"><span>{label}</span><span className="flex items-center gap-2"><span className="text-muted-foreground">{strict(key)?'Must-have':'Preference'}</span><input type="checkbox" className="accent-primary" checked={strict(key)} onChange={e=>setBrief(current=>({...current,requirements:{...current.requirements,[key]:e.target.checked}}))} aria-label={`${label} is a must-have`}/></span></label>)}</fieldset>
  </section>;
}

export function MatchReasons({home,brief}) {
  const {matches,compromises,missing}=evaluateHome(home,brief);
  return <details className="rounded-xl border bg-background/40 px-3 py-2 text-xs"><summary className="cursor-pointer font-semibold">Why this home? {home.preferencePreview?.score!=null && <span className="ml-2 font-normal text-primary">Preview {home.preferencePreview.score}/100</span>}</summary><div className="mt-3 space-y-2 leading-5">{matches.map(text=><p key={text} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-primary"/>{text}</p>)}{compromises.map(text=><p key={text}>Trade-off: {text}</p>)}{missing.length>0&&<p className="border-t pt-2 text-muted-foreground">Missing evidence: {missing.join(', ')}.</p>}{home.preferencePreview && <p className="text-muted-foreground">Preference preview uses {Math.round(home.preferencePreview.coverage*100)}% of weighted evidence among loaded records. It is separate from the source score.</p>}</div></details>;
}

export function SearchWorkbench({brief,setBrief,weights,setWeights,preview,setPreview,applySearch}) {
  const {scenarios,saveScenario,deleteScenario,status,error,ready,retry,reloadRemote}=usePlanning();
  const [name,setName]=useState('');
  const [message,setMessage]=useState('');
  function save(){try{saveScenario(name,brief,weights);setName('');setMessage('Scenario saved.');}catch(e){setMessage(e.message);}}
  return <details className="shrink-0 rounded-xl border bg-card/75 px-4 py-3">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold"><span className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-primary"/>Trade-offs & scenarios</span><span className="text-xs font-normal text-muted-foreground">{scenarios.length} saved · {status==='saved'?'Account synced':status==='local'?'This browser':status}</span></summary>
    <div className="mt-4 grid gap-5 lg:grid-cols-2"><div><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="accent-primary" checked={preview} onChange={e=>setPreview(e.target.checked)}/>Preview my priorities live</label><p className="mt-1 text-xs leading-5 text-muted-foreground">Reorders the records already loaded. Apply the search to fetch alternatives beyond this page; this preview is not a market valuation.</p><details className="mt-2 text-[11px] leading-5 text-muted-foreground"><summary className="cursor-pointer">How the preview works</summary>Budget rewards lower recorded prices relative to your budget. Space uses floor area within this loaded set, or your area and lease targets when set. Location uses available service distances and preferred towns. Each category averages its available criteria; your sliders weight those averages. Missing criteria reduce evidence coverage. A zero-weight category has no effect.</details><div className="mt-3 grid grid-cols-3 gap-4">{[['budget','Lower price'],['space','More space / lease'],['location','Location & services']].map(([key,label])=><label key={key} className="text-xs">{label}<output className="ml-2 font-semibold">{weights[key]}</output><input className="mt-3 w-full accent-primary" type="range" min="0" max="5" step="1" value={weights[key]} aria-label={`${label} priority`} onChange={e=>setWeights(w=>({...w,[key]:Number(e.target.value)}))}/></label>)}</div><Button size="sm" className="mt-3" onClick={()=>applySearch()}>Apply search <ArrowRight className="size-3.5"/></Button></div><div><div className="flex gap-2"><Input aria-label="Scenario name" placeholder="Near parents, more space…" maxLength={80} value={name} onChange={e=>setName(e.target.value)}/><Button disabled={!ready||!name.trim()} variant="outline" onClick={save}><Save className="size-4"/>Save</Button></div><div className="mt-3 flex flex-wrap gap-2">{scenarios.map(s=><div key={s.id} className="flex items-center rounded-lg border bg-background"><Button size="sm" variant="ghost" onClick={()=>{setBrief(current=>({...current,...s.brief}));setWeights(s.weights||{budget:3,space:2,location:3});setPreview(true);setMessage(`${s.name} loaded. Apply search to fetch its matching records.`);}}>{s.name}</Button><button className="p-2 text-muted-foreground hover:text-destructive" aria-label={`Delete scenario ${s.name}`} onClick={()=>deleteScenario(s.id)}><X className="size-3.5"/></button></div>)}</div>{message&&<p role="status" className="mt-2 text-xs text-muted-foreground">{message}</p>}{error&&<div role="status" className="mt-2 text-xs text-destructive">{error}<Button size="sm" variant="ghost" onClick={retry}>Retry sync</Button>{status==='conflict'&&<Button size="sm" variant="ghost" onClick={()=>{if(window.confirm('Replace browser planning edits with the account version?'))reloadRemote();}}>Load account version</Button>}</div>}</div></div>
  </details>;
}

export function ActiveRequirements({brief,setBrief}) {
  const chips=[];
  if(brief.preferredTowns?.length) chips.push(['preferredTowns',brief.preferredTowns.join(', '),[]]);
  if(brief.preferredFlatType) chips.push(['preferredFlatType',brief.preferredFlatType,null]);
  for(const [key,[,label,unit]] of Object.entries(advancedFields)) if(brief[key]!==''&&brief[key]!=null)chips.push([key,`${label}: ${brief[key]} ${unit}`,null]);
  return chips.length>0&&<div className="flex shrink-0 flex-wrap gap-2" aria-label="Property filter chips">{chips.map(([key,label,clear])=><button key={key} className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs hover:bg-secondary" onClick={()=>setBrief(current=>({...current,[key]:clear}))} aria-label={`Remove ${label}`}>{label}<X className="size-3"/></button>)}</div>;
}

export function EmptyRecovery({brief,setBrief,lastSearchSnapshot,applySearch,fixtureMode}) {
  const [checks,setChecks]=useState({});
  const suggestions=[
    {id:'towns',label:'Search all towns',clear:{preferredTowns:[]},omit:['town','towns']},
    {id:'area',label:'Remove the minimum area',clear:{minFloorArea:null},omit:['min_floor_area_sqm']},
    {id:'distance',label:'Relax amenity distances',clear:{schoolDistance:null,childcareDistance:null,careDistance:null},omit:['max_school_distance_m','max_childcare_distance_m','max_care_distance_m']},
  ].filter(s=>s.id==='towns'?brief.preferredTowns?.length:s.id==='area'?brief.minFloorArea:brief.schoolDistance!=null||brief.careDistance!=null||brief.childcareDistance!=null);
  async function check(s){setChecks(c=>({...c,[s.id]:{loading:true}}));try{const criteria={...(lastSearchSnapshot?.criteria||buildCriteria(brief)),limit:1};delete criteria.cursor;for(const key of s.omit)delete criteria[key];const result=await requestJson('/api/v1/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(criteria)});setChecks(c=>({...c,[s.id]:{count:result.total}}));}catch(e){setChecks(c=>({...c,[s.id]:{error:e.message}}));}}
  return <div className="mt-4 space-y-2 text-left">{suggestions.map(s=><div key={s.id} className="rounded-lg border p-3 text-xs"><p className="font-semibold">{s.label}</p>{checks[s.id]?.count!=null?<><p className="mt-1 text-muted-foreground">{checks[s.id].count.toLocaleString()} historical records would match.</p><Button size="sm" variant="soft" className="mt-2" onClick={()=>{setBrief(current=>({...current,...s.clear}));setChecks({});}}>Use this change</Button><p className="mt-1 text-muted-foreground">Then apply the search.</p></>:<Button size="sm" variant="ghost" disabled={fixtureMode||checks[s.id]?.loading} onClick={()=>check(s)}>{checks[s.id]?.loading?'Checking…':'Check matching records'}</Button>}{checks[s.id]?.error&&<p role="status" className="text-destructive">{checks[s.id].error}</p>}</div>)}<Button size="sm" className="mt-2" onClick={()=>applySearch()}>Apply updated search</Button></div>;
}
