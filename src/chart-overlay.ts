import { validOverlayCommand, type ChartOverlayCommand } from './chart-overlay-contract';
import { detectPage, targetKey } from './sites/catalog';
import { readPageHints } from './adapters';
import { readChartBinding, type ChartBinding, type ChartEntityId } from './sites/charts';

type OwnedLine = { binding: ChartBinding; id: ChartEntityId; fingerprint: string };
/** MAIN-world display adapter. This surface has no extension API or execution authority. */
export function createChartOverlay(document: Document, href: () => string, now = Date.now) {
  let command: ChartOverlayCommand | undefined, line: OwnedLine | undefined;
  let generation = 0, creating = false, alive = true;
  let pending: { binding: ChartBinding; fingerprint: string } | undefined;
  const remove = (owned?: OwnedLine) => { if (owned) try { owned.binding.chart.removeEntity(owned.id); } catch { /* Destroyed chart. */ } };
  function clear() { generation++; remove(line); line = undefined; }
  function projection() {
    if (!alive) return;
    const target = detectPage(href());
    if (!target) { command = undefined; return; }
    if (!command?.entry || command.expiresAt <= now()) return;
    const hints = readPageHints(document, target);
    const current = { ...target, ...hints, market: undefined };
    const mint = current.kind === 'MINT' ? current.address : current.mintHint;
    if (targetKey(current) !== command.key || mint !== command.entry.mint) { command = undefined; return; }
    const binding = readChartBinding(document, current, command.entry);
    if (!binding) return;
    const price = Number(binding.basis === 'MC' ? command.entry.marketCapUsd : command.entry.priceUsd);
    const fingerprint = JSON.stringify([command.key, binding.symbol, binding.basis, price, command.entry.marketCapUsd]);
    return { binding, price, fingerprint, label: 'Avg Entry' };
  }
  const sameBinding = (left: ChartBinding, right: ChartBinding) => left.chart === right.chart && left.frame === right.frame;
  async function sync() {
    if (!alive) return;
    const nextProjection = projection();
    if (!nextProjection) { if (line || creating) clear(); return; }
    const { binding, price, fingerprint, label } = nextProjection;
    if (line && line.binding.frame === binding.frame && line.binding.chart === binding.chart && line.fingerprint === fingerprint) {
      try { binding.chart.getShapeById(line.id); return; } catch { clear(); }
    }
    if (creating) {
      if (pending && (!sameBinding(pending.binding, binding) || pending.fingerprint !== fingerprint)) clear();
      return;
    }
    clear();
    const owner = generation;
    creating = true;
    pending = { binding, fingerprint };
    let readinessTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = await Promise.race([
        binding.chart.dataReady(),
        new Promise<boolean>(resolve => { readinessTimer = setTimeout(() => resolve(false), Math.max(0, (command?.expiresAt ?? now()) - now())); }),
      ]);
      if (readinessTimer !== undefined) clearTimeout(readinessTimer);
      const beforeCreate = projection();
      if (!ready || owner !== generation || !beforeCreate || !sameBinding(binding, beforeCreate.binding) || beforeCreate.fingerprint !== fingerprint) return;
      const id = await binding.chart.createShape({ price }, {
        shape: 'horizontal_line', lock: true, disableSelection: true, disableSave: true, disableUndo: true,
        text: label,
        overrides: { linecolor: '#A9CDFF', linestyle: 1, linewidth: 1, showLabel: true, showPrice: true,
          textcolor: '#A9CDFF', fontsize: 13, bold: false, horzLabelsAlign: 'right' },
      });
      if (!id) return;
      const next = { binding, id, fingerprint };
      const latest = projection();
      if (owner !== generation || !latest || !sameBinding(binding, latest.binding) || latest.fingerprint !== fingerprint) remove(next);
      else line = next;
    } catch { /* Unsupported/loading library: retry on the next lease tick. */ }
    finally { if (readinessTimer !== undefined) clearTimeout(readinessTimer); creating = false; pending = undefined; }
  }
  return {
    update(value: unknown) {
      if (!alive || !validOverlayCommand(value, now())) return;
      // Invalidate a pending creation before accepting a newer value.
      if (JSON.stringify(command?.entry) !== JSON.stringify(value.entry) || command?.key !== value.key) clear();
      command = value; void sync();
    },
    sync,
    reset() { command = undefined; clear(); },
    destroy() { alive = false; command = undefined; clear(); },
  };
}
