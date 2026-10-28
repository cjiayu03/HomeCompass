import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createPlanSnapshot, readPlanSnapshot } from '../lib/plan-share';
afterEach(()=>vi.unstubAllGlobals());
it('roundtrips a private snapshot without including photos or personal places',async()=>{
 vi.stubGlobal('crypto',webcrypto);
 const link=await createPlanSnapshot({address:'Example home',price:500000,personalPlaces:[{address:'private workplace'}]}, {notes:'讨论 ☀️',ratings:[{name:'Mei',score:4}],photos:['private-photo'],placeConstraints:['private-place']},'https://example.test');
 expect(link).not.toContain('讨论');expect(link).not.toContain('private');
 const snapshot=await readPlanSnapshot(new URL(link).hash);expect(snapshot.decision.notes).toBe('讨论 ☀️');expect(snapshot.decision.ratings).toEqual([{name:'Mei',score:4}]);expect(JSON.stringify(snapshot)).not.toContain('private');
});
it('rejects a tampered snapshot',async()=>{vi.stubGlobal('crypto',webcrypto);const link=await createPlanSnapshot({address:'Example'}, {},'https://example.test');const url=new URL(link);const params=new URLSearchParams(url.hash.slice(1));params.set('data',(params.get('data')[0]==='A'?'B':'A')+params.get('data').slice(1));await expect(readPlanSnapshot('#'+params)).rejects.toThrow('incomplete or invalid');});
