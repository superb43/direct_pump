import type { Receipt, TradeDiagnostic } from './model';
import { sanitizeDiagnostic } from './diagnostics';

export function cleanReceipt(receipt: Receipt): Receipt {
  const text=(value:string|undefined)=>value===undefined?undefined:String(sanitizeDiagnostic(value));
  const diagnostic=(value:TradeDiagnostic|undefined)=>value?sanitizeDiagnostic(value) as unknown as TradeDiagnostic:undefined;
  return{...receipt,error:text(receipt.error),diagnostic:diagnostic(receipt.diagnostic),feeReceipt:receipt.feeReceipt?{...receipt.feeReceipt,note:text(receipt.feeReceipt.note)!,executionError:text(receipt.feeReceipt.executionError),diagnostic:diagnostic(receipt.feeReceipt.diagnostic),differences:receipt.feeReceipt.differences?.map(value=>text(value)!)}:undefined};
}
