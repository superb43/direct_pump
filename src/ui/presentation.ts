import { browser } from 'wxt/browser';
export async function applyPresentation(): Promise<void> {
  if (!browser.action || !browser.sidePanel) return;
  await browser.sidePanel.setOptions({ path:'sidepanel.html', enabled:true });
  await browser.action.setPopup({ popup:'' });
  await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick:true });
}
