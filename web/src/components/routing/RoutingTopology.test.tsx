import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType, ReactNode } from 'react';
import { ProposedRoutingTopology, RecordedRoutingTopology } from './RoutingTopology';
import { fixtureComparison, fixtureRecord } from './routeGraphFixtures';
import { setLocale } from '../../i18n';

const state = vi.hoisted(() => ({ reduced: false }));
vi.mock('motion/react', async () => ({ ...await vi.importActual('motion/react'), useReducedMotion: () => state.reduced }));
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, nodeTypes, children, zoomOnScroll, panOnScroll }: { nodes: { id: string; data: unknown }[]; nodeTypes: Record<string, ComponentType<{ data: unknown }>>; children: ReactNode; zoomOnScroll: boolean; panOnScroll: boolean }) => {
    const NodeView = nodeTypes.route;
    return <div data-testid="flow-projection" data-scroll-zoom={String(zoomOnScroll)} data-scroll-pan={String(panOnScroll)}>{nodes.map(node => <NodeView key={node.id} data={node.data} />)}{children}</div>;
  },
  Controls: () => <div aria-label="Viewport controls"><button type="button">Zoom in</button><button type="button">Zoom out</button></div>,
  Handle: () => null, Position: { Left: 'left', Right: 'right' }, BaseEdge: () => null, getSmoothStepPath: () => ['M0 0L1 1'],
}));

describe('route topology interaction', () => {
  beforeEach(() => { state.reduced = false; setLocale('en'); });
  afterEach(() => { cleanup(); vi.useRealTimers(); setLocale('en'); });
  it('shows an empty proposal and never has replay controls for quotes', () => {
    render(<ProposedRoutingTopology comparison={null} />);
    expect(screen.getByText('Compare providers to inspect a proposed route.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replay recorded steps' })).not.toBeInTheDocument();
  });
  it('keeps proposed selection read-only, exposes details, and avoids a wheel scroll trap', () => {
    const comparison = fixtureComparison(); const before = JSON.stringify(comparison);
    render(<ProposedRoutingTopology comparison={comparison} />);
    expect(screen.getByText('Proposal only · no provider request sent')).toBeInTheDocument();
    expect(screen.getByTestId('flow-projection')).toHaveAttribute('data-scroll-zoom', 'false');
    expect(screen.getByTestId('flow-projection')).toHaveAttribute('data-scroll-pan', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect: Provider PRIMARY' }));
    expect(screen.getByRole('region', { name: /Node details/ })).toBeInTheDocument();
    expect(screen.getByText('0.000000123456789')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close details' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('region', { name: /Node details/ }), { key: 'Escape' });
    expect(JSON.stringify(comparison)).toBe(before);
  });
  it('starts only on user action, pauses, resets and stops after its bounded record', () => {
    vi.useFakeTimers();
    render(<RecordedRoutingTopology record={fixtureRecord()} />);
    expect(screen.getByText('Recorded step 0 / 2')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('Recorded step 0 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Replay recorded steps/ }));
    expect(screen.getByRole('button', { name: /Pause replay/ })).toBeInTheDocument();
    expect(screen.getByText('Recorded step 1 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Pause replay/ }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('Recorded step 1 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reset replay/ }));
    expect(screen.getByText('Recorded step 0 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Replay recorded steps/ }));
    act(() => { vi.advanceTimersByTime(1150); });
    act(() => { vi.advanceTimersByTime(1150); });
    expect(screen.getByText('Replay complete')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pause replay/ })).not.toBeInTheDocument();
  });
  it('opens details with Enter and returns focus to the node on Escape', async () => {
    const user = userEvent.setup();
    render(<ProposedRoutingTopology comparison={fixtureComparison()} />);
    const node = screen.getByRole('button', { name: 'Inspect: Provider PRIMARY' });
    node.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Close details' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(node).toHaveFocus();
  });
  it('respects reduced motion and retains a text alternative', () => {
    state.reduced = true;
    render(<RecordedRoutingTopology record={fixtureRecord()} />);
    expect(screen.getByRole('button', { name: /Replay recorded steps/ })).toBeDisabled();
    expect(screen.getByText('Reduced motion: static route shown')).toBeInTheDocument();
    expect(screen.getByText('Text route summary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1. PRIMARY/ })).toBeInTheDocument();
  });
  it('does not offer replay for a record without provider attempts', () => {
    render(<RecordedRoutingTopology record={fixtureRecord({ attempts: [], fallback_trace: [] })} />);
    expect(screen.getByRole('button', { name: /Replay recorded steps/ })).toBeDisabled();
    expect(screen.getByText('No recorded provider attempt to replay.')).toBeInTheDocument();
  });
  it('switches graph copy while leaving model and channel IDs intact', () => {
    render(<ProposedRoutingTopology comparison={fixtureComparison()} />);
    act(() => { setLocale('zh'); });
    expect(screen.getByRole('heading', { name: '路由拓扑' })).toBeInTheDocument();
    expect(screen.getByText('model-fixture')).toBeInTheDocument();
    act(() => { setLocale('ja'); });
    expect(screen.getByRole('heading', { name: 'ルーティング構成' })).toBeInTheDocument();
    expect(screen.getByText('model-fixture')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '詳細表示: Provider PRIMARY' })).toBeInTheDocument();
  });
});
