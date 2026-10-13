export const DEFAULT_PRICE_WS='wss://solana-rpc.publicnode.com';
type Pending={address?:string;timer:ReturnType<typeof setTimeout>};

/** One read-only Solana connection. Raw notifications invalidate quotes, never price them. */
export function createPriceStream(endpoint:string,onChange:(address:string,slot:number)=>void,onState:()=>void){
  const desired=new Set<string>(),subscriptions=new Map<string,number>(),byId=new Map<number,string>(),pending=new Map<number,Pending>(),seen=new Map<string,{slot:number;data:string}>();
  let socket:WebSocket|undefined,generation=0,nextId=0,failures=0,closed=false;
  let reconnect:ReturnType<typeof setTimeout>|undefined,heartbeat:ReturnType<typeof setInterval>|undefined,opening:ReturnType<typeof setTimeout>|undefined;
  function clearTimers(){if(heartbeat!==undefined)clearInterval(heartbeat);if(opening!==undefined)clearTimeout(opening);heartbeat=undefined;opening=undefined;for(const request of pending.values())clearTimeout(request.timer);pending.clear();}
  function disconnect(){generation++;clearTimers();const old=socket;socket=undefined;subscriptions.clear();byId.clear();try{old?.close();}catch{}onState();}
  function retry(){
    disconnect();if(closed||!desired.size||reconnect!==undefined)return;
    reconnect=setTimeout(()=>{reconnect=undefined;connect();},Math.min(15_000,1000*2**Math.min(failures++,4)));
  }
  function send(method:string,params:unknown[],address?:string){
    if(socket?.readyState!==WebSocket.OPEN)return;
    const id=++nextId;
    pending.set(id,{address,timer:setTimeout(retry,8000)});
    try{socket.send(JSON.stringify({jsonrpc:'2.0',id,method,params}));}catch{retry();}
  }
  function sync(){
    if(socket?.readyState!==WebSocket.OPEN)return;
    for(const [address,id]of subscriptions)if(!desired.has(address)){subscriptions.delete(address);byId.delete(id);send('accountUnsubscribe',[id]);}
    for(const address of desired)if(!subscriptions.has(address)&&![...pending.values()].some(request=>request.address===address))send('accountSubscribe',[address,{encoding:'base64',commitment:'confirmed'}],address);
    onState();
  }
  function connect(){
    if(closed||!desired.size||socket)return;
    const epoch=++generation;
    try{socket=new WebSocket(endpoint);}catch{retry();return;}
    const current=socket;
    opening=setTimeout(retry,8000);
    current.addEventListener('open',()=>{
      if(epoch!==generation)return;
      if(opening!==undefined)clearTimeout(opening);opening=undefined;
      // Matches Solana web3.js's JSON-RPC ping; activity also keeps Chrome 116+ alive.
      heartbeat=setInterval(()=>{try{current.send(JSON.stringify({jsonrpc:'2.0',method:'ping'}));}catch{retry();}},20_000);
      sync();
    });
    current.addEventListener('message',event=>{
      if(epoch!==generation)return;
      try{
        const message=JSON.parse(String(event.data));
        if(typeof message.id==='number'){
          const request=pending.get(message.id);if(!request)return;
          clearTimeout(request.timer);pending.delete(message.id);
          if(message.error){retry();return;}
          if(request.address){
            if(!Number.isSafeInteger(message.result)||message.result<0){retry();return;}
            if(!desired.has(request.address)){send('accountUnsubscribe',[message.result]);return;}
            subscriptions.set(request.address,message.result);byId.set(message.result,request.address);
            if([...desired].every(address=>subscriptions.has(address)))failures=0;
          }
          onState();return;
        }
        if(message.method!=='accountNotification')return;
        const address=byId.get(message.params?.subscription),result=message.params?.result,slot=result?.context?.slot;
        if(!address||!desired.has(address)||!Number.isSafeInteger(slot)||slot<0)return;
        const data=JSON.stringify(result.value),prior=seen.get(address);
        if(prior&&(slot<prior.slot||slot===prior.slot&&data===prior.data))return;
        seen.set(address,{slot,data});onChange(address,slot);
      }catch{/* Malformed or unrelated messages do not change financial data. */}
    });
    current.addEventListener('error',()=>{if(epoch===generation)retry();});
    current.addEventListener('close',()=>{if(epoch===generation)retry();});
  }
  function update(addresses:string[]){
    desired.clear();for(const address of addresses)desired.add(address);
    for(const address of seen.keys())if(!desired.has(address))seen.delete(address);
    if(!desired.size){if(reconnect!==undefined)clearTimeout(reconnect);reconnect=undefined;disconnect();return;}
    if(socket)sync();else if(reconnect===undefined)connect();
  }
  function destroy(){closed=true;desired.clear();if(reconnect!==undefined)clearTimeout(reconnect);reconnect=undefined;disconnect();}
  return {update,destroy,hasLive:(address:string)=>subscriptions.has(address)&&socket?.readyState===WebSocket.OPEN};
}
