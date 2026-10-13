import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({connect:vi.fn()}));
vi.mock('wxt/browser',()=>({browser:{runtime:{connect:mocks.connect}}}));
import {createPriceWatch} from '../src/price-watch';
beforeEach(()=>{vi.useFakeTimers();mocks.connect.mockReset();});
afterEach(()=>vi.useRealTimers());
function port(){let disconnected=()=>{};return {postMessage:vi.fn(),onDisconnect:{addListener:(callback:()=>void)=>{disconnected=callback;}},disconnect:vi.fn(()=>disconnected()),drop:()=>disconnected()};}
it('shares a view connection, changes wallet filters and closes on visibility loss',()=>{
 const current=port();mocks.connect.mockReturnValue(current);const watch=createPriceWatch();watch.update('wallet',true);watch.update('wallet',true);expect(mocks.connect).toHaveBeenCalledOnce();
 watch.update('next-wallet',true,'mint');expect(current.postMessage).toHaveBeenLastCalledWith({type:'WATCH',wallet:'next-wallet',mint:'mint'});
 watch.update('next-wallet',false);expect(current.disconnect).toHaveBeenCalledOnce();watch.destroy();
});
it('restores the view lease after a worker restart but stops reconnecting when destroyed',async()=>{
 const first=port(),second=port();mocks.connect.mockReturnValueOnce(first).mockReturnValue(second);const watch=createPriceWatch();watch.update('wallet',true);first.drop();await vi.advanceTimersByTimeAsync(1000);
 expect(second.postMessage).toHaveBeenCalledWith({type:'WATCH',wallet:'wallet',mint:undefined});watch.destroy();await vi.advanceTimersByTimeAsync(5000);expect(mocks.connect).toHaveBeenCalledTimes(2);
});
