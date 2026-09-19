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
      timeoutMs: 150000,
      script: `
const deviceId=${JSON.stringify(deviceId)};
if(document.visibilityState!=='visible'||!document.hasFocus())throw Error('Activate the product window');
const before=(await invoke('android_state')).statuses.find(s=>s.deviceId===deviceId);
if(before?.phase!=='running'||!before.display)throw Error('Open the prepared phone first');
const [width,height]=before.display;
const pane=document.querySelector('[data-android-pane-id]');
if(!pane)throw Error('No visible Android panel');
const host=pane.querySelector('.android-viewport');
const zoom=async value=>{
 pane.querySelector('[aria-label="Screen zoom"]').click();await sleep(100);
 const option=[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===value);
 if(!option)throw Error('Missing zoom '+value);option.click();await sleep(600);
};
const menu=async label=>{pane.querySelector('[aria-label="Android actions"]').click();await sleep(100);click(label);await sleep(1600);};
const read=async()=>new DOMParser().parseFromString(await invoke('android_probe_product_guest',{deviceId,action:'screen'}),'application/xml');
await invoke('android_probe_product_guest',{deviceId,action:'launch'});await sleep(1000);
const results=[];
for(let turn=0;turn<4;turn++){
 if(turn)await menu('Rotate phone');
 for(const level of ['Fit','100%','200%','300%']){
  await zoom(level);
  const canvas=pane.querySelector('.android-screen');
  if(canvas.width*canvas.height>720*1280||Math.max(canvas.width,canvas.height)>1280)throw Error('Unbounded preview');
  host.scrollTop=Math.min(200,host.scrollHeight-host.clientHeight);
  host.scrollLeft=Math.min(100,host.scrollWidth-host.clientWidth);
  const r=canvas.getBoundingClientRect(),box=host.getBoundingClientRect();
  const scale=Math.min(r.width/canvas.width,r.height/canvas.height);
  const left=r.left+(r.width-canvas.width*scale)/2,top=r.top+(r.height-canvas.height*scale)/2;
  const x=(Math.max(left,box.left)+Math.min(left+canvas.width*scale,box.right))/2;
  const y=(Math.max(top,box.top)+Math.min(top+canvas.height*scale,box.bottom))/2;
  const u=(x-left)/(canvas.width*scale),v=(y-top)/(canvas.height*scale);
  for(const phase of ['down','up'])await invoke('android_probe_native_pointer',{phase,x,y});
  await sleep(200);
  const doc=await read(),rotation=Number(doc.documentElement.getAttribute('rotation'));
  const label=[...doc.querySelectorAll('node')].map(n=>n.getAttribute('text')).find(t=>/^Touch /.test(t));
  const actual=label?.match(/^Touch ([0-9]+),([0-9]+) action ([0-9]+)$/)?.slice(1).map(Number);
  const expected=[Math.round((turn%2?height:width)*u),Math.round((turn%2?width:height)*v),1];
  if(rotation!==turn||!actual||actual[2]!==1||actual.slice(0,2).some((value,i)=>Math.abs(value-expected[i])>2))
    throw Error(JSON.stringify({turn,level,rotation,actual,expected}));
  results.push({turn,level,actual,expected,framebuffer:[canvas.width,canvas.height],css:[r.width,r.height],scroll:[host.scrollLeft,host.scrollTop],dpr:devicePixelRatio});
 }
 await zoom('Fit');
}
await menu('Rotate phone');
const after=await invoke('android_state');
if(after.statuses.find(s=>s.deviceId===deviceId)?.generation!==before.generation)throw Error('Zoom restarted Android');
if(after.streams.filter(s=>s.phase==='streaming'&&s.deviceId===deviceId).length!==1)throw Error('Expected one source');
return {completed:true,display:before.display,generation:before.generation,results,streams:after.streams};
`,
    }),
  },
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exitCode = result.status ?? 1;
