import {it,expect,vi} from 'vitest';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {createProServer} from '../../server/api';
import type {ProEngine} from '../../server/engine';
it('streams authenticated event cursors and closes delivery when the device is revoked',async()=>{
  vi.useFakeTimers();
  try{
    const event={sequence:2,id:'event-two',at:Date.now(),type:'CONFIRMED',message:'Confirmed.'};
    const events=vi.fn((after:number)=>after<2?[event]:[]);
    let active=true;
    const auth={verify:vi.fn(async()=> 'paired-device'),active:vi.fn(async()=>active),pair:vi.fn()};
    const server=createProServer({store:{events}} as unknown as ProEngine,auth,'server');
    const request=Object.assign(Readable.from([]),{method:'GET',url:'/v1/events/stream?after=1',headers:{}});
    const writes:string[]=[];let ended=false;
    const response=Object.assign(new EventEmitter(),{statusCode:200,setHeader:vi.fn(),flushHeaders:vi.fn(),write:(text:string)=>{writes.push(text);return true;},end:()=>{ended=true;},writableNeedDrain:false});
    server.emit('request',request,response);await vi.advanceTimersByTimeAsync(1);
    expect(auth.verify).toHaveBeenCalledOnce();expect(response.setHeader).toHaveBeenCalledWith('content-type','text/event-stream');expect(writes.join('')).toContain('event-two');expect(events).toHaveBeenCalledWith(1);
    await vi.advanceTimersByTimeAsync(1000);expect(writes.join('').match(/event-two/g)).toHaveLength(1);expect(events).toHaveBeenCalledWith(2);
    active=false;await vi.advanceTimersByTimeAsync(1000);expect(ended).toBe(true);expect(vi.getTimerCount()).toBe(0);
  }finally{vi.useRealTimers();}
});
it('requires revocation-aware authentication before opening a stream',async()=>{
  const server=createProServer({store:{events:()=>[]}} as unknown as ProEngine,{verify:async()=> 'device',pair:vi.fn()},'server');
  const request=Object.assign(Readable.from([]),{method:'GET',url:'/v1/events/stream',headers:{}});
  let output='';const response={statusCode:200,setHeader(){},end(text:string){output=text;}};
  server.emit('request',request,response);await new Promise(resolve=>setTimeout(resolve,5));
  expect(JSON.parse(output).ok).toBe(false);expect(output).toContain('unavailable');
});
