import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HousingChat as HousingChatPanel, normalizeChatFilters, applyChatChanges } from '../components/housing-chat';
import { setAssistantOpen, requestAssistantSummary, clearAssistantSummary } from '../lib/assistant-state';
import { defaultBrief } from '../lib/data';

// The application dock owns the launcher; this host exercises the same event contract.
function HousingChat(props) {
  return <><button data-housing-assistant onClick={() => setAssistantOpen(current => !current)}>Open housing assistant</button><HousingChatPanel {...props} /></>;
}

const request = vi.hoisted(() => vi.fn());
const summaryRequest = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ getApiBase: () => '', requestJson: summaryRequest }));
vi.stubGlobal('fetch', request);

afterEach(() => { cleanup(); setAssistantOpen(false); clearAssistantSummary(); request.mockReset(); summaryRequest.mockReset(); });

describe('housing assistant', () => {
  it('matches generated names to real search options', () => {
    expect(normalizeChatFilters({ town: 'Clementi', towns: [], flat_type: '4-room' }, { towns: ['CLEMENTI'], flatTypes: ['4 ROOM'] })).toMatchObject({ towns: ['CLEMENTI'], flat_type: '4 ROOM' });
    expect(normalizeChatFilters({ town: 'Clementi, Singapore', flat_type: '4-room HDB flat' }, { towns: ['Clementi'], flatTypes: ['4 ROOM'] })).toMatchObject({ towns: ['Clementi'], flat_type: '4 ROOM' });
    expect(() => normalizeChatFilters({ town: 'Imaginary', towns: [] }, { towns: ['CLEMENTI'] })).toThrow('couldn’t match');
    expect(normalizeChatFilters({ towns: ['Jurong', 'Clementi'], flat_type: '2-room' }, { towns: ['Jurong East', 'Jurong West', 'Clementi'], flatTypes: ['2 ROOM'] })).toMatchObject({ towns: ['Jurong East', 'Jurong West', 'Clementi'], flat_type: '2 ROOM' });
  });

  it('preserves unrelated choices, changes priorities, and explicitly clears a filter', () => {
    const current = { ...defaultBrief, budget: 600000, preferredTowns: ['Bedok'], preferredFlatType: '3 ROOM', requirements: { budget: true, towns: true, flatType: true }, priorityWeights: { school: 1, childcare: 1, care: 1, affordability: 1 } };
    const updated = applyChatChanges(current, { towns: ['Tampines'], priority_weights: { childcare: 3 }, clear_filters: ['flat_type'] });
    expect(updated).toMatchObject({ budget: 600000, preferredTowns: ['Tampines'], preferredFlatType: null, requirements: { budget: true, towns: true, flatType: false }, priorityWeights: { school: 1, childcare: 3, care: 1, affordability: 1 } });
    const cleared = applyChatChanges(updated, { clear_filters: ['budget'] });
    expect(cleared.budget).toBeNull();
    expect(cleared.requirements.budget).toBe(false);
  });

  it('applies a validated chat search and explains the update', async () => {
    const chunks = [new TextEncoder().encode(JSON.stringify({ type: 'text', text: 'Let’s look' }) + '\n'), new TextEncoder().encode(JSON.stringify({ type: 'done', reply: 'Let’s look in Clementi.', action: 'search', filters: { town: 'Clementi', towns: [], flat_type: '4-room', budget: 700000 } }) + '\n')];
    request.mockResolvedValue({ ok: true, body: { getReader: () => ({ read: async () => chunks.length ? { value: chunks.shift(), done: false } : { done: true } }) } });
    const search = vi.fn().mockResolvedValue([{ id: 'one' }]);
    render(<HousingChat user={{ id: 'u' }} homes={[{ id: 'one' }]} brief={defaultBrief} options={{ towns: ['CLEMENTI'], flatTypes: ['4 ROOM'] }} onSearch={search} workspaceReady />);
    fireEvent.click(screen.getByRole('button', { name: 'Open housing assistant' }));
    fireEvent.click(screen.getByRole('button', { name: /Find 4-room flats/ }));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search.mock.calls[0][1]).toMatchObject({ budget: 700000, preferredTowns: ['CLEMENTI'], preferredFlatType: '4 ROOM' });
    expect(search.mock.calls[0][2]).toEqual({ interpret: false });
    expect(await screen.findByText(/Search updated/)).toBeInTheDocument();
    expect(JSON.parse(request.mock.calls[0][1].body).home_ids).toEqual(['one']);
  });

  it('uses the latest search options when they load while a reply is streaming', async () => {
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    let count = 0;
    request.mockResolvedValue({ ok: true, body: { getReader: () => ({ read: async () => {
      if (count++) return { done: true };
      await wait;
      return { done: false, value: new TextEncoder().encode(JSON.stringify({ type: 'done', reply: 'Searching.', action: 'search', filters: { towns: ['CLEMENTI'], flat_type: '4 ROOM', budget: 700000 } }) + '\n') };
    } }) } });
    const search = vi.fn().mockResolvedValue([]);
    const common = { user: { id: 'u' }, homes: [], brief: defaultBrief, onSearch: search, workspaceReady: true };
    const { rerender } = render(<HousingChat {...common} options={{ towns: [], flatTypes: [], status: 'loading' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open housing assistant' }));
    fireEvent.click(screen.getByRole('button', { name: /Find 4-room flats/ }));
    rerender(<HousingChat {...common} options={{ towns: ['Clementi'], flatTypes: ['4 ROOM'], status: 'ready' }} />);
    release();
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search.mock.calls[0][1]).toMatchObject({ preferredTowns: ['Clementi'], preferredFlatType: '4 ROOM', budget: 700000 });
  });

  it('applies a flexible family search with school as a priority', async () => {
    const chunks = [new TextEncoder().encode(JSON.stringify({ type: 'done', reply: 'Let’s explore these areas.', action: 'search', filters: { towns: ['Jurong', 'Clementi'], flat_type: '2-room', budget: 800000, budget_is_ceiling: false, school_priority: true } }) + '\n')];
    request.mockResolvedValue({ ok: true, body: { getReader: () => ({ read: async () => chunks.length ? { value: chunks.shift(), done: false } : { done: true } }) } });
    const search = vi.fn().mockResolvedValue([]);
    render(<HousingChat user={{ id: 'u' }} homes={[]} brief={defaultBrief} options={{ towns: ['Jurong East', 'Jurong West', 'Clementi'], flatTypes: ['2 ROOM'] }} onSearch={search} workspaceReady />);
    fireEvent.click(screen.getByRole('button', { name: 'Open housing assistant' }));
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Two children, close to school, around 800k, 2-room in Jurong or Clementi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search.mock.calls[0][1]).toMatchObject({ budget: 800000, requirements: { budget: false }, preferredTowns: ['Jurong East', 'Jurong West', 'Clementi'], preferredFlatType: '2 ROOM', priorityWeights: { school: 3 } });
    expect(await screen.findByText(/prioritising school access/)).toBeInTheDocument();
  });

  it('does not display corrupted filter contents or apply them', async () => {
    const corrupted = 'Clementi</blockquote>]}]}</code></thought>';
    const chunks = [new TextEncoder().encode(JSON.stringify({ type: 'done', reply: 'Checking.', action: 'search', filters: { towns: [corrupted], flat_type: '4 ROOM' } }) + '\n')];
    request.mockResolvedValue({ ok: true, body: { getReader: () => ({ read: async () => chunks.length ? { value: chunks.shift(), done: false } : { done: true } }) } });
    const search = vi.fn();
    render(<HousingChat user={{ id: 'u' }} homes={[]} brief={defaultBrief} options={{ towns: ['Clementi'], flatTypes: ['4 ROOM'] }} onSearch={search} workspaceReady />);
    fireEvent.click(screen.getByRole('button', { name: 'Open housing assistant' }));
    fireEvent.click(screen.getByRole('button', { name: /Find 4-room flats/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('invalid filter');
    expect(alert).not.toHaveTextContent('blockquote');
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Your question')).toHaveValue('Find 4-room flats in Clementi under $700,000');
  });

  it('uses server-validated search options when browser options are stale', async () => {
    const events = [{ type: 'text', text: 'Checking.' }, { type: 'reset', message: 'Rechecking the response…' }, { type: 'done', reply: 'Ready to search.', action: 'search', filters: { towns: ['Clementi'], flat_type: '4 ROOM', budget: 700000 }, searchOptions: { towns: ['Clementi'], flatTypes: ['4 ROOM'] } }];
    request.mockResolvedValue({ ok: true, body: { getReader: () => ({ read: async () => events.length ? { done: false, value: new TextEncoder().encode(JSON.stringify(events.shift()) + '\n') } : { done: true } }) } });
    const search = vi.fn().mockResolvedValue([]);
    render(<HousingChat user={{ id: 'u' }} homes={[]} brief={defaultBrief} options={{ towns: ['Bedok'], flatTypes: ['3 ROOM'] }} onSearch={search} workspaceReady />);
    fireEvent.click(screen.getByRole('button', { name: 'Open housing assistant' }));
    fireEvent.click(screen.getByRole('button', { name: /Find 4-room flats/ }));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search.mock.calls[0][1]).toMatchObject({ preferredTowns: ['Clementi'], preferredFlatType: '4 ROOM' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('closes with Escape and restores keyboard focus to its launcher', async () => {
    render(<HousingChat user={{ id: 'u' }} homes={[]} brief={defaultBrief} onSearch={vi.fn()} workspaceReady />);
    fireEvent.click(screen.getByRole('button', { name: 'Open housing assistant' }));
    expect(screen.getByLabelText('Your question')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open housing assistant' })).toHaveFocus());
  });

  it('routes a record summary into chat using only that record', async () => {
    summaryRequest.mockResolvedValue({ overview: 'This is the verified record summary.', observations: [{ text: 'A nearby school is recorded.', evidence_fields: ['school_distance_m'] }], limitations: ['Availability is unknown.'], source: { datasetId: 'HDB' } });
    const home = { id: 'one', address: '11 Example Street' };
    render(<HousingChat user={{ id: 'u' }} homes={[home, { id: 'other' }]} selectedHome={home} context="detail" brief={defaultBrief} onSearch={vi.fn()} workspaceReady />);
    act(() => requestAssistantSummary(home, 'u'));
    expect(await screen.findByText('This is the verified record summary.')).toBeInTheDocument();
    expect(summaryRequest).toHaveBeenCalledTimes(1);
    expect(summaryRequest.mock.calls[0][0]).toBe('/api/v1/ai/summaries/one');
    expect(screen.getByText('A nearby school is recorded.')).toBeInTheDocument();
    expect(screen.getByText(/school distance m/)).toBeInTheDocument();
  });

  it('does not offer chat requests to guests', () => {
    render(<HousingChat user={null} homes={[]} brief={defaultBrief} onSearch={vi.fn()} workspaceReady />);
    fireEvent.click(screen.getByRole('button', { name: 'Open housing assistant' }));
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Find 4-room flats/ })).toBeDisabled();
  });
});
