import {browser,type Browser} from 'wxt/browser';

/** Private-view lifecycle only; no history or credentials pass through site content. */
export function createPriceWatch(){
  let port:Browser.runtime.Port|undefined,wallet:string|undefined,filter:string|undefined,stopped=false;
  let reconnect:ReturnType<typeof setTimeout>|undefined;
  function connect(){
    if(stopped||!wallet||port||typeof browser.runtime.connect!=='function')return;
    try{
      const current=browser.runtime.connect({name:'portfolio-prices'});port=current;
      current.onDisconnect.addListener(()=>{if(port!==current)return;port=undefined;if(!stopped&&wallet)reconnect=setTimeout(connect,1000);});
      current.postMessage({type:'WATCH',wallet,mint:filter});
    }catch{if(!stopped&&wallet)reconnect=setTimeout(connect,1000);}
  }
  function update(account:string|undefined,active:boolean,mint?:string){
    const next=active?account:undefined;
    if(next===wallet&&mint===filter&&port)return;
    wallet=next;filter=mint;
    if(reconnect!==undefined)clearTimeout(reconnect);reconnect=undefined;
    if(!wallet){const old=port;port=undefined;old?.disconnect();return;}
    if(port)port.postMessage({type:'WATCH',wallet,mint:filter});else connect();
  }
  function destroy(){stopped=true;update(undefined,false);}
  return {update,destroy};
}
