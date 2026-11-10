import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  Network,
  Loader2,
  AlertCircle,
  Sparkles,
  ChevronRight,
  Database,
  Layers,
  ArrowRight,
} from 'lucide-react';
import type {
  GraphOverviewDto,
  GraphNeighborhoodDto,
  GraphNeighborhoodNodeDto,
  GraphNeighborhoodEdgeDto,
  GraphEntityDetailDto,
  RelationEvidenceDetailDto,
  GraphEntityListItemDto,
  ApiResponse,
} from '@mindvault/shared';
import { GraphFilterBar } from './GraphFilterBar';
import { GraphCanvas } from './GraphCanvas';
import { EntityDetailDrawer } from './EntityDetailDrawer';
import { RelationEvidenceDrawer } from './RelationEvidenceDrawer';

export const KnowledgeGraphView: React.FC = () => {
  const { activeWorkspace, accessToken } = useAuth();

  // Graph state
  const [overview, setOverview] = useState<GraphOverviewDto | null>(null);
  const [centerEntityId, setCenterEntityId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<GraphNeighborhoodNodeDto[]>([]);
  const [edges, setEdges] = useState<GraphNeighborhoodEdgeDto[]>([]);

  // Entity Directory list
  const [entityList, setEntityList] = useState<GraphEntityListItemDto[]>([]);
  const [totalEntityCount, setTotalEntityCount] = useState(0);

  // Filter Bar state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('ALL');
  const [depth, setDepth] = useState(1);

  // Selection Drawers state
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [entityDetail, setEntityDetail] = useState<GraphEntityDetailDto | null>(null);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const [relationEvidence, setRelationEvidence] = useState<RelationEvidenceDetailDto | null>(null);

  // Loading & error state
  const [isLoadingOverview, setIsLoadingOverview] = useState(true);
  const [isLoadingNeighborhood, setIsLoadingNeighborhood] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Common Headers helper
  const getHeaders = useCallback(() => {
    return {
      Authorization: `Bearer ${accessToken}`,
      'X-Workspace-ID': activeWorkspace?.id || '',
    };
  }, [accessToken, activeWorkspace]);

  // 1. Fetch Workspace Graph Overview
  const fetchOverview = useCallback(async () => {
    if (!activeWorkspace || !accessToken) return;
    setIsLoadingOverview(true);
    setError(null);

    try {
      const res = await fetch('/api/graph/overview', {
        headers: getHeaders(),
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch graph overview: ${res.statusText}`);
      }

      const json: ApiResponse<GraphOverviewDto> = await res.json();
      if (json.success && json.data) {
        setOverview(json.data);

        // If entities exist and no center selected, center on top connected hub
        if (json.data.totalEntities > 0 && json.data.topConnectedEntities.length > 0) {
          const topHub = json.data.topConnectedEntities[0];
          setCenterEntityId(topHub.id);
        }
      }
    } catch (err: any) {
      console.error('Error fetching graph overview:', err);
      setError(err.message || 'Failed to load graph overview');
    } finally {
      setIsLoadingOverview(false);
    }
  }, [activeWorkspace, accessToken, getHeaders]);

  // 2. Fetch Entity Directory
  const fetchEntities = useCallback(
    async (searchQuery = '', typeFilter = 'ALL') => {
      if (!activeWorkspace || !accessToken) return;

      try {
        const params = new URLSearchParams();
        params.set('limit', '30');
        params.set('offset', '0');
        if (searchQuery.trim()) params.set('search', searchQuery.trim());
        if (typeFilter !== 'ALL') params.set('entityType', typeFilter);

        const res = await fetch(`/api/graph/entities?${params.toString()}`, {
          headers: getHeaders(),
        });

        if (res.ok) {
          const json: ApiResponse<{ items: GraphEntityListItemDto[]; total: number }> =
            await res.json();
          if (json.success && json.data) {
            setEntityList(json.data.items);
            setTotalEntityCount(json.data.total);

            // If no center selected yet, pick first matching entity
            if (!centerEntityId && json.data.items.length > 0) {
              setCenterEntityId(json.data.items[0].id);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching entity directory:', err);
      }
    },
    [activeWorkspace, accessToken, getHeaders, centerEntityId],
  );

  // 3. Fetch Bounded Neighborhood for Center Entity
  const fetchNeighborhood = useCallback(
    async (entityId: string, currentDepth: number) => {
      if (!activeWorkspace || !accessToken || !entityId) return;
      setIsLoadingNeighborhood(true);

      try {
        const res = await fetch(
          `/api/graph/entities/${entityId}/neighborhood?depth=${currentDepth}&limit=40`,
          { headers: getHeaders() },
        );

        if (res.ok) {
          const json: ApiResponse<GraphNeighborhoodDto> = await res.json();
          if (json.success && json.data) {
            setNodes(json.data.nodes);
            setEdges(json.data.edges);
          }
        }
      } catch (err) {
        console.error('Error fetching neighborhood:', err);
      } finally {
        setIsLoadingNeighborhood(false);
      }
    },
    [activeWorkspace, accessToken, getHeaders],
  );

  // 4. Fetch Deep Entity Detail Drawer
  const handleSelectEntity = async (entityId: string) => {
    setSelectedEntityId(entityId);
    setSelectedRelationId(null);
    setRelationEvidence(null);
    setIsLoadingDetail(true);

    try {
      const res = await fetch(`/api/graph/entities/${entityId}`, {
        headers: getHeaders(),
      });

      if (res.ok) {
        const json: ApiResponse<GraphEntityDetailDto> = await res.json();
        if (json.success && json.data) {
          setEntityDetail(json.data);
        }
      }
    } catch (err) {
      console.error('Error fetching entity details:', err);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // 5. Fetch Relation Evidence Drawer
  const handleSelectEdge = async (relationId: string) => {
    setSelectedRelationId(relationId);
    setSelectedEntityId(null);
    setEntityDetail(null);
    setIsLoadingDetail(true);

    try {
      const res = await fetch(`/api/graph/relations/${relationId}/evidence`, {
        headers: getHeaders(),
      });

      if (res.ok) {
        const json: ApiResponse<RelationEvidenceDetailDto> = await res.json();
        if (json.success && json.data) {
          setRelationEvidence(json.data);
        }
      }
    } catch (err) {
      console.error('Error fetching relation evidence:', err);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // Center & Expand neighborhood around selected node
  const handleExpandNode = (entityId: string) => {
    setCenterEntityId(entityId);
    fetchNeighborhood(entityId, depth);
    handleSelectEntity(entityId);
  };

  // Initial load
  useEffect(() => {
    fetchOverview();
    fetchEntities();
  }, [fetchOverview, fetchEntities]);

  // Re-fetch neighborhood when centerEntityId or depth changes
  useEffect(() => {
    if (centerEntityId) {
      fetchNeighborhood(centerEntityId, depth);
    }
  }, [centerEntityId, depth, fetchNeighborhood]);

  // Handle Search & Filter changes
  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    fetchEntities(val, selectedType);
  };

  const handleTypeChange = (typeVal: string) => {
    setSelectedType(typeVal);
    fetchEntities(searchTerm, typeVal);
  };

  // Loading state
  if (isLoadingOverview) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center text-theme-text-muted gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-theme-accent" />
        <span className="text-xs font-mono">Loading Knowledge Graph...</span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center p-6 text-center gap-3">
        <AlertCircle className="w-8 h-8 text-rose-500" />
        <div className="text-sm font-semibold text-theme-text">Failed to load Knowledge Graph</div>
        <div className="text-xs text-theme-text-muted max-w-sm">{error}</div>
        <button
          onClick={fetchOverview}
          className="px-4 py-1.5 rounded-xl bg-theme-accent text-white text-xs font-medium hover:bg-theme-accent-hover transition-colors shadow-subtle mt-2"
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty state: No entities extracted yet
  if (!overview || overview.totalEntities === 0) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
        <div className="w-14 h-14 rounded-2xl bg-theme-surface border border-theme-border flex items-center justify-center text-theme-accent shadow-subtle mb-4">
          <Network className="w-7 h-7" />
        </div>
        <h2 className="text-base font-semibold text-theme-text mb-1">Knowledge Graph is Empty</h2>
        <p className="text-xs text-theme-text-muted mb-6 leading-relaxed">
          No knowledge entities or relationships have been extracted yet. Upload PDFs, markdown
          documents, or notes in the Document Library to automatically extract entities and populate
          your graph.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-theme-bg">
      {/* Top Filter and Controls Bar */}
      <GraphFilterBar
        searchTerm={searchTerm}
        onSearchChange={handleSearchChange}
        selectedType={selectedType}
        onTypeChange={handleTypeChange}
        depth={depth}
        onDepthChange={setDepth}
        onRefresh={() => {
          fetchOverview();
          if (centerEntityId) fetchNeighborhood(centerEntityId, depth);
        }}
        isLoading={isLoadingNeighborhood}
        totalEntities={overview.totalEntities}
        totalRelations={overview.totalRelations}
      />

      {/* Main Content: Split into Entity Sidebar & Interactive Canvas */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Entity Quick Directory (Left Panel) */}
        <aside className="w-64 border-r border-theme-border bg-theme-surface/70 flex flex-col shrink-0 hidden md:flex">
          <div className="p-3 border-b border-theme-border/60 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-theme-text-muted">
              Entities ({totalEntityCount})
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {entityList.map((ent) => {
              const isSelected = selectedEntityId === ent.id || centerEntityId === ent.id;
              return (
                <button
                  key={ent.id}
                  onClick={() => handleExpandNode(ent.id)}
                  className={`w-full flex items-center justify-between p-2 rounded-xl text-left text-xs transition-colors group ${
                    isSelected
                      ? 'bg-theme-surface text-theme-text font-medium border border-theme-border shadow-subtle'
                      : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate pr-1">
                    <span className="w-2 h-2 rounded-full bg-theme-accent shrink-0" />
                    <span className="truncate">{ent.canonicalName}</span>
                  </div>
                  <span className="text-[10px] font-mono text-theme-text-muted px-1.5 py-0.5 rounded bg-theme-surface-secondary shrink-0">
                    {ent.degree}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Center: Interactive Graph Canvas */}
        <div className="flex-1 h-full relative overflow-hidden">
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            centerEntityId={centerEntityId}
            selectedEntityId={selectedEntityId}
            selectedRelationId={selectedRelationId}
            onSelectNode={handleSelectEntity}
            onSelectEdge={handleSelectEdge}
            onExpandNode={handleExpandNode}
          />
        </div>

        {/* Right: Sliding Detail Drawer */}
        {selectedEntityId && (
          <EntityDetailDrawer
            entity={entityDetail}
            onClose={() => {
              setSelectedEntityId(null);
              setEntityDetail(null);
            }}
            onExploreNeighborhood={handleExpandNode}
          />
        )}

        {/* Right: Sliding Relation Evidence Drawer */}
        {selectedRelationId && (
          <RelationEvidenceDrawer
            relation={relationEvidence}
            onClose={() => {
              setSelectedRelationId(null);
              setRelationEvidence(null);
            }}
          />
        )}
      </div>
    </div>
  );
};
