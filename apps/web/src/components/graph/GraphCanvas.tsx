import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Move } from 'lucide-react';
import type { GraphNeighborhoodNodeDto, GraphNeighborhoodEdgeDto } from '@mindvault/shared';

interface GraphCanvasProps {
  nodes: GraphNeighborhoodNodeDto[];
  edges: GraphNeighborhoodEdgeDto[];
  centerEntityId?: string | null;
  selectedEntityId?: string | null;
  selectedRelationId?: string | null;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onExpandNode: (nodeId: string) => void;
}

interface NodePosition {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  node: GraphNeighborhoodNodeDto;
}

const TYPE_FILLS: Record<string, { fill: string; stroke: string; text: string }> = {
  CONCEPT: { fill: '#3b82f6', stroke: '#2563eb', text: '#ffffff' },
  TECHNOLOGY: { fill: '#10b981', stroke: '#059669', text: '#ffffff' },
  ORGANIZATION: { fill: '#8b5cf6', stroke: '#7c3aed', text: '#ffffff' },
  PERSON: { fill: '#f59e0b', stroke: '#d97706', text: '#ffffff' },
  LOCATION: { fill: '#f43f5e', stroke: '#e11d48', text: '#ffffff' },
  METRIC: { fill: '#06b6d4', stroke: '#0891b2', text: '#ffffff' },
  PRODUCT: { fill: '#6366f1', stroke: '#4f46e5', text: '#ffffff' },
  DEFAULT: { fill: '#64748b', stroke: '#475569', text: '#ffffff' },
};

export const GraphCanvas: React.FC<GraphCanvasProps> = ({
  nodes,
  edges,
  centerEntityId,
  selectedEntityId,
  selectedRelationId,
  onSelectNode,
  onSelectEdge,
  onExpandNode,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Pan & Zoom transform state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Hover state
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  // Dragging node state
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [customPositions, setCustomPositions] = useState<Record<string, { x: number; y: number }>>(
    {},
  );

  // Compute Layout Positions (Radial Orbital Layout)
  const nodePositions = useMemo(() => {
    const map = new Map<string, NodePosition>();
    if (nodes.length === 0) return map;

    const width = 800;
    const height = 600;
    const centerX = width / 2;
    const centerY = height / 2;

    // Identify center node or highest-degree node
    const centerNode =
      nodes.find((n) => n.id === centerEntityId) ||
      [...nodes].sort((a, b) => b.degree - a.degree)[0];

    const otherNodes = nodes.filter((n) => n.id !== centerNode?.id);

    // Position center node
    if (centerNode) {
      const typeKey = String(centerNode.entityType || '').toUpperCase();
      const style = TYPE_FILLS[typeKey] || TYPE_FILLS.DEFAULT;
      const custom = customPositions[centerNode.id];

      map.set(centerNode.id, {
        id: centerNode.id,
        x: custom ? custom.x : centerX,
        y: custom ? custom.y : centerY,
        radius: 28,
        color: style.fill,
        node: centerNode,
      });
    }

    // Position other nodes in concentric orbits
    const totalOther = otherNodes.length;
    const radius = Math.min(width, height) * 0.36;

    otherNodes.forEach((node, idx) => {
      const angle = (2 * Math.PI * idx) / totalOther;
      const custom = customPositions[node.id];
      const typeKey = String(node.entityType || '').toUpperCase();
      const style = TYPE_FILLS[typeKey] || TYPE_FILLS.DEFAULT;

      const px = custom ? custom.x : centerX + radius * Math.cos(angle);
      const py = custom ? custom.y : centerY + radius * Math.sin(angle);

      map.set(node.id, {
        id: node.id,
        x: px,
        y: py,
        radius: Math.max(16, Math.min(24, 16 + (node.degree || 1) * 2)),
        color: style.fill,
        node,
      });
    });

    return map;
  }, [nodes, centerEntityId, customPositions]);

  // Handle Zoom controls
  const handleZoomIn = () => setZoom((z) => Math.min(2.5, z + 0.2));
  const handleZoomOut = () => setZoom((z) => Math.max(0.4, z - 0.2));
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setCustomPositions({});
  };

  // Mouse Wheel Zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY * -0.001;
    setZoom((z) => Math.min(2.5, Math.max(0.4, z + delta)));
  };

  // Canvas Pan Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (draggedNodeId) return;
    if (e.button === 0) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggedNodeId && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - pan.x) / zoom;
      const mouseY = (e.clientY - rect.top - pan.y) / zoom;

      setCustomPositions((prev) => ({
        ...prev,
        [draggedNodeId]: { x: mouseX, y: mouseY },
      }));
    } else if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggedNodeId(null);
  };

  // Connected edges calculation for highlighting
  const activeNodeId = hoveredNodeId || selectedEntityId;
  const connectedEdgeSet = useMemo(() => {
    const set = new Set<string>();
    if (!activeNodeId) return set;
    for (const e of edges) {
      if (e.source === activeNodeId || e.target === activeNodeId) {
        set.add(e.id);
      }
    }
    return set;
  }, [edges, activeNodeId]);

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      className="relative w-full h-full overflow-hidden bg-theme-bg select-none cursor-grab active:cursor-grabbing flex items-center justify-center"
    >
      {/* SVG Interactive Canvas */}
      <svg
        viewBox="0 0 800 600"
        className="w-full h-full"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
          transition: isPanning || draggedNodeId ? 'none' : 'transform 0.15s ease-out',
        }}
      >
        <defs>
          {/* Arrowhead marker */}
          <marker
            id="graph-arrowhead"
            viewBox="0 0 10 10"
            refX="20"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" className="text-theme-border" />
          </marker>
          <marker
            id="graph-arrowhead-active"
            viewBox="0 0 10 10"
            refX="20"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" className="text-theme-accent" />
          </marker>
        </defs>

        {/* 1. Render Edges */}
        <g className="edges-layer">
          {edges.map((edge) => {
            const srcPos = nodePositions.get(edge.source);
            const tgtPos = nodePositions.get(edge.target);
            if (!srcPos || !tgtPos) return null;

            const isEdgeActive =
              connectedEdgeSet.has(edge.id) ||
              selectedRelationId === edge.id ||
              hoveredEdgeId === edge.id;

            const midX = (srcPos.x + tgtPos.x) / 2;
            const midY = (srcPos.y + tgtPos.y) / 2;

            return (
              <g
                key={edge.id}
                className="cursor-pointer group"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEdge(edge.id);
                }}
                onMouseEnter={() => setHoveredEdgeId(edge.id)}
                onMouseLeave={() => setHoveredEdgeId(null)}
              >
                {/* Thick invisible hit area */}
                <line
                  x1={srcPos.x}
                  y1={srcPos.y}
                  x2={tgtPos.x}
                  y2={tgtPos.y}
                  stroke="transparent"
                  strokeWidth="16"
                />

                {/* Visible Edge Line */}
                <line
                  x1={srcPos.x}
                  y1={srcPos.y}
                  x2={tgtPos.x}
                  y2={tgtPos.y}
                  stroke="currentColor"
                  className={`transition-all ${
                    isEdgeActive
                      ? 'text-theme-accent stroke-2'
                      : 'text-theme-border/80 group-hover:text-theme-accent/70 stroke-1'
                  }`}
                  markerEnd={
                    isEdgeActive ? 'url(#graph-arrowhead-active)' : 'url(#graph-arrowhead)'
                  }
                />

                {/* Edge Label Pill */}
                <g transform={`translate(${midX}, ${midY})`}>
                  <rect
                    x="-24"
                    y="-9"
                    width="48"
                    height="18"
                    rx="4"
                    className={`transition-all ${
                      isEdgeActive
                        ? 'fill-theme-accent text-white'
                        : 'fill-theme-surface stroke-theme-border/60 text-theme-text-muted group-hover:fill-theme-surface-hover'
                    }`}
                    strokeWidth="0.5"
                  />
                  <text
                    textAnchor="middle"
                    dy="3.5"
                    className={`text-[8px] font-mono font-semibold uppercase pointer-events-none ${
                      isEdgeActive ? 'fill-white' : 'fill-theme-text-secondary'
                    }`}
                  >
                    {edge.label?.slice(0, 8) || 'REL'}
                  </text>
                </g>
              </g>
            );
          })}
        </g>

        {/* 2. Render Nodes */}
        <g className="nodes-layer">
          {Array.from(nodePositions.values()).map((pos) => {
            const isSelected = selectedEntityId === pos.id;
            const isCenter = centerEntityId === pos.id;
            const isHovered = hoveredNodeId === pos.id;
            const isConnected =
              activeNodeId && connectedEdgeSet.size > 0 && (activeNodeId === pos.id || isHovered);

            return (
              <g
                key={pos.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                className="cursor-pointer select-none"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDraggedNodeId(pos.id);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectNode(pos.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onExpandNode(pos.id);
                }}
                onMouseEnter={() => setHoveredNodeId(pos.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
              >
                {/* Selection / Center Pulse Aura */}
                {(isSelected || isCenter) && (
                  <circle
                    r={pos.radius + 6}
                    fill="none"
                    stroke="currentColor"
                    className="text-theme-accent animate-pulse"
                    strokeWidth="2.5"
                    strokeDasharray="4 2"
                  />
                )}

                {/* Node Base Circle */}
                <circle
                  r={pos.radius}
                  fill={pos.color}
                  stroke="currentColor"
                  className={`transition-transform duration-100 ${
                    isSelected ? 'text-theme-accent' : 'text-theme-surface'
                  }`}
                  strokeWidth={isSelected ? 3 : 2}
                  filter="drop-shadow(0px 2px 4px rgba(0,0,0,0.15))"
                />

                {/* Entity Initials Icon */}
                <text
                  textAnchor="middle"
                  dy="4"
                  fill="#ffffff"
                  className="text-[11px] font-bold font-mono pointer-events-none"
                >
                  {pos.node.label.slice(0, 2).toUpperCase()}
                </text>

                {/* Node Label below circle */}
                <g transform={`translate(0, ${pos.radius + 14})`}>
                  <rect
                    x={-Math.min(70, pos.node.label.length * 4)}
                    y="-9"
                    width={Math.min(140, pos.node.label.length * 8)}
                    height="18"
                    rx="4"
                    className={`transition-all ${
                      isSelected
                        ? 'fill-theme-accent'
                        : 'fill-theme-surface/90 stroke-theme-border/70'
                    }`}
                    strokeWidth="0.5"
                  />
                  <text
                    textAnchor="middle"
                    dy="3"
                    className={`text-[9px] font-sans font-medium pointer-events-none truncate ${
                      isSelected ? 'fill-white' : 'fill-theme-text'
                    }`}
                  >
                    {pos.node.label.length > 18
                      ? `${pos.node.label.slice(0, 16)}...`
                      : pos.node.label}
                  </text>
                </g>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Floating Canvas Controls */}
      <div className="absolute bottom-4 right-4 flex items-center gap-1.5 p-1.5 bg-theme-surface/90 backdrop-blur-sm border border-theme-border rounded-xl shadow-modal">
        <button
          onClick={handleZoomIn}
          className="p-1.5 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary transition-colors"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={handleZoomOut}
          className="p-1.5 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary transition-colors"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-theme-border mx-0.5" />
        <button
          onClick={handleResetView}
          className="p-1.5 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary transition-colors"
          title="Reset View"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* Canvas Hint Badge */}
      <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1 rounded-lg bg-theme-surface/80 backdrop-blur-sm border border-theme-border/60 text-[10px] text-theme-text-muted font-mono pointer-events-none">
        <span>Click to Inspect • Double-click to Expand • Drag to Move</span>
      </div>
    </div>
  );
};
