const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export async function createPlanSnapshot(home, decision, origin = window.location.origin) {
 if (!crypto.subtle) throw new Error('Private snapshot links require HTTPS or localhost.');
 const payload = { version:1, createdAt:new Date().toISOString(), home:{address:home.address,town:home.town,type:home.type,price:home.price,sourceUpdated:home.sourceUpdated}, decision:{status:decision.status||'research',notes:decision.notes||'',pros:decision.pros||'',cons:decision.cons||'',ratings:decision.ratings||[],visitDate:decision.visitDate||'',checklist:decision.checklist||{},checklistLabels:decision.checklistLabels||{}} };
 const bytes = new TextEncoder().encode(JSON.stringify(payload));
 if(bytes.length>24000) throw new Error('This decision is too large for a snapshot link. Shorten the notes before sharing.');
 const key = await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
 const iv = crypto.getRandomValues(new Uint8Array(12));
 const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes);
 return `${origin}/shared-plan#v=1&key=${encode(await crypto.subtle.exportKey('raw',key))}&iv=${encode(iv)}&data=${encode(ciphertext)}`;
}
export async function readPlanSnapshot(hash) {
 if (hash.length>35000) throw new Error('This snapshot link is too large.');
 try {
  const params = new URLSearchParams(hash.replace(/^#/,''));
  if(params.get('v')!=='1') throw new Error();
  const key = await crypto.subtle.importKey('raw',decode(params.get('key')||''),{name:'AES-GCM'},false,['decrypt']);
  const bytes = await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(params.get('iv')||'')},key,decode(params.get('data')||''));
  const snapshot = JSON.parse(new TextDecoder().decode(bytes));
  const d=snapshot.decision,h=snapshot.home;
  if (!Number.isFinite(new Date(snapshot.createdAt).getTime())) throw new Error();
  if(!d||!d.checklist||Array.isArray(d.checklist)||typeof d.checklist!=="object"||Object.keys(d.checklist).length>50||Object.values(d.checklist).some(v=>typeof v!=="boolean")||!d.checklistLabels||Array.isArray(d.checklistLabels)||typeof d.checklistLabels!=="object"||Object.values(d.checklistLabels).some(v=>typeof v!=="string"))throw new Error();
  if(snapshot.version!==1||!h||typeof h.address!=='string'||!d||!['research','visit','considering','ruled-out'].includes(d.status)||!['notes','pros','cons','visitDate'].every(k=>typeof d[k]==='string')||!Array.isArray(d.ratings)||d.ratings.length>20||d.ratings.some(r=>typeof r.name!=='string'||!Number.isInteger(r.score)||r.score<1||r.score>5))throw new Error();
  return snapshot;
 } catch { throw new Error('This snapshot link is incomplete or invalid. Ask the plan owner for a new link.'); }
}
