/** Isolated, unfunded browser command probe; never loads the production signer. */
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd(), output = resolve(root, 'output/playwright/pro-features/hotkey-extension');
await mkdir(output, { recursive: true });
const mint = 'So11111111111111111111111111111111111111112';
const gmgn = `https://gmgn.ai/sol/token/${mint}`;
const native = `import { readProTradeBinding } from '${resolve(root, 'src/pro/hotkeys.ts')}';
const port=chrome.runtime.connect({name:'pro-hotkeys'});let armed=false;
port.onMessage.addListener(async message=>{if(message.type==='ACTION'){const {actions=[]}=await chrome.storage.local.get('actions');actions.push(message);await chrome.storage.local.set({actions});}});
window.disarm=()=>{armed=false;port.postMessage({type:'DISARM'});};
setInterval(async()=>{if(armed)return;const binding=await readProTradeBinding({site:'GMGN',kind:'MINT',address:'${mint}',pageUrl:'${gmgn}'},'${mint}',{serverId:'UNFUNDED-TEST',deviceId:'fixture',wallet:'${mint}'});if(binding){port.postMessage({type:'ARM',binding});armed=true;await chrome.storage.local.set({armed:true});}},500);`;
const background = `import {installProHotkeyBroker} from '${resolve(root, 'src/pro/hotkeys.ts')}';installProHotkeyBroker(chrome);chrome.commands.onCommand.addListener(async command=>{const {commands=[]}=await chrome.storage.local.get('commands');commands.push(command);await chrome.storage.local.set({commands});});`;
for (const [name, contents] of [['background', background], ['native', native]]) await build({ stdin: { contents, resolveDir: root, sourcefile: `${name}.ts`, loader: 'ts' }, outfile: resolve(output, `${name}.js`), bundle: true, format: 'esm', plugins: [{ name: 'fixture-browser', setup(b) { b.onResolve({filter:/^wxt\/browser$/}, () => ({path:'browser',namespace:'fixture'})); b.onLoad({filter:/.*/,namespace:'fixture'}, () => ({contents:'export const browser = chrome;'})); } }] });
await writeFile(resolve(output,'manifest.json'),JSON.stringify({manifest_version:3,name:'Unfunded Pro hotkey probe',version:'1.0.0',permissions:['tabs','scripting','storage','sidePanel'],host_permissions:['https://gmgn.ai/*'],background:{service_worker:'background.js',type:'module'},side_panel:{default_path:'sidepanel.html'},content_scripts:[{matches:['https://gmgn.ai/*'],js:['content.js']}],commands:{'pro-buy-1':{suggested_key:{default:'Alt+Shift+1'},description:'Probe buy 1'},'pro-sell-1':{suggested_key:{default:'Alt+Shift+3'},description:'Probe sell 1'}}},null,2));
await writeFile(resolve(output,'content.js'),`chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(message.type==='PANEL_CONTEXT')reply({target:{site:'GMGN',kind:'MINT',address:'${mint}',pageUrl:location.href}});});`);
await writeFile(resolve(output,'sidepanel.html'),'<html><body>Unfunded command receiver<script type="module" src="native.js"></script></body></html>');
await writeFile(resolve(output,'harness.html'),'<html><body><button id="open">Open unfunded native panel</button><script src="harness.js"></script></body></html>');
await writeFile(resolve(output,'harness.js'),`let windowId;chrome.windows.getCurrent().then(w=>windowId=w.id);document.querySelector('#open').onclick=()=>{chrome.sidePanel.open({windowId});chrome.tabs.create({url:'about:blank'});};`);
const executablePath=process.env.PRO_HOTKEY_BROWSER ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const config=resolve(output,'cli.config.json');
await writeFile(config,JSON.stringify({browser:{browserName:'chromium',userDataDir:resolve(output,'profile'),launchOptions:{executablePath,headless:false,args:[`--disable-extensions-except=${output}`,`--load-extension=${output}`]},contextOptions:{viewport:{width:1100,height:900}}}}));
const session='pro-hotkey-unfunded';
function cli(args){const result=spawnSync('playwright-cli',[`-s=${session}`,...args],{cwd:root,encoding:'utf8',timeout:60000});if(result.status!==0||result.stdout.includes('### Error'))throw new Error(result.stderr||result.stdout);return result.stdout;}
const probe=resolve(output,'probe.cjs');
await writeFile(probe,`async page=>{
const context=page.context();await context.route('https://gmgn.ai/**',route=>route.fulfill({contentType:'text/html',body:'<html><body><h1>Unfunded chart fixture</h1><input id="edit"><button id="chart">Chart focus</button></body></html>'}));
let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');
await worker.evaluate(()=>chrome.storage.local.clear());const id=new URL(worker.url()).host;await page.goto('chrome-extension://'+id+'/harness.html');await page.locator('#open').click();
let chart;for(let i=0;i<50;i++){chart=context.pages().find(p=>p!==page&&p.url()==='about:blank');if(chart)break;await page.waitForTimeout(100);}if(!chart)throw new Error('Supported fixture tab did not open');await chart.goto('${gmgn}');await chart.waitForLoadState();await chart.bringToFront();await chart.locator('#chart').click();
await worker.evaluate(async()=>{for(let i=0;i<30;i++){if((await chrome.storage.local.get('armed')).armed)return;await new Promise(r=>setTimeout(r,100));}throw new Error('Native sidepanel did not arm');});
await chart.keyboard.press('Alt+Shift+1');await chart.waitForTimeout(1000);
const first=await worker.evaluate(async()=>({...await chrome.storage.local.get(['commands','actions','armed']),registered:await chrome.commands.getAll()}));console.log(JSON.stringify({phase:'actual-browser-shortcut',...first}));
if(!first.commands?.length)return {actualCommands:false,blocker:'CDP keyboard gesture did not dispatch chrome.commands.onCommand; OS-native input is required for this runtime',...first};
if(first.actions?.length!==1)throw new Error('Expected exactly one native broker action');
await chart.locator('#edit').focus();await chart.keyboard.press('Alt+Shift+3');await chart.waitForTimeout(600);const editing=await worker.evaluate(()=>chrome.storage.local.get(['commands','actions']));if(editing.actions.length!==1)throw new Error('Editing focus dispatched action');
await chart.screenshot({path:'${resolve(output,'hotkey-browser.png')}'});console.log(JSON.stringify({phase:'editing-focus-blocked',...editing}));
return {actualCommands:true,actions:first.actions.length,editingBlocked:true};
}`);
let report;
try{cli(['open','about:blank','--config',config,'--headed']);report=cli(['run-code','--filename',probe]);await writeFile(resolve(output,'hotkey-result.txt'),report);console.log(report);if(report.includes('actualCommands')&&report.includes('false'))process.exitCode=1;}catch(error){await writeFile(resolve(output,'hotkey-blocker.txt'),String(error));console.error(String(error));process.exitCode=1;}finally{try{cli(['close']);}catch{}}
