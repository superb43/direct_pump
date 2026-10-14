import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createPriceStream} from '../../src/worker/price-stream';
class Socket{
  static OPEN=1;static instances:Socket[]=[];readyState=0;sent:any[]=[];closed=false;events=new Map<string,((event:any)=>void)[]>();
  constructor(readonly url:string){Socket.instances.push(this);}
  addEventListener(name:string,callback:(event:any)=>void){this.events.set(name,[...(this.events.get(name)??[]),callback]);}
  emit(name:string,event:any={}){for(const callback of this.events.get(name)??[])callback(event);}
  send(value:string){this.sent.push(JSON.parse(value));}
  close(){this.closed=true;this.readyState=3;this.emit('close');}
  open(){this.readyState=1;this.emit('open');}
  message(value:unknown){this.emit('message',{data:JSON.stringify(value)});}
  ack(){for(const request of [...this.sent].filter(value=>value.method==='accountSubscribe'))this.message({id:request.id,result:request.id+100});}
}
beforeEach(()=>{vi.useFakeTimers();Socket.instances=[];vi.stubGlobal('WebSocket',Socket);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('shares subscriptions, requires acknowledgement and ignores duplicate or older notifications',()=>{
  const changed=vi.fn(),stream=createPriceStream('wss://test',changed,()=>{});stream.update(['pool','pool']);const socket=Socket.instances[0]!;socket.open();
  expect(socket.sent).toHaveLength(1);expect(socket.sent[0].params[1].commitment).toBe('confirmed');expect(stream.hasLive('pool')).toBe(false);socket.ack();expect(stream.hasLive('pool')).toBe(true);
  const notification=(slot:number,value:string)=>({method:'accountNotification',params:{subscription:101,result:{context:{slot},value}}});
  socket.message(notification(10,'a'));socket.message(notification(10,'a'));socket.message(notification(9,'b'));socket.message(notification(10,'b'));
  expect(changed.mock.calls).toEqual([['pool',10,'a',true],['pool',10,'b',true]]);stream.destroy();expect(socket.closed).toBe(true);
});
it('updates an unchanged observation without scheduling another price calculation',()=>{
 const changed=vi.fn(),stream=createPriceStream('wss://test',changed,()=>{});stream.update(['pool']);const socket=Socket.instances[0]!;socket.open();socket.ack();
 for(const slot of [10,11])socket.message({method:'accountNotification',params:{subscription:101,result:{context:{slot},value:{data:['','base64']}}}});
 expect(changed.mock.calls.map(call=>call[3])).toEqual([true,false]);stream.destroy();
});
it('does not resurrect a removed address when a late subscription acknowledgement arrives',()=>{
  const stream=createPriceStream('wss://test',()=>{},()=>{});stream.update(['old','kept']);const socket=Socket.instances[0]!;socket.open();stream.update(['kept']);socket.ack();
  expect(stream.hasLive('old')).toBe(false);expect(stream.hasLive('kept')).toBe(true);expect(socket.sent.some(value=>value.method==='accountUnsubscribe'&&value.params[0]===101)).toBe(true);stream.destroy();
});
it('falls back on connection loss, reconnects and resubscribes without accepting old socket events',async()=>{
  const changed=vi.fn(),stream=createPriceStream('wss://test',changed,()=>{});stream.update(['pool']);const old=Socket.instances[0]!;old.open();old.ack();old.close();expect(stream.hasLive('pool')).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);const next=Socket.instances[1]!;next.open();next.ack();expect(stream.hasLive('pool')).toBe(true);
  old.message({method:'accountNotification',params:{subscription:101,result:{context:{slot:10},value:'old'}}});expect(changed).not.toHaveBeenCalled();stream.destroy();
});
it('uses an 8s acknowledgement deadline and tears down reconnect and heartbeat when inactive',async()=>{
  const stream=createPriceStream('wss://test',()=>{},()=>{});stream.update(['pool']);const socket=Socket.instances[0]!;socket.open();await vi.advanceTimersByTimeAsync(8000);expect(socket.closed).toBe(true);
  stream.update([]);await vi.advanceTimersByTimeAsync(30_000);expect(Socket.instances).toHaveLength(1);stream.destroy();
});
it('sends the Solana ping notification within the Chrome service-worker activity window',async()=>{
  const stream=createPriceStream('wss://test',()=>{},()=>{});stream.update(['pool']);const socket=Socket.instances[0]!;socket.open();socket.ack();await vi.advanceTimersByTimeAsync(20_000);
  expect(socket.sent.some(value=>value.method==='ping'&&value.id===undefined)).toBe(true);stream.destroy();
});
