import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(process.argv[2]);
const devices = process.argv.slice(3, 5);
const name = process.argv[5];
if (
  devices.length !== 2 ||
  devices[0] === devices[1] ||
  devices.some(
    (id) => !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id),
  ) ||
  !/^[a-zA-Z0-9-]{1,50}$/.test(name ?? "")
)
  throw Error("Use two running fixture device UUIDs and a fresh evidence name");

const result = spawnSync(
  process.execPath,
  [resolve(import.meta.dirname, "android-product-control.mjs"), root, name],
  {
    encoding: "utf8",
    input: JSON.stringify({
      window: "main",
      timeoutMs: 120000,
      script: `
const devices=${JSON.stringify(devices)};
const statuses=async()=> (await invoke('android_state')).statuses.filter(s=>devices.includes(s.deviceId));
const before=await statuses();
if(before.length!==2||before.some(s=>s.phase!=='running'))throw Error('Both phones must already be running');
const marker=await invoke('android_probe_product_guest',{deviceId:devices[0],action:'marker-read'});
const tabs=[...document.querySelectorAll('[data-tab-id]')].map(t=>t.dataset.tabId);
if(document.querySelector('dialog'))throw Error('Resolve unrelated dialogs before this trial');
await invoke('plugin:window|close',{label:'main'});
const partial=await wait(async()=>{
 const values=await statuses();
 return values.some(s=>!s.processAlive&&s.phase==='stopped')&&values.some(s=>s.processAlive)?values:null;
},30000);
click('Cancel closing');
await wait(()=>!document.querySelector('dialog'),90000);
await sleep(1000);
const after=await statuses();
if(after.some(s=>s.processAlive||s.phase!=='stopped'))throw Error('Cancelled close did not settle both real child processes');
const remaining=[...document.querySelectorAll('[data-tab-id]')].map(t=>t.dataset.tabId);
if(JSON.stringify(tabs)!==JSON.stringify(remaining))throw Error('Cancelled close changed descriptors');
// Explicit Start proves the preparation gate was released after cancellation.
const started=await invoke('android_start',{deviceId:devices[0]});
if(started.phase!=='running'||started.generation===before.find(s=>s.deviceId===devices[0]).generation)
 throw Error('Explicit Start after cancellation did not create a fresh live generation');
const other=(await statuses()).find(s=>s.deviceId===devices[1]);
if(other.processAlive||other.phase!=='stopped')throw Error('Cancellation automatically restarted the other phone');
const retained=await invoke('android_probe_product_guest',{deviceId:devices[0],action:'marker-read'});
if(!marker.trim()||retained!==marker)throw Error('The restarted guest did not retain its data');
return {completed:true,before,partial,after,tabsPreserved:true,explicitStart:started,otherRemainsStopped:other,dataMarker:retained};
`,
    }),
  },
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exitCode = result.status ?? 1;
