import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { BaseEdge, Controls, Handle, Position, ReactFlow, getSmoothStepPath, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useLocale } from '../../i18n';
import type { GatewayComparison, GatewayRecord } from '../../services/gatewayApi';
import { buildProposedRoute, buildRecordedRoute, type RouteGraph, type RouteNode, type RouteState } from './routeGraph';
import { routeGraphMessages, type RouteMessageKey } from './routeGraphMessages';
import '@xyflow/react/dist/style.css';
import './RoutingTopology.css';

type RouteCopy = typeof routeGraphMessages.en;
interface NodeData extends Record<string, unknown> { routeNode: RouteNode; copy: RouteCopy; inspect: (id: string) => void; active: boolean }
interface EdgeData extends Record<string, unknown> { state: RouteState; active: boolean; replayKey: number; reduced: boolean }
type FlowNode = Node<NodeData, 'route'>;
type FlowEdge = Edge<EdgeData, 'route'>;
const translated = (copy: RouteCopy, key: string) => copy[key as RouteMessageKey] || key;
const nodeTitle = (copy: RouteCopy, node: RouteNode) => node.kind === 'result' || (node.id === 'request' && node.details.purpose === 'quote_only') ? translated(copy, node.title) : node.title;

function RouteGraphNode({ data }: NodeProps<FlowNode>) {
  const node = data.routeNode;
  return <>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <button type="button" className={`rt-node rt-node-${node.state} ${data.active ? 'rt-node-active' : ''}`}
      aria-label={`${data.copy.inspect}: ${nodeTitle(data.copy, node)}`} onClick={() => data.inspect(node.id)}>
      <span className="rt-node-kind">{translated(data.copy, node.kind === 'attempt' ? node.state === 'skipped' ? 'channel_skip' : 'attempt' : node.kind === 'provider' ? 'channel_id' : node.kind === 'result' ? 'status' : node.kind === 'model' ? 'model_id' : 'request')}</span>
      <strong>{nodeTitle(data.copy, node)}</strong>
      <span className="rt-node-label"><i aria-hidden="true" />{translated(data.copy, node.label)}</span>
    </button>
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </>;
}

function RouteGraphEdge(props: EdgeProps<FlowEdge>) {
  const [path] = getSmoothStepPath({ ...props, borderRadius: 18 });
  const data = props.data;
  return <>
    <BaseEdge id={props.id} path={path} className={`rt-edge rt-edge-${data?.state || 'neutral'}`} />
    {data?.active && !data.reduced && <motion.path key={`${props.id}:${data.replayKey}`} d={path} className="rt-edge-progress"
      initial={{ pathLength: 0, opacity: 1 }} animate={{ pathLength: 1, opacity: [1, 1, 0] }}
      transition={{ duration: 0.9, ease: 'easeInOut' }} fill="none" />}
  </>;
}
const nodeTypes = { route: RouteGraphNode };
const edgeTypes = { route: RouteGraphEdge };

function Topology({ graph }: { graph: RouteGraph }) {
  const { locale } = useLocale();
  const copy = routeGraphMessages[locale];
  const reduced = !!useReducedMotion();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const detailsId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const inspectNode = useCallback((id: string) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedId(id);
  }, []);
  const closeDetails = useCallback(() => { setSelectedId(null); returnFocus.current?.focus(); }, []);
  const selected = graph.nodes.find(node => node.id === selectedId);
  const signature = graph.nodes.map(node => `${node.id}:${node.state}`).join('|');

  useEffect(() => { setSelectedId(null); setStep(-1); setPlaying(false); }, [signature]);
  useEffect(() => { if (selectedId) closeButton.current?.focus(); }, [selectedId]);
  useEffect(() => {
    if (!playing || reduced) return;
    const timer = window.setTimeout(() => {
      if (step + 1 >= graph.events.length) setPlaying(false);
      else setStep(value => value + 1);
    }, 1150);
    return () => window.clearTimeout(timer);
  }, [playing, reduced, step, graph.events.length]);
  useEffect(() => { if (reduced) setPlaying(false); }, [reduced]);

  const activeId = playing && step >= 0 ? graph.events[step]?.nodeId : null;
  const nodes: FlowNode[] = useMemo(() => graph.nodes.map(node => ({ id: node.id, type: 'route', position: node.position,
    draggable: false, selectable: false, focusable: false,
    data: { routeNode: node, copy, inspect: inspectNode, active: activeId === node.id } })), [graph.nodes, copy, activeId, inspectNode]);
  const edges: FlowEdge[] = useMemo(() => graph.edges.map(edge => ({ ...edge, type: 'route', animated: false, focusable: false,
    data: { state: edge.state, active: activeId === edge.target, replayKey, reduced } })), [graph.edges, activeId, replayKey, reduced]);
  const isRecorded = graph.mode === 'recorded';
  const finished = !playing && step >= graph.events.length - 1 && step >= 0;
  function play() {
    if (reduced || !graph.hasAttempts) return;
    if (step < 0 || finished) setStep(0);
    setReplayKey(value => value + 1);
    setPlaying(true);
  }
  return <section className={`routing-topology rt-${graph.mode}`} aria-label={isRecorded ? copy.recordedTitle : copy.proposedTitle}>
    <header className="rt-header"><div><span className="rt-kicker">{isRecorded ? copy.traceKicker : copy.planKicker}</span>
      <h2>{isRecorded ? copy.recordedTitle : copy.proposedTitle}</h2><p>{isRecorded ? copy.recordedNote : copy.proposedNote}</p></div>
      <div className="rt-badges"><span>{isRecorded ? copy.recordedBadge : copy.proposedBadge}</span>{graph.isMock && <span className="rt-mock">{copy.mock}</span>}</div>
    </header>
    {!graph.nodes.length ? <div className="rt-empty">{copy.empty}</div> : <>
      <div className="rt-canvas" data-testid="routing-canvas"><ReactFlow<FlowNode, FlowEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} deleteKeyCode={null}
        panOnDrag panOnScroll={false} zoomOnScroll={false} zoomOnPinch zoomOnDoubleClick={false}
        minZoom={0.25} maxZoom={1.5} fitView fitViewOptions={{ padding: 0.2, minZoom: 0.5, maxZoom: 1 }}
        proOptions={{ hideAttribution: false }} aria-label={isRecorded ? copy.recordedTitle : copy.proposedTitle}
        ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': copy.zoomIn, 'controls.zoomOut.ariaLabel': copy.zoomOut, 'controls.fitView.ariaLabel': copy.fitView }}>
        <Controls showInteractive={false} />
      </ReactFlow></div>
      <p className="rt-hint">{copy.routeHint}</p>
      {isRecorded && <div className="rt-playback"><div className="rt-playback-buttons"><button type="button" onClick={playing ? () => setPlaying(false) : play} disabled={reduced || !graph.hasAttempts}>
        {playing ? 'Ⅱ' : '▶'} <span>{playing ? copy.pause : copy.play}</span></button><button type="button" onClick={() => { setPlaying(false); setStep(-1); }} disabled={step < 0}>↺ {copy.reset}</button></div>
        <span className="rt-playback-status" role="status">{reduced ? copy.static : !graph.hasAttempts ? copy.noPlayback : finished ? copy.complete : `${copy.progress} ${Math.max(0, step + 1)} / ${graph.events.length}`}</span>
      </div>}
      <AnimatePresence initial={false}>{selected && <motion.aside key={selected.id} className="rt-details" role="region" aria-labelledby={detailsId}
        initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: 5 }} transition={{ duration: 0.16 }}
        onKeyDown={event => { if (event.key === 'Escape') closeDetails(); }}>
        <div className="rt-details-head"><h3 id={detailsId}>{copy.details} · {nodeTitle(copy, selected)}</h3><button type="button" ref={closeButton} onClick={closeDetails} aria-label={copy.close}>×</button></div>
        <dl>{Object.entries(selected.details).map(([key, value]) => <div key={key}><dt>{translated(copy, key)}</dt><dd>{['unknown', 'none', 'quote_only', 'not_executed', 'not_attempted'].includes(value) ? translated(copy, value) : value}</dd></div>)}</dl>
      </motion.aside>}</AnimatePresence>
      <details className="rt-text-route"><summary>{copy.textAlternative}</summary>{isRecorded ? <ol>{graph.events.map((event, index) => <li key={event.nodeId}>
        <button type="button" onClick={() => inspectNode(event.nodeId)}>{index + 1}. {event.channel ? <code>{event.channel}</code> : null} · {translated(copy, event.label)}</button>
      </li>)}</ol> : <><p>{copy.summaryHint}</p><ul>{graph.nodes.filter(node => node.kind === 'provider').map(node => <li key={node.id}><button type="button" onClick={() => inspectNode(node.id)}><code>{node.details.channel_id}</code> · {translated(copy, node.label)}</button></li>)}</ul></>}</details>
    </>}
  </section>;
}

export function ProposedRoutingTopology({ comparison }: { comparison: GatewayComparison | null }) {
  const graph = useMemo(() => buildProposedRoute(comparison), [comparison]);
  return <Topology graph={graph} />;
}
export function RecordedRoutingTopology({ record }: { record: GatewayRecord }) {
  const graph = useMemo(() => buildRecordedRoute(record), [record]);
  return <Topology key={record.request_id} graph={graph} />;
}
