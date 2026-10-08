import { targetKey } from './sites/catalog';
import { requestPolicy } from './messages';
import type { PageTarget, WorkerRequest } from './model';

// Only the side-panel trading surface can relay public trading actions. The worker
// still validates the real content-script frame/document before wallet calls.
export function bindPanelRequest(request: WorkerRequest, current: PageTarget | null): WorkerRequest {
  if (!current) throw new Error('Open a supported token page on GMGN, Axiom or FOMO Family.');
  if (!request || !requestPolicy(request.type)?.panel) throw new Error('Unsupported panel request.');
  if ('target' in request) {
    if (!request.target || targetKey(request.target) !== targetKey(current)) throw new Error('The page changed. Reopen Direct Pump on the current token.');
    return { ...request, target: current };
  }
  return request;
}
