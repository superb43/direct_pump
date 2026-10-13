import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SITE_CONTEXTS } from './fixtures/site-contexts';
import type { PageTarget } from '../src/model';

const mocked = vi.hoisted(() => {
 const event=()=>({addListener:vi.fn(),removeListener:vi.fn()});
 return {scripting:{executeScript:vi.fn()},tabs:{query:vi.fn(),sendMessage:vi.fn(),update:vi.fn().mockResolvedValue({}),onActivated:event(),onUpdated:event()},runtime:{id:'extension',sendMessage:vi.fn(),onMessage:event()},storage:{onChanged:event()},mount:vi.fn()};
});
vi.mock('wxt/browser',()=>({browser:mocked}));
vi.mock('../src/panel',()=>({mountPanel:mocked.mount}));
import { mountTradingWindow } from '../src/trading-window';
const mint='DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP';
const target=(site:'GMGN'|'FOMO'):PageTarget=>({site,kind:'MINT',address:mint,pageUrl:site==='GMGN'?`https://gmgn.ai/sol/token/${mint}`:`https://fomo.family/tokens/solana/${mint}`});
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
beforeEach(()=>{
 vi.useFakeTimers();vi.clearAllMocks();mocked.scripting.executeScript.mockReset();
 const nodes=new Map(['#empty','#trading','#error','#empty h1','.empty-sites'].map(selector=>[selector,{hidden:selector!=='#trading',textContent:''}]));vi.stubGlobal('document',{body:{classList:{add:vi.fn()}},querySelector:(selector:string)=>nodes.get(selector)??null});
 vi.stubGlobal('window',{setInterval,clearInterval,addEventListener:vi.fn(),removeEventListener:vi.fn()});
 mocked.mount.mockImplementation(()=>({destroy:vi.fn(),updateContext:vi.fn(),updateMarket:vi.fn(),showReceipt:vi.fn(),reloadSettings:vi.fn(),refreshPortfolio:vi.fn(),isBusy:()=>true}));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

it.each([
 'https://fomo.family/tokens/robinhood/0x98096d17e191b3da1d5f99a6d7b3584351b11e18',
 ...SITE_CONTEXTS.map(({target})=>`${target.pageUrl.split('?')[0]}?chain=eth`),
])('explains unsupported chains and resets guidance after navigation: %s',async(url)=>{
 mocked.tabs.query.mockResolvedValue([{id:1,url}]);
 const window=mountTradingWindow();await flush();
 expect(document.querySelector<HTMLElement>('#empty h1')!.textContent).toBe('Only Solana is supported');
 expect(document.querySelector<HTMLElement>('.empty-sites')!.textContent).toBe('Open a Solana token page to trade');
 expect(document.querySelector<HTMLElement>('#error')!.hidden).toBe(true);
 expect(mocked.tabs.sendMessage).not.toHaveBeenCalled();expect(mocked.runtime.sendMessage).not.toHaveBeenCalled();expect(mocked.mount).not.toHaveBeenCalled();
 mocked.tabs.query.mockResolvedValue([{id:1,url:'https://example.com'}]);await window.refresh();await flush();
 expect(document.querySelector<HTMLElement>('#empty h1')!.textContent).toBe('Open a token page to trade');
 expect(document.querySelector<HTMLElement>('.empty-sites')!.textContent).toBe('GMGN · AXIOM · FOMO');
 mocked.tabs.query.mockResolvedValue([{id:1,url:target('FOMO').pageUrl}]);mocked.tabs.sendMessage.mockResolvedValue({target:target('FOMO')});await window.refresh();await flush();
 expect(document.querySelector<HTMLElement>('#empty')!.hidden).toBe(true);expect(mocked.mount).toHaveBeenCalledOnce();window.destroy();
});

it.each([undefined,{id:1,url:'https://example.com'},{id:1,url:'https://gmgn.ai/sol'}])('shows ordinary empty tabs without errors or Pro requests (%j)',async(tab)=>{
 mocked.tabs.query.mockResolvedValue(tab?[tab]:[]);
 const window=mountTradingWindow();await flush();await vi.advanceTimersByTimeAsync(2000);
 expect(document.querySelector<HTMLElement>('#empty')!.hidden).toBe(false);
 expect(document.querySelector<HTMLElement>('#error')!.textContent).toBe('');expect(document.querySelector<HTMLElement>('#error')!.hidden).toBe(true);
 expect(mocked.tabs.sendMessage).not.toHaveBeenCalled();expect(mocked.runtime.sendMessage).not.toHaveBeenCalled();expect(mocked.mount).not.toHaveBeenCalled();window.destroy();
});

it.each(SITE_CONTEXTS)('$site clears real connection errors when token context is missing or recovers',async({target})=>{
 mocked.tabs.query.mockResolvedValue([{id:1,url:target.pageUrl}]);
 mocked.tabs.sendMessage.mockRejectedValueOnce(new Error('Connection failed. Reload the token page.'));
 const window=mountTradingWindow();await flush();
 expect(document.querySelector<HTMLElement>('#empty')!.hidden).toBe(false);
 expect(document.querySelector<HTMLElement>('#error')!.textContent).toBe('Connection failed. Reload the token page.');expect(document.querySelector<HTMLElement>('#error')!.hidden).toBe(false);
 mocked.tabs.sendMessage.mockResolvedValue({target:null});await window.refresh();await flush();
 expect(document.querySelector<HTMLElement>('#empty')!.hidden).toBe(false);expect(document.querySelector<HTMLElement>('#error')!.hidden).toBe(true);expect(document.querySelector<HTMLElement>('#error')!.textContent).toBe('');expect(mocked.mount).not.toHaveBeenCalled();
 mocked.tabs.sendMessage.mockResolvedValue({target});await window.refresh();await flush();
 expect(document.querySelector<HTMLElement>('#empty')!.hidden).toBe(true);expect(mocked.mount).toHaveBeenCalledOnce();
 mocked.tabs.sendMessage.mockRejectedValueOnce(new Error('Connection failed again.'));await window.refresh();await flush();
 expect(document.querySelector<HTMLElement>('#error')!.hidden).toBe(false);expect(mocked.mount.mock.results[0]!.value.destroy).toHaveBeenCalledOnce();
 await window.refresh();await flush();expect(document.querySelector<HTMLElement>('#empty')!.hidden).toBe(true);expect(document.querySelector<HTMLElement>('#error')!.textContent).toBe('');expect(document.querySelector<HTMLElement>('#error')!.hidden).toBe(true);
 mocked.tabs.query.mockResolvedValue([{id:1,url:'https://example.com'}]);await window.refresh();await flush();
 expect(document.querySelector<HTMLElement>('#empty')!.hidden).toBe(false);expect(document.querySelector<HTMLElement>('#error')!.hidden).toBe(true);expect(mocked.mount.mock.results[1]!.value.destroy).toHaveBeenCalledOnce();
 expect(mocked.runtime.sendMessage).not.toHaveBeenCalled();window.destroy();
});

it.each(SITE_CONTEXTS)('$site rejects mismatched context and clears the error on an unsupported tab',async({target})=>{
 mocked.tabs.query.mockResolvedValue([{id:1,url:target.pageUrl}]);mocked.tabs.sendMessage.mockResolvedValue({target:{...target,address:'different-token'}});
 const window=mountTradingWindow();await flush();
 expect(mocked.mount).not.toHaveBeenCalled();expect(document.querySelector<HTMLElement>('#error')!.hidden).toBe(false);expect(document.querySelector<HTMLElement>('#error')!.textContent).toContain('does not match the active tab');
 mocked.tabs.query.mockResolvedValue([{id:2,url:'https://example.com'}]);await window.refresh();await flush();
 expect(document.querySelector<HTMLElement>('#empty')!.hidden).toBe(false);expect(document.querySelector<HTMLElement>('#error')!.textContent).toBe('');expect(document.querySelector<HTMLElement>('#error')!.hidden).toBe(true);window.destroy();
});

it('ignores a late connection error after switching to an unsupported tab',async()=>{
 let reject!:(reason:Error)=>void;
 mocked.tabs.query.mockResolvedValueOnce([{id:1,url:target('GMGN').pageUrl}]).mockResolvedValue([{id:2,url:'https://example.com'}]);
 mocked.tabs.sendMessage.mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;}));
 const window=mountTradingWindow();await flush();await window.refresh();await flush();
 reject(new Error('Old tab connection failed.'));await flush();
 expect(document.querySelector<HTMLElement>('#empty')!.hidden).toBe(false);expect(document.querySelector<HTMLElement>('#error')!.hidden).toBe(true);expect(document.querySelector<HTMLElement>('#error')!.textContent).toBe('');expect(mocked.mount).not.toHaveBeenCalled();window.destroy();
});

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
it.each(SITE_CONTEXTS)('$site sends portfolio reads directly and navigates only the owned supported tab',async({target})=>{
 mocked.tabs.query.mockResolvedValue([{id:1,url:target.pageUrl}]);mocked.tabs.sendMessage.mockResolvedValue({target});mocked.runtime.sendMessage.mockResolvedValue({ok:true});
 const window=mountTradingWindow();await flush();
 const [,send,options]=mocked.mount.mock.calls[0]!;
 const relayCalls=mocked.tabs.sendMessage.mock.calls.length;
 await send({type:'PORTFOLIO',wallet:'wallet'});expect(mocked.runtime.sendMessage).toHaveBeenCalledWith({type:'PORTFOLIO',wallet:'wallet'});expect(mocked.tabs.sendMessage).toHaveBeenCalledTimes(relayCalls);
 options.navigate('https://attacker.test');expect(mocked.tabs.update).not.toHaveBeenCalled();
 options.navigate(target.pageUrl);expect(mocked.tabs.update).toHaveBeenCalledWith(1,{url:target.pageUrl});
 window.destroy();options.navigate(target.pageUrl);expect(mocked.tabs.update).toHaveBeenCalledOnce();
});
it('refreshes holdings on worker updates and rejects notifications relayed from site content',async()=>{
 mocked.tabs.query.mockResolvedValue([{id:1,url:target('GMGN').pageUrl}]);mocked.tabs.sendMessage.mockResolvedValue({target:target('GMGN')});
 const window=mountTradingWindow();await flush();const panel=mocked.mount.mock.results[0]!.value,onMessage=mocked.runtime.onMessage.addListener.mock.calls[0]![0];
 onMessage({type:'PORTFOLIO_UPDATED',wallet:'wallet'},{id:'extension',tab:{id:1}});expect(panel.refreshPortfolio).not.toHaveBeenCalled();
 onMessage({type:'PORTFOLIO_UPDATED',wallet:'wallet'},{id:'extension'});expect(panel.refreshPortfolio).toHaveBeenCalledOnce();window.destroy();
});

const missingReceiver = new Error('Could not establish connection. Receiving end does not exist.');
it.each(SITE_CONTEXTS)('$site restores a missing receiver in the verified document without reloading the page',async({target})=>{
 mocked.tabs.query.mockResolvedValue([{id:1,url:target.pageUrl,status:'complete'}]);
 mocked.tabs.sendMessage.mockRejectedValueOnce(missingReceiver).mockResolvedValue({target});
 mocked.scripting.executeScript.mockResolvedValueOnce([{documentId:'current-document',result:target.pageUrl}]).mockResolvedValue([]);
 const window=mountTradingWindow();await flush();
 expect(mocked.scripting.executeScript.mock.calls.slice(1).map(([args])=>args)).toEqual([
  {target:{tabId:1,documentIds:['current-document']},world:'MAIN',files:['/content-scripts/chart.js']},
  {target:{tabId:1,documentIds:['current-document']},world:'ISOLATED',files:['/content-scripts/content.js']},
 ]);
 expect(mocked.tabs.sendMessage).toHaveBeenLastCalledWith(1,{type:'PANEL_CONTEXT'},{documentId:'current-document'});
 expect(mocked.mount).toHaveBeenCalledOnce();expect(document.querySelector<HTMLElement>('#error')!.hidden).toBe(true);
 expect(mocked.tabs.update).not.toHaveBeenCalled();expect(mocked.runtime.sendMessage).not.toHaveBeenCalled();
 const send=mocked.mount.mock.calls[0]![1];mocked.tabs.sendMessage.mockRejectedValueOnce(missingReceiver);
 const calls=mocked.tabs.sendMessage.mock.calls.length;
 await expect(send({type:'TRADE',target,wallet:'wallet',intent:{side:'BUY',sol:'0.1'}})).rejects.toThrow('Please refresh the page');
 expect(mocked.tabs.sendMessage).toHaveBeenCalledTimes(calls+1);expect(mocked.scripting.executeScript).toHaveBeenCalledTimes(3);
 window.destroy();
});
it('shows refresh guidance and bounds failed recovery to one attempt per document every 30 seconds',async()=>{
 mocked.tabs.query.mockResolvedValue([{id:1,url:target('GMGN').pageUrl}]);mocked.tabs.sendMessage.mockRejectedValue(missingReceiver);
 mocked.scripting.executeScript.mockResolvedValue([{documentId:'current-document',result:target('GMGN').pageUrl}]);
 const window=mountTradingWindow();await flush();await vi.advanceTimersByTimeAsync(3000);
 expect(mocked.scripting.executeScript.mock.calls.filter(([args])=>args.files)).toHaveLength(2);
 expect(mocked.mount).not.toHaveBeenCalled();expect(document.querySelector<HTMLElement>('#error')!.textContent).toBe('Could not connect to this token page. Please refresh the page and try again.');
 window.destroy();
});
it('does not inject while the page is loading or after its token changes',async()=>{
 mocked.tabs.query.mockResolvedValue([{id:1,url:target('GMGN').pageUrl,status:'loading'}]);mocked.tabs.sendMessage.mockRejectedValue(missingReceiver);
 const window=mountTradingWindow();await flush();expect(mocked.scripting.executeScript).not.toHaveBeenCalled();
 mocked.tabs.query.mockResolvedValue([{id:1,url:target('GMGN').pageUrl,status:'complete'}]);
 mocked.scripting.executeScript.mockResolvedValue([{documentId:'other-document',result:target('FOMO').pageUrl}]);
 await window.refresh();await flush();expect(mocked.scripting.executeScript).toHaveBeenCalledOnce();expect(mocked.mount).not.toHaveBeenCalled();window.destroy();
});
it('abandons recovery when the panel is destroyed during the document probe',async()=>{
 let resolve!:(value:unknown)=>void;
 mocked.tabs.query.mockResolvedValue([{id:1,url:target('GMGN').pageUrl}]);mocked.tabs.sendMessage.mockRejectedValue(missingReceiver);
 mocked.scripting.executeScript.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const window=mountTradingWindow();await flush();window.destroy();resolve([{documentId:'old-document',result:target('GMGN').pageUrl}]);await flush();
 expect(mocked.scripting.executeScript).toHaveBeenCalledOnce();expect(mocked.mount).not.toHaveBeenCalled();
});
it('keeps refresh guidance when script injection is blocked',async()=>{
 mocked.tabs.query.mockResolvedValue([{id:1,url:target('GMGN').pageUrl}]);mocked.tabs.sendMessage.mockRejectedValue(missingReceiver);
 mocked.scripting.executeScript.mockResolvedValueOnce([{documentId:'current-document',result:target('GMGN').pageUrl}]).mockRejectedValue(new Error('Cannot access contents of the page.'));
 const window=mountTradingWindow();await flush();
 expect(document.querySelector<HTMLElement>('#error')!.textContent).toContain('Please refresh the page');expect(mocked.mount).not.toHaveBeenCalled();expect(mocked.tabs.sendMessage).toHaveBeenCalledOnce();window.destroy();
});
