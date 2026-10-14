import {it,expect} from 'vitest';
import {accountPosition,type PositionFill} from '../../src/pro/position-accounting';
import {validateProPortfolio,validateProRecoverInitialsPreview} from '../../src/pro/portfolio-contracts';
const fill=(side:'BUY'|'SELL',before:string,after:string,net:string,slot:number):PositionFill=>({side,beforeRaw:before,afterRaw:after,netLamports:net,slot,at:slot,signature:String(slot)});
it('reweights buys, allocates partial sale cost, and separates unrecovered capital',()=>{
 expect(accountPosition([fill('BUY','0','100','101',1),fill('BUY','100','200','201',2),fill('SELL','200','100','200',3)],'100')).toEqual({costBasisLamports:'151',realizedPnlLamports:'49',unrecoveredLamports:'102'});
});
it('includes failed actual costs and resets the holding episode after complete exit',()=>{
 const failed:PositionFill={side:'BUY',failed:true,netLamports:'5',slot:2,at:2,signature:'2'};
 expect(accountPosition([fill('BUY','0','100','101',1),failed,fill('SELL','100','0','150',3),fill('BUY','0','50','20',4)],'50')).toEqual({costBasisLamports:'20',realizedPnlLamports:'44',unrecoveredLamports:'20'});
});
it('rejects quantity drift instead of inventing acquisition cost',()=>{
 expect(()=>accountPosition([fill('BUY','10','100','101',1)],'100')).toThrow(/incomplete/);
 expect(()=>accountPosition([fill('BUY','0','100','101',1)],'200')).toThrow(/differs/);
});
it('rejects incomplete, unknown and inconsistent public response values',()=>{
 const wallet='11111111111111111111111111111111';
 const p={wallet,updatedAt:Date.now(),partial:false,rows:[{mint:wallet,decimals:6,totalRaw:'100',reservedRaw:'20',availableRaw:'80',status:'READY',costBasisLamports:'100',realizedPnlLamports:'-5',unrecoveredLamports:'100'}]};
 expect(validateProPortfolio(p)).toEqual(p);
 expect(()=>validateProPortfolio({...p,privateKey:'secret'})).toThrow();
 expect(()=>validateProPortfolio({...p,rows:[{...p.rows[0],availableRaw:'100'}]})).toThrow();
 expect(()=>validateProRecoverInitialsPreview({status:'READY',targetLamports:'100',quoteAt:Date.now()})).toThrow();
});

it('preserves excess proceeds before another buy in the same holding episode',()=>{
 expect(accountPosition([fill('BUY','0','100','100',1),fill('SELL','100','50','150',2),fill('BUY','50','100','100',3)],'100')).toMatchObject({unrecoveredLamports:'50'});
});
it('records failures outside open holdings as realized losses without contaminating new episodes',()=>{
 const failed=(slot:number):PositionFill=>({side:'BUY',failed:true,netLamports:'5',slot,at:slot,signature:String(slot)});
 expect(accountPosition([failed(1),fill('BUY','0','100','100',2),fill('SELL','100','0','100',3),failed(4),fill('BUY','0','100','100',5)],'100')).toMatchObject({realizedPnlLamports:'-10',unrecoveredLamports:'100'});
});
it('orders same-slot transactions only through an unambiguous verified token-balance chain',()=>{
 expect(accountPosition([fill('SELL','100','50','100',1),fill('BUY','0','100','100',1)],'50')).toMatchObject({unrecoveredLamports:'0'});
 expect(()=>accountPosition([fill('BUY','0','100','100',1),fill('BUY','0','50','50',1)],'150')).toThrow(/ambiguous/);
 expect(()=>accountPosition([fill('BUY','0','100','100',1),{side:'BUY',failed:true,netLamports:'5',slot:1,at:1,signature:'failed'}],'100')).toThrow(/ambiguous/);
});
it('requires portfolio navigation targets to match supported HTTPS pages and row mints',()=>{
 const mint='11111111111111111111111111111111',other='22222222222222222222222222222222';
 const target={site:'GMGN',kind:'MINT',address:mint,pageUrl:`https://gmgn.ai/sol/token/${mint}`};
 const p={wallet:mint,updatedAt:Date.now(),partial:false,rows:[{mint,decimals:6,totalRaw:'0',reservedRaw:'0',availableRaw:'0',status:'READY',costBasisLamports:'0',realizedPnlLamports:'0',unrecoveredLamports:'0',target,solUsdUnits:'100000000000000'}]};
 expect(validateProPortfolio(p)).toEqual(p);
 for(const pageUrl of ['javascript:alert(1)','data:text/html,test',`http://gmgn.ai/sol/token/${mint}`,`https://evil.test/sol/token/${mint}`,`https://gmgn.ai/sol/token/${other}`])expect(()=>validateProPortfolio({...p,rows:[{...p.rows[0],target:{...target,pageUrl}}]})).toThrow(/target/);
 expect(()=>validateProPortfolio({...p,rows:[{...p.rows[0],target:{...target,mintHint:other}}]})).toThrow(/target/);
 expect(()=>validateProPortfolio({...p,rows:[{...p.rows[0],solUsdUnits:'0'}]})).toThrow(/rate/);
 const pool={site:'AXIOM',kind:'POOL',address:other,pageUrl:`https://axiom.trade/meme/${other}`,mintHint:mint};
 expect(validateProPortfolio({...p,rows:[{...p.rows[0],target:pool}]})).toHaveProperty('rows');
 expect(()=>validateProPortfolio({...p,rows:[{...p.rows[0],target:{...pool,mintHint:other}}]})).toThrow(/target/);
});
