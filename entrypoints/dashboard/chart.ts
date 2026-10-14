import type { DailyFees, DisplayUnit } from '../../src/receipts/dashboard-fees';
import { receiptSol, receiptUsd } from '../../src/receipts/receipt-format';

export function renderFeeChart(container: HTMLElement, days: DailyFees[], unit: DisplayUnit): void {
  container.replaceChildren();
  if (!days.length) { container.textContent = 'No tracked fees yet.'; return; }
  const format = (value: bigint) => unit === 'USD' ? receiptUsd(value.toString()) : receiptSol(value.toString());
  const svgNode = <K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };
  const scroller = document.createElement('div'); scroller.className = 'chart-scroll';
  const width = Math.max(320, container.clientWidth, 90 + days.length * 54), left = 90, plotWidth = width - left;
  const svg = svgNode('svg', { viewBox: `0 0 ${width} 210`, 'aria-label': `Daily fees and Fee Saved in ${unit}`, role: 'group' });
  svg.style.minWidth = `${width}px`;
  const max = days.reduce((value, day) => {
    const total = day.protocol + day.network + day.saved;
    return total > value ? total : value;
  }, 1n);
  const height = (value: bigint) => Number(value * 150_000n / max) / 1000;
  for (const step of [0, 1, 2]) {
    const y = 170 - step * 75;
    svg.append(svgNode('line', { x1: left, x2: width, y1: y, y2: y, class: 'chart-grid' }));
    const label = svgNode('text', { x: left - 10, y: y + 4, 'text-anchor': 'end', class: 'chart-axis' });
    label.textContent = format(max * BigInt(step) / 2n); svg.append(label);
  }
  const tooltip = document.createElement('div'); tooltip.className = 'chart-tooltip'; tooltip.hidden = true; tooltip.setAttribute('role', 'tooltip');
  const hide = () => { tooltip.hidden = true; };
  for (const [index, day] of days.entries()) {
    const slot = plotWidth / days.length, x = left + slot * (index + .5), barWidth = Math.min(44, slot * .65);
    const networkHeight = height(day.network), protocolHeight = height(day.protocol), savedHeight = height(day.saved);
    const lines = [day.day, `Fee total: ${format(day.protocol + day.network)}`, `Protocol fee: ${format(day.protocol)}`, `Network fee: ${format(day.network)}`, `Fee Saved: ${format(day.saved)}`];
    const group = svgNode('g', { tabindex: 0, role: 'img', 'aria-label': lines.join('. '), class: 'chart-day' });
    group.append(svgNode('rect', { x: x - slot / 2, y: 0, width: slot, height: 210, class: 'chart-hit' }));
    group.append(svgNode('rect', { x: x - barWidth / 2, y: 170 - networkHeight, width: barWidth, height: networkHeight, class: 'chart-network' }));
    group.append(svgNode('rect', { x: x - barWidth / 2, y: 170 - networkHeight - protocolHeight, width: barWidth, height: protocolHeight, class: 'chart-protocol' }));
    if (day.saved > 0n) group.append(svgNode('rect', { x: x - barWidth / 2, y: 170 - networkHeight - protocolHeight - savedHeight, width: barWidth, height: savedHeight, class: 'chart-saved' }));
    const label = svgNode('text', { x, y: 197, 'text-anchor': 'middle', class: 'chart-axis' }); label.textContent = day.day.slice(5); group.append(label);
    svg.append(group);
    const show = () => {
      tooltip.replaceChildren(...lines.map((text, lineIndex) => { const line = document.createElement(lineIndex === 0 ? 'strong' : 'div'); line.textContent = text; return line; }));
      tooltip.hidden = false;
      const bounds = container.getBoundingClientRect(), groupBounds = group.getBoundingClientRect();
      tooltip.style.left = `${Math.max(0, Math.min(groupBounds.left + groupBounds.width / 2 - bounds.left - tooltip.offsetWidth / 2, bounds.width - tooltip.offsetWidth))}px`;
    };
    group.addEventListener('mouseenter', show); group.addEventListener('mouseleave', hide);
    group.addEventListener('focus', show); group.addEventListener('blur', hide);
    group.addEventListener('click', show);
  }
  scroller.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  scroller.addEventListener('scroll', hide);
  scroller.append(svg); container.append(scroller, tooltip);
}
