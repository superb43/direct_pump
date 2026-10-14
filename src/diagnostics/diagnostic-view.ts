import {browser} from 'wxt/browser';
import type {WorkerResponse} from '../model';

export function mountDiagnosticView(container:HTMLElement):void{
  const title=document.createElement('h2');title.textContent='Diagnostics';
  const search=document.createElement('input');search.placeholder='Search event, order ID or signature';search.setAttribute('aria-label','Search diagnostics');
  const refresh=document.createElement('button');refresh.textContent='Load diagnostics';
  const download=document.createElement('button');download.textContent='Export sanitized JSON';download.disabled=true;
  const list=document.createElement('pre');list.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;font-size:12px';list.setAttribute('aria-live','polite');
  let text='';let events:Record<string,unknown>[]=[];
  const render=()=>{const term=search.value.toLowerCase();list.textContent=events.filter(event=>JSON.stringify(event).toLowerCase().includes(term)).slice(-100).map(event=>`${new Date(Number(event.at)).toISOString()} ${event.level} ${event.type} ${event.orderId??event.signature??''} ${JSON.stringify(event.details??{})}`).join('\n')||'No matching events.';};
  search.addEventListener('input',render);
  refresh.addEventListener('click',async()=>{try{const reply=await browser.runtime.sendMessage({type:'DIAGNOSTICS',action:'EXPORT'}) as WorkerResponse;if(!reply.ok)throw new Error(reply.error);text=String(reply.data);const data=JSON.parse(text) as {events?:Record<string,unknown>[]};events=Array.isArray(data.events)?data.events:[];download.disabled=false;render();}catch(error){list.textContent=error instanceof Error?error.message:'Diagnostics unavailable.';}});
  download.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='direct-pump-diagnostics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  container.append(title,search,refresh,download,list);
}
