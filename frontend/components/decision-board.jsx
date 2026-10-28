'use client';

import { LoadingScene } from '@/components/loading-scene';

import { useState } from 'react';
import { Camera, ClipboardCheck, Plus, RefreshCw, Star, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ShareDecision } from '@/components/plan-snapshot';
import { EvidenceContext } from '@/components/evidence-context';
import { usePlanning } from '@/components/planning-provider';
import { money } from '@/lib/utils';

const STATUS_OPTIONS = [
  { key: 'research', label: 'Researching', hint: 'Gathering the facts' },
  { key: 'visit', label: 'Plan a visit', hint: 'Ready to see in person' },
  { key: 'considering', label: 'Considering', hint: 'Discussing the trade-offs' },
  { key: 'ruled-out', label: 'Ruled out', hint: 'Keep the reason for later' },
];

const DEFAULT_CHECKLIST = [
  { key: 'daylight', label: 'Check daylight in the rooms' },
  { key: 'noise', label: 'Listen for noise with windows open and closed' },
  { key: 'ventilation', label: 'Check airflow and ventilation' },
  { key: 'condition', label: 'Look for damp, cracks and repair needs' },
  { key: 'accessibility', label: 'Try the route from the entrance to the unit' },
];

const DEFAULT_CHECKLIST_VALUES = Object.fromEntries(DEFAULT_CHECKLIST.map(({ key }) => [key, false]));

function checklistLabel(key) {
  return key.replace(/^custom[-_:]?/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeErrorMessage(error, fallback) {
  return typeof error?.message === 'string' && error.message.trim() ? error.message : fallback;
}

function DecisionCard({ home, decision, photos, updateDecision, addPhoto, removePhoto }) {
  const [customEntry, setCustomEntry] = useState('');
  const [photoPending, setPhotoPending] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [checklistMessage, setChecklistMessage] = useState('');
  const labels = decision?.checklistLabels || {};
  const labelFor = key => labels[key] || checklistLabel(key);
  const savedChecklist = decision?.checklist && typeof decision.checklist === 'object' && !Array.isArray(decision.checklist)
    ? decision.checklist
    : {};
  const checklist = { ...DEFAULT_CHECKLIST_VALUES, ...savedChecklist };
  const customKeys = Object.keys(checklist).filter((key) => !Object.hasOwn(DEFAULT_CHECKLIST_VALUES, key));
  const ratings = Array.isArray(decision?.ratings) ? decision.ratings : [];
  const status = STATUS_OPTIONS.some(({ key }) => key === decision?.status) ? decision.status : 'research';
  const photoInputId = `decision-photo-${encodeURIComponent(String(home.id))}`;

  function updateChecklist(key, checked) {
    updateDecision(home.id, { checklist: { ...checklist, [key]: checked } });
  }

  function updateRating(index, patch) {
    updateDecision(home.id, {
      ratings: ratings.map((rating, ratingIndex) => (ratingIndex === index ? { ...rating, ...patch } : rating)),
    });
  }

  function addChecklistEntry(event) {
    event.preventDefault();
    const text = customEntry.trim();
    setChecklistMessage('');
    if (!text) return;
    if (Object.keys(checklist).length >= 50) { setChecklistMessage('This checklist has 50 entries. Remove an entry before adding another.'); return; }
    if ([...DEFAULT_CHECKLIST.map(item=>item.label), ...customKeys.map(labelFor)].some(label=>label.normalize('NFKC').toLocaleLowerCase()===text.normalize('NFKC').toLocaleLowerCase())) { setChecklistMessage('This check is already on your checklist.'); return; }
    const key = `custom-${crypto.randomUUID()}`;
    updateDecision(home.id, { checklist: { ...checklist, [key]: false }, checklistLabels: { ...labels, [key]: text } });
    setCustomEntry('');
  }

  function removeChecklistEntry(key) {
    if (!window.confirm(`Remove “${labelFor(key)}” from this checklist?`)) return;
    const nextChecklist = { ...checklist };
    const nextLabels = { ...labels };
    delete nextLabels[key];
    delete nextChecklist[key];
    updateDecision(home.id, { checklist: nextChecklist, checklistLabels: nextLabels });
  }

  async function handlePhotoChange(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setPhotoPending(true);
    setPhotoError('');
    try {
      await addPhoto(home.id, file);
    } catch (error) {
      setPhotoError(safeErrorMessage(error, 'This photo could not be added. Choose another image and try again.'));
    } finally {
      setPhotoPending(false);
    }
  }

  async function handlePhotoRemove(photoId) {
    if (!window.confirm('Remove this browser-only photo? Download it first if you want a copy.')) return;
    setPhotoPending(true);
    setPhotoError('');
    try {
      await removePhoto(home.id, photoId);
    } catch (error) {
      setPhotoError(safeErrorMessage(error, 'This photo could not be removed. Please try again.'));
    } finally {
      setPhotoPending(false);
    }
  }

  return <Card className="overflow-hidden border-border/80">
    <article aria-label={`Decision notes for ${home.address}`}>
      <CardHeader className="gap-3 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{home.town || 'Town unavailable'}</Badge>
              <span className="rounded-md border border-border/70 px-2 py-1 text-xs text-muted-foreground">{home.type || 'Home type unavailable'}</span>
            </div>
            <CardTitle className="text-lg">{home.address || 'Saved home'}</CardTitle>
            <p className="mt-1 font-display text-xl font-semibold">{money(home.price)}</p>
          </div>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            Decision
            <select
              aria-label={`Decision status for ${home.address}`}
              className="h-10 min-w-40 rounded-lg border bg-background px-3 text-sm font-medium text-foreground"
              value={status}
              onChange={(event) => updateDecision(home.id, { status: event.currentTarget.value })}
            >
              {STATUS_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <EvidenceContext home={home} />
        <ShareDecision home={home} decision={decision || {}} />
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold">Pros
            <Textarea
              aria-label={`Pros for ${home.address}`}
              maxLength={2000}
              placeholder="What works well for your household?"
              value={decision?.pros || ''}
              onChange={(event) => updateDecision(home.id, { pros: event.currentTarget.value })}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold">Trade-offs
            <Textarea
              aria-label={`Trade-offs for ${home.address}`}
              maxLength={2000}
              placeholder="What would you want to check or compromise on?"
              value={decision?.cons || ''}
              onChange={(event) => updateDecision(home.id, { cons: event.currentTarget.value })}
            />
          </label>
        </div>

        <label className="grid gap-2 text-sm font-semibold">Household notes
          <Textarea
            aria-label={`Household notes for ${home.address}`}
            maxLength={4000}
            placeholder="Add questions, observations or a reason to revisit this home."
            value={decision?.notes || ''}
            onChange={(event) => updateDecision(home.id, { notes: event.currentTarget.value })}
          />
        </label>

        <section aria-labelledby={`ratings-title-${home.id}`} className="space-y-3 border-t border-border/70 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 id={`ratings-title-${home.id}`} className="flex items-center gap-2 text-sm font-semibold"><Star className="size-4 text-primary" />Household ratings</h4>
              <p className="mt-1 text-xs text-muted-foreground">Ratings are recorded by this plan’s owner, on behalf of the named person. They are not independently verified votes. Give each person a name and a score from 1 to 5.</p>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={ratings.length>=20} onClick={() => updateDecision(home.id, { ratings: [...ratings, { name: '', score: 3 }] })}>
              <Plus className="size-3.5" />Add rating
            </Button>
          </div>
          {ratings.length ? <div className="space-y-2">
            {ratings.map((rating, index) => <div key={`${home.id}-rating-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border bg-background/50 p-2">
              <Input
                aria-label={`Name for household rating ${index + 1} at ${home.address}`}
                placeholder="Household member"
                maxLength={80}
                value={rating.name || ''}
                onChange={(event) => updateRating(index, { name: event.currentTarget.value })}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Score
                <select
                  aria-label={`Score for household rating ${index + 1} at ${home.address}`}
                  className="h-10 rounded-lg border bg-background px-2 text-sm text-foreground"
                  value={rating.score || 3}
                  onChange={(event) => updateRating(index, { score: Number(event.currentTarget.value) })}
                >
                  {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}
                </select>
              </label>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-9"
                aria-label={`Remove rating ${index + 1} at ${home.address}`}
                onClick={() => { if(window.confirm('Remove this household rating?')) updateDecision(home.id, { ratings: ratings.filter((_, ratingIndex) => ratingIndex !== index) }); }}
              ><Trash2 className="size-4" /></Button>
            </div>)}
          </div> : <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">Add a rating when someone has a view to share.</p>}
        </section>

        <section aria-labelledby={`visit-title-${home.id}`} className="space-y-3 border-t border-border/70 pt-4">
          <div className="flex items-center gap-2"><ClipboardCheck className="size-4 text-primary" /><h4 id={`visit-title-${home.id}`} className="text-sm font-semibold">Viewing plan</h4></div>
          <label className="grid max-w-sm gap-1.5 text-xs font-semibold text-muted-foreground">
            Visit date and time · Singapore (SGT, UTC+08:00)
            <Input
              type="datetime-local"
              aria-label={`Visit date and time for ${home.address}`}
              value={(decision?.visitDate || '').replace(/\+08:00$/, '')}
              onChange={(event) => updateDecision(home.id, { visitDate: event.currentTarget.value ? `${event.currentTarget.value}+08:00` : '' })}
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {DEFAULT_CHECKLIST.map(({ key, label }) => <label key={key} className="flex items-start gap-2 rounded-lg border bg-background/45 px-3 py-2.5 text-xs leading-5 text-foreground">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={Boolean(checklist[key])}
                onChange={(event) => updateChecklist(key, event.currentTarget.checked)}
              />
              <span>{label}</span>
            </label>)}
            {customKeys.map((key) => <div key={key} className="flex items-start gap-2 rounded-lg border bg-background/45 px-3 py-2.5 text-xs leading-5 text-foreground">
              <label className="flex min-w-0 flex-1 items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={Boolean(checklist[key])}
                  onChange={(event) => updateChecklist(key, event.currentTarget.checked)}
                />
                <span>{labelFor(key)}</span>
              </label>
              <Button type="button" size="icon" variant="ghost" className="-mr-2 -mt-2 size-8 shrink-0" aria-label={`Remove ${labelFor(key)} from viewing checklist`} onClick={() => removeChecklistEntry(key)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>)}
          </div>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={addChecklistEntry}>
            <Input aria-label={`New checklist item for ${home.address}`} placeholder="Add a custom viewing check" maxLength={100} value={customEntry} onChange={(event) => setCustomEntry(event.currentTarget.value)} />
            <Button type="submit" variant="outline" disabled={!customEntry.trim()}><Plus className="size-4" />Add check</Button>
          </form>
          {checklistMessage && <p role="alert" className="text-xs text-destructive">{checklistMessage}</p>}
          <p className="text-xs text-muted-foreground">{Object.keys(checklist).length} / 50 checks</p>
        </section>

        <section aria-labelledby={`photos-title-${home.id}`} className="space-y-3 border-t border-border/70 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 id={`photos-title-${home.id}`} className="flex items-center gap-2 text-sm font-semibold"><Camera className="size-4 text-primary" />Your viewing photos <span className="text-xs font-normal text-muted-foreground">{photos.length}/6</span></h4>
              <p className="mt-1 text-xs text-muted-foreground">JPG, PNG or WebP, up to 5 MB each. Six per home, forty per browser account. Images are resized for storage. Photos stay in this browser only; download a copy before clearing browser data.</p>
            </div>
            <label htmlFor={photoInputId} className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background ${photoPending ? 'pointer-events-none opacity-50' : ''}`}>
              {photoPending ? 'Saving…' : 'Add photo'}
              <input id={photoInputId} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={photoPending} onChange={handlePhotoChange} />
            </label>
          </div>
          {photoError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{photoError}</p>}
          {photos.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((photo) => <figure key={photo.id} className="overflow-hidden rounded-lg border bg-background">
              <img src={photo.dataUrl} alt={photo.name || `Viewing photo for ${home.address}`} className="aspect-[4/3] w-full object-cover" />
              <figcaption className="flex items-center justify-between gap-2 p-2 text-xs">
                <span className="min-w-0 truncate text-muted-foreground" title={photo.name}>{photo.name || 'Viewing photo'}</span><a href={photo.dataUrl} download={`${(photo.name || 'viewing-photo').replace(/\.[^.]+$/, '')}.jpg`} className="underline" aria-label={`Download photo ${photo.name || ''}`}>Download</a>
                <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" disabled={photoPending} aria-label={`Remove photo ${photo.name || ''} from ${home.address}`} onClick={() => handlePhotoRemove(photo.id)}><Trash2 className="size-3.5" /></Button>
              </figcaption>
            </figure>)}
          </div> : <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">Add a photo of a room, view or detail to remember.</p>}
        </section>
      </CardContent>
    </article>
  </Card>;
}

export function DecisionBoard({ homes = [] }) {
  const { decisions, updateDecision, status, error, photos, addPhoto, removePhoto, retry, reloadRemote, ready } = usePlanning();
  const message = typeof error === 'string' ? error : error?.message;
  const statusLabels = {
    loading: 'Loading plan',
    cleared: 'Browser plan cleared',
    local: 'Saved in this browser',
    pending: 'Waiting to sync',
    saving: 'Syncing changes',
    saved: 'Synced to account',
    offline: 'Account sync unavailable',
    conflict: 'Account version changed',
  };
  const statusHint = status === 'cleared'
    ? 'Your account plan is preserved. Load it when you want to continue planning on this browser.'
    : status === 'conflict'
    ? 'Your browser edits are still saved here. Loading the account version replaces those unsynced edits.'
    : status === 'offline'
      ? 'Your edits remain in this browser. Retry when the account service is available.'
      : status === 'local'
        ? 'Decision notes and photos are kept in this browser.'
        : status === 'saved'
          ? 'Your latest decision notes are saved to your account.'
          : status === 'pending' || status === 'saving'
            ? 'Your latest edits are being sent to your account.'
            : 'Checking your saved decision plan.';

  if(!ready)return <LoadingScene label="Loading your decision plan…" />;
  return <section aria-label="Decision board" className="space-y-7">
    <div className="flex flex-col gap-2 border-l-2 border-primary/50 pl-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Household decisions</p>
        <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight">Move each place as the conversation changes.</h2>
      </div>
      <p className="text-xs text-muted-foreground">Notes save locally and sync when signed in. Photos stay in this browser.</p>
    </div>
    <div aria-label="Decision plan sync status" className="flex flex-col justify-between gap-3 rounded-xl border bg-card px-4 py-3 sm:flex-row sm:items-center">
      <div aria-live="polite">
        <Badge variant={status === 'offline' || status === 'conflict' ? 'warning' : 'outline'}>{statusLabels[status] || 'Plan status unavailable'}</Badge>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{statusHint}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(status === 'offline' || status === 'conflict') && <Button type="button" size="sm" variant="outline" onClick={() => retry()}><RefreshCw className="size-3.5" />Retry sync</Button>}
        {status === 'cleared' && <Button type="button" size="sm" variant="outline" onClick={() => reloadRemote()}>Load account plan</Button>}
        {status === 'conflict' && <Button type="button" size="sm" variant="warning" onClick={() => {if(window.confirm('Replace unsynced browser edits with the account version?'))reloadRemote();}}>Load account version</Button>}
      </div>
    </div>
    {message && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{message}</p>}

    <div className="space-y-8">
      {STATUS_OPTIONS.map((stage) => {
        const stageHomes = homes.filter((home) => (decisions?.[home.id]?.status || 'research') === stage.key);
        return <section key={stage.key} aria-labelledby={`decision-stage-${stage.key}`} className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 pb-3">
            <span className="size-2.5 rounded-full bg-primary" aria-hidden="true" />
            <h3 id={`decision-stage-${stage.key}`} className="font-display text-xl font-semibold">{stage.label}</h3>
            <Badge variant="outline">{stageHomes.length}</Badge>
            <p className="text-xs text-muted-foreground">{stage.hint}</p>
          </div>
          {stageHomes.length ? <div className="grid items-start gap-4 xl:grid-cols-2">
            {stageHomes.map((home) => <DecisionCard
              key={home.id}
              home={home}
              decision={decisions?.[home.id] || {}}
              photos={photos?.[home.id] || photos?.[String(home.id)] || []}
              updateDecision={updateDecision}
              addPhoto={addPhoto}
              removePhoto={removePhoto}
            />)}
          </div> : <div className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">No saved homes in this step yet.</div>}
        </section>;
      })}
    </div>
  </section>;
}
