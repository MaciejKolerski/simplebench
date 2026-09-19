import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(process.argv[2]);
const deviceId = process.argv[3];
const name = process.argv[4];
if (
  !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(deviceId ?? "") ||
  !/^[a-zA-Z0-9-]{1,50}$/.test(name ?? "")
)
  throw Error("Use a fixture device UUID and a fresh evidence name");
const result = spawnSync(
  process.execPath,
  [resolve(import.meta.dirname, "android-product-control.mjs"), root, name],
  {
    encoding: "utf8",
    input: JSON.stringify({
      window: "main",
      timeoutMs: 90000,
      script: `
const deviceId=${JSON.stringify(deviceId)};
if(document.visibilityState!=='visible'||!document.hasFocus())throw Error('Activate the product window');
const before=(await invoke('android_state')).statuses.find(s=>s.deviceId===deviceId);
if(before?.phase!=='running'||!before.display)throw Error('Open the prepared phone first');
const [width,height]=before.display;
const canvases=[...document.querySelectorAll('.android-screen')];
if(canvases.length!==2)throw Error('Prepare two docked views of the same phone');
const canvas=canvases.reduce((a,b)=>a.width<b.width?a:b);
if(canvas.width>=Math.max(...canvases.map(c=>c.width)))throw Error('The secondary framebuffer must be smaller');
const paneId=canvas.closest('[data-android-pane-id]').dataset.androidPaneId;
const pane=()=>document.querySelector('[data-android-pane-id="'+paneId+'"]');
const screen=()=>pane()?.querySelector('.android-screen');
const menu=async name=>{pane().querySelector('[aria-label="Android actions"]').click();await sleep(150);click(name);};
const read=async()=>new DOMParser().parseFromString(await invoke('android_probe_product_guest',{deviceId,action:'screen'}),'application/xml');
const results=[];
await invoke('android_probe_product_guest',{deviceId,action:'launch'});await sleep(700);
for(let turn=0;turn<4;turn++){
 if(turn){await menu('Rotate phone');await sleep(1800);}
 const current=await wait(screen),r=current.getBoundingClientRect();
 for(const phase of ['down','up'])await invoke('android_probe_native_pointer',{phase,x:r.x+r.width*.3,y:r.y+r.height*.8});
 await sleep(250);
 const doc=await read(),rotation=Number(doc.documentElement.getAttribute('rotation'));
 const label=[...doc.querySelectorAll('node')].map(n=>n.getAttribute('text')).find(t=>/^Touch /.test(t));
 const actual=label?.match(/^Touch ([0-9]+),([0-9]+) action ([0-9]+)$/)?.slice(1).map(Number);
 const expected=[Math.round((turn%2?height:width)*.3),Math.round((turn%2?width:height)*.8),1];
 if(rotation!==turn||!actual||actual[2]!==1||actual.slice(0,2).some((v,i)=>Math.abs(v-expected[i])>2))
  throw Error(JSON.stringify({turn,rotation,actual,expected}));
 results.push({turn,actual,expected,framebuffer:[current.width,current.height],css:[r.width,r.height],dpr:devicePixelRatio});
}
await menu('Rotate phone');await sleep(1800);
const fullSize=width*height<=720*1280&&Math.max(width,height)<=1280;
await menu(fullSize?'Actual size (1:1)':'Preview size (100%)');await sleep(1000);
const actual=await wait(screen);
if(fullSize&&(actual.width!==width||actual.height!==height))throw Error('Actual size lost full resolution');
if(!fullSize&&(actual.width*actual.height>720*1280||Math.max(actual.width,actual.height)>1280))throw Error('Unbounded modern preview');
const size=actual.getBoundingClientRect();
if(Math.abs(size.width*devicePixelRatio-actual.width)>2||Math.abs(size.height*devicePixelRatio-actual.height)>2)throw Error('100% does not match preview pixels');
const previewWidth=actual.width;
results.push({previewSize:[actual.width,actual.height],fullSize,css:[size.width,size.height]});
await menu('Fit to panel');await sleep(1000);
const fitted=await wait(screen);
if(fitted.width>=previewWidth)throw Error('Secondary Fit retained its full-size framebuffer');
const after=await invoke('android_state'),streams=after.streams.filter(s=>s.phase==='streaming');
if(after.statuses.find(s=>s.deviceId===deviceId)?.generation!==before.generation||streams.length!==1||streams[0].deviceId!==deviceId)
 throw Error('Input or resizing changed the shared process/source');
return {completed:true,display:before.display,results,streams,generation:before.generation};
`,
    }),
  },
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exitCode = result.status ?? 1;
