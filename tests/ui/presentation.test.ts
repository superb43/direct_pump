import {expect,it,vi,beforeEach} from 'vitest';
import {DEFAULT_SETTINGS} from '../../src/model';
import {validateSettings} from '../../src/settings';
const mocks=vi.hoisted(()=>({popup:vi.fn(),options:vi.fn(),behavior:vi.fn()}));
vi.mock('wxt/browser',()=>({browser:{action:{setPopup:mocks.popup},sidePanel:{setOptions:mocks.options,setPanelBehavior:mocks.behavior}}}));
import {applyPresentation} from '../../src/ui/presentation';
beforeEach(()=>{mocks.popup.mockReset().mockResolvedValue(undefined);mocks.options.mockReset().mockResolvedValue(undefined);mocks.behavior.mockReset().mockResolvedValue(undefined);});
it('always opens the native side panel and disables the action popup',async()=>{
 await applyPresentation();expect(mocks.popup).toHaveBeenCalledWith({popup:''});expect(mocks.behavior).toHaveBeenCalledWith({openPanelOnActionClick:true});expect(mocks.options).toHaveBeenCalledWith({path:'sidepanel.html',enabled:true});
});
it('ignores retired popup/on-page preferences in saved settings',()=>{
 const migrated=validateSettings({...DEFAULT_SETTINGS,presentation:'POPUP',showPagePanel:true});expect(migrated).not.toHaveProperty('presentation');expect(migrated).not.toHaveProperty('showPagePanel');
});
