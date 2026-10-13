import bs58 from 'bs58';
import { getPumpProgram, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { OFFLINE_PUMP_AMM_PROGRAM, PUMP_AMM_PROGRAM_ID, POOL_ACCOUNT_NEW_SIZE, userVolumeAccumulatorPda } from '@pump-fun/pump-swap-sdk';
import { assertTokenProgram } from '../src/protocol';
import { readableCoder } from '../src/coder';
import { Connection, PublicKey, SystemProgram, SystemInstruction, TransactionInstruction } from '@solana/web3.js';
import { unpackMint, getAssociatedTokenAddressSync,getExtensionTypes,ExtensionType,type Mint } from '@solana/spl-token';
import { DEFAULT_SETTINGS } from '../src/model';
import { buildHybridTrade, resolveExecution } from '../src/hybrid';
import { usdMicros, validateProSpec, type ProSpec } from '../src/pro/contracts';
export function assertProMintExtensions(mint:Pick<Mint,'tlvData'>,program?:PublicKey):void{
    if(program)assertTokenProgram(program);
    const supported=new Set([ExtensionType.MetadataPointer,ExtensionType.TokenMetadata]);
    if(getExtensionTypes(mint.tlvData).some(type=>!supported.has(type)))throw new Error('Pro does not support mint extensions that can change transfer amounts or account requirements.');
}
export function limitMinimum(spec: ProSpec, solUsdMicros: bigint, supplyRaw?:bigint): bigint | undefined {
    if (spec.kind !== 'LIMIT')
        return undefined;
    const raw=BigInt(spec.amountRaw),scale=10n**BigInt(spec.decimals);
    if(spec.version===2){
        if(!supplyRaw||supplyRaw<=0n)throw new Error('Verified supply required for MC limit.');
        const mc=usdMicros(spec.triggerMcUsd!);
        const numerator=spec.side==='BUY'?raw*solUsdMicros*supplyRaw:raw*mc*1000000000n;
        const denominator=spec.side==='BUY'?1000000000n*mc:supplyRaw*solUsdMicros;
        return (numerator+denominator-1n)/denominator;
    }
    const p=usdMicros(spec.triggerPriceUsd!);
    const numerator = spec.side === 'BUY' ? raw * solUsdMicros * scale : raw * p * 1000000000n;
    const denominator = spec.side === 'BUY' ? 1000000000n * p : scale * solUsdMicros;
    return (numerator + denominator - 1n) / denominator;
}
export async function buildProExecution(connection: Connection, wallet: PublicKey, spec: ProSpec, solUsdMicros: bigint, quoteOnly = false) {
    validateProSpec(spec);
    const route = await resolveExecution(connection, spec.target);
    if (route.mint.toBase58() !== spec.mint)
        throw new Error('Resolved mint differs from the order.');
    const raw = BigInt(spec.amountRaw);
    const info = await connection.getAccountInfo(route.mint);
    if (!info)
        throw new Error('Mint unavailable.');
    const mint=unpackMint(route.mint,info,info.owner);assertProMintExtensions(mint,info.owner);
    const tokenDecimals = mint.decimals;
    if (spec.side === 'BUY' && spec.decimals !== 9 || spec.side === 'SELL' && spec.decimals !== tokenDecimals)
        throw new Error('Input decimals mismatch.');
    const intent = spec.side === 'BUY' ? { side: 'BUY' as const, sol: `${raw / 1000000000n}.${(raw % 1000000000n).toString().padStart(9, '0')}` } : { side: 'SELL' as const, percent: 100 };
    const built = await buildHybridTrade(connection, spec.target, wallet, intent, { ...DEFAULT_SETTINGS, rpcUrl: connection.rpcEndpoint, jupiterApiKey: process.env.DP_JUPITER_API_KEY ?? '', slippageBps: quoteOnly ? 0 : spec.slippageBps, priorityFeeLamports: spec.priorityFeeLamports }, { exactInput: raw, minimumOutput: quoteOnly ? undefined : limitMinimum({ ...spec, decimals: tokenDecimals }, solUsdMicros,mint.supply), quoteOnly });
    const minimum = limitMinimum({ ...spec, decimals: tokenDecimals }, solUsdMicros,mint.supply);
    if (!quoteOnly && minimum && built.minimum < minimum)
        throw new Error('Final transaction output cannot satisfy the limit price.');
    return built;
}
// Count bounded setup debits, including protocol CPI account initialization.
export async function setupRentLamports(connection: Connection, manifest: Awaited<ReturnType<typeof buildProExecution>>['feeManifest']): Promise<bigint> {
    const required = new Map<string, number>();
    let temporaryRent = 0n;
    const tokenRent = BigInt(await connection.getMinimumBalanceForRentExemption(165));
    for (const ix of manifest) {
        if (ix.program === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') {
            const address = ix.accounts[1];
            if (!address)
                throw new Error('ATA setup account is missing.');
            required.set(address, 165);
            continue;
        }
        if (ix.program === SystemProgram.programId.toBase58()) {
            const instruction = new TransactionInstruction({ programId: SystemProgram.programId, keys: ix.accounts.map(address => ({ pubkey: new PublicKey(address), isSigner: false, isWritable: false })), data: Buffer.from(bs58.decode(ix.data)) });
            if (SystemInstruction.decodeInstructionType(instruction) === 'CreateWithSeed')
                temporaryRent += tokenRent;
            continue;
        }
        if (ix.program !== PUMP_PROGRAM_ID.toBase58() && ix.program !== PUMP_AMM_PROGRAM_ID.toBase58())
            continue;
        const program = ix.program === PUMP_PROGRAM_ID.toBase58() ? getPumpProgram(connection) : OFFLINE_PUMP_AMM_PROGRAM;
        const decoded = readableCoder(program.coder.instruction).decode(Buffer.from(bs58.decode(ix.data)));
        const definition = decoded && program.idl.instructions.find(row => row.name === decoded.name);
        if (!definition)
            throw new Error('Unknown protocol setup layout.');
        if (ix.program === PUMP_AMM_PROGRAM_ID.toBase58() && decoded?.name !== 'extendAccount') {
            const at = (name: string) => ix.accounts[definition.accounts.findIndex(account => account.name === name)];
            const user = at('user'), quote = at('quoteMint'), quoteProgram = at('quoteTokenProgram');
            if (!user || !quote || !quoteProgram)
                throw new Error('Missing PumpSwap setup binding.');
            const volume = userVolumeAccumulatorPda(new PublicKey(user)), volumeAta = getAssociatedTokenAddressSync(new PublicKey(quote), volume, true, new PublicKey(quoteProgram));
            for (const address of ix.accounts.slice(definition.accounts.length)) {
                if (address === volume.toBase58())
                    required.set(address, program.coder.accounts.size('userVolumeAccumulator'));
                if (address === volumeAta.toBase58())
                    required.set(address, 165);
            }
            const buybackAta = ix.accounts.at(-1);
            if (buybackAta)
                required.set(buybackAta, 165);
        }
        for (let index = 0; index < definition.accounts.length; index++) {
            const name = definition.accounts[index]!.name, address = ix.accounts[index];
            if (!address)
                throw new Error('Missing protocol setup account.');
            if (name === 'userVolumeAccumulator')
                required.set(address, program.coder.accounts.size('userVolumeAccumulator'));
            if (name === 'creatorVault' && ix.program === PUMP_PROGRAM_ID.toBase58())
                required.set(address, 0);
            if (['protocolFeeRecipientTokenAccount', 'coinCreatorVaultAta'].includes(name))
                required.set(address, 165);
            if (decoded?.name === 'extendAccount' && name === 'account')
                required.set(address, POOL_ACCOUNT_NEW_SIZE);
        }
    }
    let rent = temporaryRent;
    for (const [address, size] of required) {
        const info = await connection.getAccountInfo(new PublicKey(address));
        if (info && info.data.length >= size)
            continue;
        const needed = BigInt(await connection.getMinimumBalanceForRentExemption(size)) - (info ? BigInt(info.lamports) : 0n);
        if (needed > 0n)
            rent += needed;
    }
    return rent;
}
