import type {ProOrder,ProStrategyProgress} from './contracts';
import type {ProPortfolio} from './portfolio-contracts';

/** Current estimated value only; never changes the authorized raw quantity. */
export function orderUsdValue(order:ProOrder,portfolio:ProPortfolio|undefined,now=Date.now()):string {
  if(!portfolio||portfolio.wallet!==order.wallet||now-portfolio.updatedAt>30_000)return 'USD unavailable';
  const row=portfolio.rows.find(row=>row.mint===order.spec.mint);
  const rate=order.spec.side==='BUY'?portfolio.rows.find(row=>row.solUsdUnits)?.solUsdUnits:row?.solUsdUnits;
  if(!rate)return 'USD unavailable';
  let micros:bigint;
  if(order.spec.side==='BUY')micros=BigInt(order.spec.amountRaw)*BigInt(rate)/1_000_000_000_000_000n;
  else {
    if(!row||row.valueLamports===undefined||row.decimals!==order.spec.decimals||BigInt(row.totalRaw)===0n)return 'USD unavailable';
    micros=BigInt(order.spec.amountRaw)*BigInt(row.valueLamports)*BigInt(rate)/(BigInt(row.totalRaw)*1_000_000_000_000_000n);
  }
  if(micros<10_000n&&BigInt(order.spec.amountRaw)>0n&&(order.spec.side==='BUY'||BigInt(row!.valueLamports!)>0n))return '<$0.01';
  const cents=micros/10_000n;
  return `~$${(cents/100n).toLocaleString('en-US')}.${String(cents%100n).padStart(2,'0')}`;
}

export function strategyRemainingPercent(strategy:Pick<ProStrategyProgress,'baseRaw'|'remainingRaw'>):string {
  const base=BigInt(strategy.baseRaw);
  if(base===0n)return 'Unavailable';
  const bps=BigInt(strategy.remainingRaw)*10_000n/base;
  return `${bps/100n}.${String(bps%100n).padStart(2,'0')}%`;
}
