import { expect, it } from 'vitest';
import { PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { OFFLINE_PUMP_AMM_PROGRAM } from '@pump-fun/pump-swap-sdk';
import { simulationFailure } from '../src/simulation';
import { userFacingError } from '../src/errors';

it('reports exact protocol code and instruction index instead of assuming insufficient balance', () => {
  const failure = simulationFailure({ InstructionError: [2, { Custom: 6004 }] }, [`Program ${PUMP_PROGRAM_ID} failed: custom program error: 0x1774`]);
  expect(failure.message).toContain('MintDoesNotMatchBondingCurve');
  expect(failure.diagnostic.instructionIndex).toBe(2); expect(failure.diagnostic.code).toBe(6004);
  expect(failure.message).not.toContain('balance');
});

it('decodes the same numeric code under the correct venue IDL', () => {
  const failure = simulationFailure({ InstructionError: [1, { Custom: 6004 }] }, [`Program ${OFFLINE_PUMP_AMM_PROGRAM.programId} failed: custom program error: 0x1774`]);
  expect(failure.message).toMatch(/exceededSlippage/i);
  expect(failure.message).not.toContain('MintDoesNotMatchBondingCurve');
});

it('preserves Anchor account constraint explanations and full log text', () => {
  const logs = ['Program log: AnchorError caused by account: bonding_curve. Error Code: ConstraintSeeds. Error Number: 2006. Error Message: A seeds constraint was violated.'];
  const failure = simulationFailure({ InstructionError: [3, { Custom: 2006 }] }, logs);
  expect(failure.message).toContain('ConstraintSeeds'); expect(failure.diagnostic.logs).toEqual(logs);
});

it('reports current and required lamports only when the logs prove insufficient funds', () => {
  const failure = simulationFailure({ InstructionError: [0, 'InsufficientFunds'] }, ['Transfer: insufficient lamports 403, need 500']);
  expect(failure.message).toContain('available 403'); expect(failure.message).toContain('required 500');
  expect(userFacingError(failure)).not.toContain('RPC access');
});

it('keeps unknown errors exact without guessing a wallet or liquidity problem', () => {
  expect(simulationFailure('BlockhashNotFound', []).message).toContain('BlockhashNotFound');
  expect(simulationFailure({ InstructionError: [2, 'InvalidAccountData'] }, []).message).toContain('InvalidAccountData');
});
