import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import type { ApiResponse, DocumentDto, PaginatedResponse } from '@mindvault/shared';
import { DocumentCard } from './DocumentCard';
import { DocumentUploader } from './DocumentUploader';
import { UploadProgress, type UploadItem } from './UploadProgress';
import { DocumentDetails } from './DocumentDetails';
import { EmptyLibraryState } from './EmptyLibraryState';
import { Search, UploadCloud, RefreshCw } from 'lucide-react';

export const DocumentLibrary: React.FC = () => {
  const { activeWorkspace, accessToken } = useAuth();
  const [documents, setDocuments] = useState<DocumentDto[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedDocument, setSelectedDocument] = useState<DocumentDto | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(
    null,
  );

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchDocuments = useCallback(
    async (showLoadingSpinner = true) => {
      if (!activeWorkspace || !accessToken) return;

      if (showLoadingSpinner) setIsLoading(true);
      else setIsRefreshing(true);

      try {
        const params = new URLSearchParams();
        params.append('workspaceId', activeWorkspace.id);
        params.append('limit', '50');
        if (searchQuery.trim()) {
          params.append('search', searchQuery.trim());
        }
        if (statusFilter !== 'ALL') {
          params.append('status', statusFilter);
        }

        const res = await fetch(`/api/documents?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'x-workspace-id': activeWorkspace.id,
          },
        });

        if (res.ok) {
          const json: ApiResponse<PaginatedResponse<DocumentDto>> = await res.json();
          if (json.success && json.data) {
            setDocuments(json.data.items);
            setTotalCount(json.data.total);
          }
        }
      } catch (err) {
        console.error('Failed to load documents:', err);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [activeWorkspace, accessToken, searchQuery, statusFilter],
  );

  useEffect(() => {
    fetchDocuments(true);
  }, [fetchDocuments]);

  // Polling mechanism: If any document is in UPLOADED, QUEUED, or PROCESSING, poll every 3s
  useEffect(() => {
    const hasPending = documents.some(
      (d) => d.status === 'UPLOADED' || d.status === 'QUEUED' || d.status === 'PROCESSING',
    );

    if (hasPending) {
      pollingRef.current = setInterval(() => {
        fetchDocuments(false);
      }, 3000);
    } else if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [documents, fetchDocuments]);

  const handleUploadFiles = async (files: File[]) => {
    if (!activeWorkspace || !accessToken) return;

    for (const file of files) {
      const uploadId = `upl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const newItem: UploadItem = {
        id: uploadId,
        name: file.name,
        size: file.size,
        progress: 10,
        status: 'uploading',
      };

      setUploadQueue((prev) => [newItem, ...prev]);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('workspaceId', activeWorkspace.id);

      try {
        // Update progress simulation
        setUploadQueue((prev) =>
          prev.map((item) => (item.id === uploadId ? { ...item, progress: 60 } : item)),
        );

        const res = await fetch('/api/documents/upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'x-workspace-id': activeWorkspace.id,
          },
          body: formData,
        });

        const json: ApiResponse<DocumentDto> = await res.json();

        if (res.ok && json.success && json.data) {
          setUploadQueue((prev) =>
            prev.map((item) =>
              item.id === uploadId ? { ...item, progress: 100, status: 'success' } : item,
            ),
          );
          setFeedback({ text: `"${file.name}" uploaded successfully`, type: 'success' });
          fetchDocuments(false);
        } else {
          throw new Error(json.error?.message || 'Upload failed');
        }
      } catch (err: any) {
        setUploadQueue((prev) =>
          prev.map((item) =>
            item.id === uploadId
              ? { ...item, status: 'error', errorMessage: err.message || 'Upload error' }
              : item,
          ),
        );
      }
    }
  };

  const handleDeleteDocument = async (id: string) => {
    if (!activeWorkspace || !accessToken) return;
    if (!confirm('Are you sure you want to delete this document and its vector embeddings?'))
      return;

    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-workspace-id': activeWorkspace.id,
        },
      });

      if (res.ok) {
        setDocuments((prev) => prev.filter((d) => d.id !== id));
        setTotalCount((c) => Math.max(0, c - 1));
        setFeedback({ text: 'Document deleted successfully', type: 'success' });
      } else {
        const json: ApiResponse = await res.json();
        throw new Error(json.error?.message || 'Delete failed');
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Failed to delete document', type: 'error' });
    }
  };

  const handleDownloadDocument = async (id: string, name: string) => {
    if (!activeWorkspace || !accessToken) return;

    try {
      const res = await fetch(`/api/documents/${id}/download`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-workspace-id': activeWorkspace.id,
        },
      });

      if (!res.ok) throw new Error('Download failed');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err: any) {
      setFeedback({ text: err.message || 'Download failed', type: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Feedback banner */}
      {feedback && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-vault-400 hover:text-white font-bold ml-2"
          >
            ×
          </button>
        </div>
      )}

      {/* Action Header & Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-vault-500" />
          <input
            type="text"
            placeholder="Search documents by filename..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-vault-950 border border-vault-800 rounded-xl text-xs text-white placeholder-vault-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Controls: Refresh, Toggle Uploader */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchDocuments(false)}
            title="Refresh list"
            disabled={isRefreshing}
            className="p-2 rounded-xl bg-vault-900 border border-vault-800 text-vault-400 hover:text-white hover:bg-vault-850 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
          </button>
          <button
            onClick={() => setShowUploader((prev) => !prev)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium shadow-sm transition-colors"
          >
            <UploadCloud className="w-4 h-4" />
            {showUploader ? 'Hide Uploader' : 'Upload Documents'}
          </button>
        </div>
      </div>

      {/* Drag & Drop Uploader Area */}
      {showUploader && (
        <div className="space-y-4">
          <DocumentUploader onFilesSelected={handleUploadFiles} />
        </div>
      )}

      {/* Upload Progress Queue */}
      <UploadProgress
        items={uploadQueue}
        onDismiss={(id) => setUploadQueue((prev) => prev.filter((item) => item.id !== id))}
      />

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 border-b border-vault-800/80 pb-3 text-xs font-medium overflow-x-auto">
        {(['ALL', 'COMPLETED', 'PROCESSING', 'FAILED'] as const).map((st) => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              statusFilter === st
                ? 'bg-vault-800 text-white font-semibold'
                : 'text-vault-400 hover:text-white hover:bg-vault-800/50'
            }`}
          >
            {st === 'ALL'
              ? `All Documents (${totalCount})`
              : st.charAt(0) + st.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Documents Grid / Empty State */}
      {isLoading ? (
        <div className="py-20 text-center text-vault-500 text-xs">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-400" />
          Loading knowledge documents...
        </div>
      ) : documents.length === 0 ? (
        <EmptyLibraryState
          onUploadClick={() => setShowUploader(true)}
          isFiltered={Boolean(searchQuery.trim() || statusFilter !== 'ALL')}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <DocumentCard
              key={doc.id}
              document={doc}
              onViewDetails={(d) => setSelectedDocument(d)}
              onDownload={handleDownloadDocument}
              onDelete={handleDeleteDocument}
              canDelete={activeWorkspace?.role === 'OWNER' || activeWorkspace?.role === 'ADMIN'}
            />
          ))}
        </div>
      )}

      {/* Document Details Modal */}
      {selectedDocument && (
        <DocumentDetails
          document={selectedDocument}
          onClose={() => setSelectedDocument(null)}
          onDownload={handleDownloadDocument}
        />
      )}
    </div>
  );
};
