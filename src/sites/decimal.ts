const SUB='₀₁₂₃₄₅₆₇₈₉';
export function decimalText(value:string):string|undefined {
 let text=value.replace(/,/g,'').trim().replace(/^\$\s*/,'');
 text=text.replace(/0\.0([₀-₉]+)(\d+)/,(_,count:string,digits:string)=>Number([...count].map(c=>SUB.indexOf(c)).join(''))<=18?`0.${'0'.repeat(Number([...count].map(c=>SUB.indexOf(c)).join('')))}${digits}`:'invalid');
 const match=/^(\d+(?:\.\d+)?)([kmb])?$/i.exec(text);if(!match)return;
 const [whole,fraction='']=match[1]!.split('.'),shift=match[2]?({k:3,m:6,b:9}[match[2].toLowerCase()]??0):0;
 const digits=whole!+fraction;
 const point=whole!.length+shift;
 text=point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);
 if(text.length>50||!/[1-9]/.test(text))return;
 return text;
}
export function decimalE18(value:string):bigint {
 const text=decimalText(value);if(!text)throw new Error('Invalid market value.');
 const [whole,fraction='']=text.split('.');return BigInt(whole!)*10n**18n+BigInt(fraction.slice(0,18).padEnd(18,'0'));
}
