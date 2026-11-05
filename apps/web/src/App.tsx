import React, { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { MetricCard } from './components/MetricCard';
import {
  Server,
  Layers,
  Cpu,
  Database,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  FileText,
  Workflow,
  Search,
} from 'lucide-react';
import type { HealthCheckResponse } from '@mindvault/shared';

export const App: React.FC = () => {
  const [healthData, setHealthData] = useState<HealthCheckResponse | null>(null);
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [latency, setLatency] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const checkHealth = async () => {
    setIsRefreshing(true);
    const start = performance.now();
    try {
      const res = await fetch('/api/health');
      const data: HealthCheckResponse = await res.json();
      const end = performance.now();
      setLatency(Math.round(end - start));
      setHealthData(data);
      setApiStatus(data.status === 'healthy' ? 'connected' : 'disconnected');
    } catch {
      setApiStatus('disconnected');
      setHealthData(null);
      setLatency(null);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Layout apiStatus={apiStatus}>
      <div className="space-y-8">
        {/* Hero Section */}
        <div className="relative overflow-hidden rounded-2xl border border-vault-800 bg-gradient-to-b from-vault-900/60 to-vault-950 p-8 sm:p-10">
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-400">
              <span className="flex h-1.5 w-1.5 rounded-full bg-blue-400"></span>
              Phase 0: Foundation & Core Skeletons Active
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              MindVault Knowledge OS
            </h1>
            <p className="text-base sm:text-lg text-vault-300 leading-relaxed">
              Transform disconnected documents, technical notes, and code into an evidence-grounded,
              traceable, and continuously useful knowledge system.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={checkHealth}
                disabled={isRefreshing}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-vault-800 hover:bg-vault-700 text-sm font-medium text-white transition-colors border border-vault-700"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                Probe API Health
              </button>
              {latency !== null && (
                <span className="text-xs font-mono text-vault-400 px-3 py-2 rounded-lg bg-vault-900 border border-vault-800">
                  Latency: {latency}ms
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Foundation Status Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Core API Service"
            value="Express + TS"
            subtitle="Strict validation & logging"
            status={apiStatus === 'connected' ? 'active' : 'pending'}
            icon={<Server className="w-5 h-5" />}
          />
          <MetricCard
            title="Background Worker"
            value="BullMQ Ready"
            subtitle="Asynchronous processor"
            status="ready"
            icon={<Cpu className="w-5 h-5" />}
          />
          <MetricCard
            title="Vector Storage"
            value="pgvector"
            subtitle="HNSW & Cosine Search"
            status="ready"
            icon={<Database className="w-5 h-5" />}
          />
          <MetricCard
            title="Monorepo Architecture"
            value="pnpm Workspaces"
            subtitle="Modular Monolith"
            status="active"
            icon={<Layers className="w-5 h-5" />}
          />
        </div>

        {/* Live API Health Probe Details */}
        <div className="rounded-xl border border-vault-800 bg-vault-900/30 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-400" />
              Runtime Diagnostic Inspector
            </h2>
            <span className="text-xs font-mono text-vault-400">GET /api/health</span>
          </div>

          {healthData ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
              <div className="p-4 rounded-lg bg-vault-950/70 border border-vault-800/80 space-y-2">
                <span className="text-vault-400 block font-sans">Service Process</span>
                <div className="text-slate-200">Name: {healthData.service}</div>
                <div className="text-slate-200">Status: {healthData.status}</div>
                <div className="text-slate-200">Uptime: {healthData.uptime}s</div>
              </div>
              <div className="p-4 rounded-lg bg-vault-950/70 border border-vault-800/80 space-y-2">
                <span className="text-vault-400 block font-sans">Dependencies Status</span>
                <div className="text-slate-200">
                  PostgreSQL: {healthData.dependencies.database.status}
                </div>
                <div className="text-slate-200">Redis: {healthData.dependencies.redis.status}</div>
                <div className="text-vault-500 text-[11px]">
                  Unverified checks deferred to Phase 1/2
                </div>
              </div>
              <div className="p-4 rounded-lg bg-vault-950/70 border border-vault-800/80 space-y-2">
                <span className="text-vault-400 block font-sans">Timestamp & Version</span>
                <div className="text-slate-200">Version: {healthData.version}</div>
                <div className="text-vault-400 truncate">{healthData.timestamp}</div>
              </div>
            </div>
          ) : (
            <div className="p-6 rounded-lg bg-vault-950/50 border border-dashed border-vault-800 text-center text-vault-400 text-xs">
              API process unreachable or server starting up. Run `pnpm dev:api` to connect.
            </div>
          )}
        </div>

        {/* Phase Roadmap Overview */}
        <div className="rounded-xl border border-vault-800 bg-vault-900/30 p-6 space-y-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Workflow className="w-4 h-4 text-cyan-400" />
            Engineering Roadmap Alignment
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-vault-900/60 border border-emerald-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-400">PHASE 0 (CURRENT)</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-sm font-medium text-white">Project Foundation</div>
              <p className="text-xs text-vault-400">
                Monorepo tooling, Docker Compose configurations, strict TypeScript, API health
                probe, worker skeleton.
              </p>
            </div>

            <div className="p-4 rounded-lg bg-vault-900/40 border border-vault-800 space-y-2 opacity-80">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-vault-400">PHASE 1 (NEXT)</span>
                <ArrowRight className="w-4 h-4 text-vault-500" />
              </div>
              <div className="text-sm font-medium text-white">Authentication & Workspace</div>
              <p className="text-xs text-vault-400">
                Prisma schema, secure user sessions, workspace-level data isolation, and permission
                guards.
              </p>
            </div>

            <div className="p-4 rounded-lg bg-vault-900/40 border border-vault-800 space-y-2 opacity-60">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-vault-400">PHASE 2</span>
                <FileText className="w-4 h-4 text-vault-500" />
              </div>
              <div className="text-sm font-medium text-white">Document Ingestion</div>
              <p className="text-xs text-vault-400">
                PDF/TXT/MD parsing, structural chunking, BullMQ background queues, status tracking.
              </p>
            </div>
          </div>
        </div>

        {/* Product Principles Banner */}
        <div className="rounded-xl border border-vault-800/80 bg-vault-900/20 p-6">
          <div className="flex items-center gap-2 mb-3">
            <Search className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">Core Architectural Principles</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs text-vault-300">
            <div className="p-3 rounded-lg bg-vault-900/40 border border-vault-800">
              <span className="font-medium text-white block mb-1">1. User Knowledge Ownership</span>
              Knowledge belongs strictly to the user with workspace-level isolation.
            </div>
            <div className="p-3 rounded-lg bg-vault-900/40 border border-vault-800">
              <span className="font-medium text-white block mb-1">2. Evidence-Grounded</span>
              Every AI claim must trace to source chunks, versions, and verified citations.
            </div>
            <div className="p-3 rounded-lg bg-vault-900/40 border border-vault-800">
              <span className="font-medium text-white block mb-1">3. Provider-Agnostic</span>
              Interchangeable adapters for local (Ollama) and hosted LLMs and embeddings.
            </div>
            <div className="p-3 rounded-lg bg-vault-900/40 border border-vault-800">
              <span className="font-medium text-white block mb-1">4. Asynchronous Pipeline</span>
              Heavy ingestion, parsing, and embedding generation handled off the main loop.
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};
