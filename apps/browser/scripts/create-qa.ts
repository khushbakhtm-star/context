import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptBatch } from '../shared/sync/codec';

// Synthetic local preview only. This script never reads OAuth credentials or real notes.
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const target = resolve(root, 'tmp/context-browser-synthetic-preview');
const now = new Date(); const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const minute = now.getHours() * 60 + now.getMinutes(); const timestamp = now.toISOString();
const phrase = 'synthetic-preview-passphrase';
const fixtureId = `synthetic_phone_${now.getTime()}`; const wall = String(now.getTime()).padStart(16, '0');
const ciphertext = await encryptBatch({ version: 1, id: fixtureId, documents: [
  { key: 'category:coffee', revision: `${wall}:00000000:synthetic_phone`, value: { id: 'coffee', name: 'Coffee', color: '#E1E1E1' } },
  { key: `minute:${day}:${minute}`, revision: `${wall}:00000001:synthetic_phone`, value: {
    id: 'synthetic_note', dateKey: day, minuteIndex: minute, text: 'Synthetic coffee note', categoryId: 'coffee', blockId: 'synthetic_coffee_activity', source: 'manual', createdAt: timestamp, updatedAt: timestamp } },
] }, phrase);
await mkdir(target, { recursive: true });
for (const name of ['app.js', 'app.css', 'context-app-logo.png', 'config.json']) await copyFile(resolve(root, 'apps/browser/dist', name), resolve(target, name));
let html = await readFile(resolve(root, 'apps/browser/dist/index.html'), 'utf8');
html = html.replace('<script src="https://accounts.google.com/gsi/client" async defer></script>', '<script src="./synthetic-google.js"></script>');
html = html.replace('<title>Context</title>', '<title>Context — synthetic preview</title>').replace('<body>', '<body><div style="position:fixed;right:80px;top:24px;z-index:8;font:12px system-ui;color:#777;pointer-events:none">Sample preview</div>');
await writeFile(resolve(target, 'index.html'), html, 'utf8');
const bootstrap = `const realFetch=window.fetch.bind(window);let cloud=${JSON.stringify(ciphertext)};const fixtureId=${JSON.stringify(fixtureId)};const uploaded=new Map();
window.google={accounts:{oauth2:{initTokenClient(options){return{requestAccessToken(){options.callback({access_token:'synthetic-only-token',expires_in:3600,scope:'openid email https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly'});}};}}}};
window.fetch=async(input,init={})=>{const url=String(input);const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
if(url.startsWith('https://openidconnect.googleapis.com/'))return json({sub:'synthetic_browser_preview',email:'synthetic@example.invalid'});
if(url.startsWith('https://www.googleapis.com/')){
if(url.includes('/generateIds?'))return json({ids:['synthetic_upload_'+crypto.randomUUID().replaceAll('-','')]});
if(url.includes('/upload/')){const body=String(init.body);const parts=body.split('Content-Type: application/json\\r\\n\\r\\n');const metadata=JSON.parse(body.split('\\r\\n\\r\\n')[1].split('\\r\\n')[0]);const text=parts[1].split('\\r\\n--')[0];uploaded.set(metadata.id,{name:metadata.name,text});return json({id:metadata.id,name:metadata.name});}
if(url.includes('alt=media')){const id=new URL(url).pathname.split('/').pop();return new Response(uploaded.get(id)?.text??cloud);}
if(url.includes('/calendar/v3/users/me/calendarList'))return json({items:[{id:'synthetic_calendar',summary:'Synthetic plans',backgroundColor:'#E1E1E1',primary:true}]});
if(url.includes('/calendar/v3/colors'))return json({event:{10:{background:'#51B749'}}});
if(url.includes('/calendar/v3/calendars/'))return json({items:[{id:'synthetic_plan',summary:'Synthetic reading plan',start:{dateTime:${JSON.stringify(new Date(now.getTime() + 5 * 60_000).toISOString())}},end:{dateTime:${JSON.stringify(new Date(now.getTime() + 15 * 60_000).toISOString())}},colorId:'10'}]});
return json({files:[{id:fixtureId,name:'context-'+fixtureId+'.json'},...[...uploaded.entries()].map(([id,value])=>({id,name:value.name}))]});}
if(url.startsWith('http')&&!url.startsWith(location.origin))throw Error('Synthetic preview blocks external requests.');return realFetch(input,init);};
`;
await writeFile(resolve(target, 'synthetic-google.js'), bootstrap, 'utf8');
process.stdout.write(`Synthetic preview created at ${target}\nPassphrase: ${phrase}\nCurrent fixture minute: ${day} ${minute}\n`);
