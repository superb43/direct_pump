import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SITE_CONTEXTS } from './fixtures/site-contexts';
import type { PageTarget } from '../src/model';

const mocked = vi.hoisted(() => {
 const event=()=>({addListener:vi.fn(),removeListener:vi.fn()});
 return {tabs:{query:vi.fn(),sendMessage:vi.fn(),onActivated:event(),onUpdated:event()},runtime:{id:'extension',sendMessage:vi.fn(),onMessage:event()},storage:{onChanged:event()},mount:vi.fn()};
});
vi.mock('wxt/browser',()=>({browser:mocked}));
vi.mock('../src/panel',()=>({mountPanel:mocked.mount}));
import { mountTradingWindow } from '../src/trading-window';
const mint='DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP';
const target=(site:'GMGN'|'FOMO'):PageTarget=>({site,kind:'MINT',address:mint,pageUrl:site==='GMGN'?`https://gmgn.ai/sol/token/${mint}`:`https://fomo.family/tokens/solana/${mint}`});
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
beforeEach(()=>{
 vi.useFakeTimers();vi.clearAllMocks();
 const nodes=new Map();vi.stubGlobal('document',{body:{classList:{add:vi.fn()}},querySelector:(selector:string)=>{if(!nodes.has(selector))nodes.set(selector,{hidden:false,textContent:'',addEventListener:vi.fn(),removeEventListener:vi.fn()});return nodes.get(selector);}});
 vi.stubGlobal('window',{setInterval,clearInterval,addEventListener:vi.fn(),removeEventListener:vi.fn()});
 mocked.mount.mockImplementation(()=>({destroy:vi.fn(),updateContext:vi.fn(),updateMarket:vi.fn(),showReceipt:vi.fn(),reloadSettings:vi.fn(),isBusy:()=>true}));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

it('switches active token tabs while the previous panel has a pending order',async()=>{
 let site:'GMGN'|'FOMO'='GMGN';let id=1;
 mocked.tabs.query.mockImplementation(async()=>[{id,url:target(site).pageUrl}]);
 mocked.tabs.sendMessage.mockImplementation(async()=>({target:target(site)}));
 const window=mountTradingWindow();await flush();const old=mocked.mount.mock.results[0]!.value;
 site='FOMO';id=2;await vi.advanceTimersByTimeAsync(1000);await flush();
 expect(old.destroy).toHaveBeenCalledOnce();expect(mocked.mount).toHaveBeenCalledTimes(2);expect(mocked.mount.mock.calls[1]![0].site).toBe('FOMO');window.destroy();
});

it('ignores a slow context reply from a previous tab',async()=>{
 let resolve!:(value:unknown)=>void;
 mocked.tabs.query.mockResolvedValueOnce([{id:1,url:target('GMGN').pageUrl}]).mockResolvedValue([{id:2,url:target('FOMO').pageUrl}]);
 mocked.tabs.sendMessage.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({target:target('FOMO')});
 const window=mountTradingWindow();await flush();await window.refresh();await flush();
 resolve({target:target('GMGN')});await flush();
 expect(mocked.mount).toHaveBeenCalledOnce();expect(mocked.mount.mock.calls[0]![0].site).toBe('FOMO');window.destroy();
});

it('invalidates missing market data and ignores another page market update',async()=>{
 mocked.tabs.query.mockResolvedValue([{id:1,url:target('GMGN').pageUrl}]);mocked.tabs.sendMessage.mockResolvedValue({target:target('GMGN')});
 const window=mountTradingWindow();await flush();const panel=mocked.mount.mock.results[0]!.value;
 expect(panel.updateMarket).toHaveBeenLastCalledWith(undefined);
 const onMarket=mocked.runtime.onMessage.addListener.mock.calls[0]![0];
 onMarket({type:'MARKET_UPDATE',target:target('FOMO'),market:{mint,priceUsd:'99'}},{id:'extension',tab:{id:1},frameId:0});
 expect(panel.updateMarket).toHaveBeenCalledOnce();window.destroy();
 expect(mocked.tabs.onActivated.removeListener).toHaveBeenCalledOnce();expect(mocked.runtime.onMessage.removeListener).toHaveBeenCalledOnce();
});

for (const context of SITE_CONTEXTS) {
 it(`${context.site}: lets a slow same-tab context complete without accumulating requests`, async () => {
  let resolve!:(value:unknown)=>void;
  mocked.tabs.query.mockResolvedValue([{id:1,url:context.target.pageUrl}]);
  mocked.tabs.sendMessage.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const window=mountTradingWindow();await flush();
  await vi.advanceTimersByTimeAsync(4000);await flush();
  expect(mocked.tabs.sendMessage).toHaveBeenCalledOnce();
  resolve({target:context.target});await flush();
  expect(mocked.mount).toHaveBeenCalledOnce();window.destroy();
 });
 it(`${context.site}: refreshes strict hints on the existing panel`, async () => {
  let current=context.target;
  mocked.tabs.query.mockResolvedValue([{id:1,url:current.pageUrl}]);
  mocked.tabs.sendMessage.mockImplementation(async()=>({target:current}));
  const window=mountTradingWindow();await flush();
  const panel=mocked.mount.mock.results[0]!.value;
  current={...current,poolHint:'new-pool-hint'};
  await window.refresh();await flush();
  expect(mocked.mount).toHaveBeenCalledOnce();expect(panel.destroy).not.toHaveBeenCalled();
  expect(panel.updateContext).toHaveBeenLastCalledWith(current);window.destroy();
 });
}

it('a real tab activation supersedes a coalesced slow context',async()=>{
 let resolve!:(value:unknown)=>void,id=1;
 mocked.tabs.query.mockImplementation(async()=>[{id,url:target(id===1?'GMGN':'FOMO').pageUrl}]);
 mocked.tabs.sendMessage.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({target:target('FOMO')});
 const window=mountTradingWindow();await flush();await vi.advanceTimersByTimeAsync(2000);
 expect(mocked.tabs.sendMessage).toHaveBeenCalledOnce();
 id=2;mocked.tabs.onActivated.addListener.mock.calls[0]![0]();await flush();
 resolve({target:target('GMGN')});await flush();
 expect(mocked.mount).toHaveBeenCalledOnce();expect(mocked.mount.mock.calls[0]![0].site).toBe('FOMO');window.destroy();
});
