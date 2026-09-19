import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(process.argv[2]);
const deviceId = process.argv[3];
const name = process.argv[4];
if (
  !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(deviceId ?? "") ||
  !/^[a-zA-Z0-9-]{1,50}$/.test(name ?? "")
)
  throw Error("Use an isolated fixture UUID and a fresh evidence name");

const result = spawnSync(
  process.execPath,
  [resolve(import.meta.dirname, "android-product-control.mjs"), root, name],
  {
    encoding: "utf8",
    input: JSON.stringify({
      window: "main",
      timeoutMs: 240000,
      script: `
const deviceId=${JSON.stringify(deviceId)};
click('Android views');
await wait(()=>document.querySelectorAll('.android-screen').length===2);
const before=await invoke('android_state');
const original=before.statuses.find(s=>s.deviceId===deviceId);
if(original?.phase!=='running'||before.preferences.defaultDeviceId!==deviceId)
 throw Error('Prepare exactly two references to the running default fixture phone');
const marker=await invoke('android_probe_product_guest',{deviceId,action:'marker-write'});
document.querySelector('[aria-label="Close Android panel"]').click();
await wait(()=>document.querySelectorAll('.android-screen').length===1);
const shared=(await invoke('android_state')).statuses.find(s=>s.deviceId===deviceId);
if(shared?.generation!==original.generation||!shared.processAlive)throw Error('Closing one view stopped the shared phone');
const stopping=performance.now();
document.querySelector('[aria-label="Close Android panel"]').click();
await wait(()=>!document.querySelector('[data-android-pane-id]'),90000);
const stopped=(await invoke('android_state')).statuses.find(s=>s.deviceId===deviceId);
if(stopped?.processAlive||stopped?.phase!=='stopped')throw Error('Last-view removal did not confirm process exit');
const stopMs=performance.now()-stopping;
const plus=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.startsWith('New tab'));
if(!plus)throw Error('Missing new-tab menu');
const starting=performance.now();plus.click();await sleep(150);click('New android symulator');
await wait(async()=>{
 const state=await invoke('android_state');
 return state.statuses.find(s=>s.deviceId===deviceId)?.phase==='running'&&document.querySelector('.android-screen');
},180000);
const bootMs=performance.now()-starting;
await wait(async()=>(await invoke('android_state')).streams.some(s=>s.deviceId===deviceId&&s.phase==='streaming'));
const after=await invoke('android_state'),reopened=after.statuses.find(s=>s.deviceId===deviceId);
const retained=await invoke('android_probe_product_guest',{deviceId,action:'marker-read'});
if(reopened.generation===original.generation||retained.trim()!==marker.trim())throw Error('Reopening lost guest data or reused an exited process');
if(after.streams.filter(s=>s.phase==='streaming').length!==1)throw Error('Reopening did not create one source');
return {completed:true,original,shared,stopped,reopened,stopMs,bootMs,markerRetained:true,streams:after.streams};
`,
    }),
  },
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exitCode = result.status ?? 1;
