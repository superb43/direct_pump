import { expect, it } from 'vitest';
import { userFacingError } from '../src/errors';

it('maps the reported account lookup 403 to actionable RPC guidance', () => {
  const error = new Error('failed to get info about account TvoocF7zk7fH1sYKgF9WtVLVKnj5M53AeYcXwmGpump: Error: 403 : {"error":{"code":403,"message":"Access forbidden"}}');
  expect(userFacingError(error)).toContain('RPC access denied');
  expect(userFacingError(error)).toContain('Mainnet RPC');
});

it('identifies invalid credentials and rate limits separately', () => {
  expect(userFacingError(new Error('401 Unauthorized'))).toContain('authentication');
  expect(userFacingError(new Error('429 Too many requests'))).toContain('limit');
});

it('does not expose RPC API keys in errors rendered on the website', () => {
  expect(userFacingError(new Error('Request failed at https://rpc.test/?api-key=secret'))).not.toContain('secret');
  expect(userFacingError(new Error('403 https://rpc.test/?api-key=secret'))).not.toContain('secret');
});
