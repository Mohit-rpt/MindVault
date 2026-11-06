import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { X, Layers, AlertCircle, Loader2 } from 'lucide-react';
import type { ApiResponse, WorkspaceDto } from '@mindvault/shared';

interface CreateWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateWorkspaceModal: React.FC<CreateWorkspaceModalProps> = ({ isOpen, onClose }) => {
  const { accessToken, refreshWorkspaces, setActiveWorkspace } = useAuth();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim() || undefined,
        }),
      });

      const json: ApiResponse<WorkspaceDto> = await res.json();
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error?.message || 'Failed to create workspace');
      }

      await refreshWorkspaces();
      setActiveWorkspace(json.data);
      setName('');
      setSlug('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creating workspace');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-md rounded-2xl bg-theme-surface border border-theme-border p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-theme-border mb-4">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-theme-accent" />
            <h3 className="font-semibold text-theme-text text-base">Create New Workspace</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-theme-text mb-1.5">
              Workspace Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Engineering Knowledge"
              className="w-full px-3 py-2 bg-theme-surface-secondary border border-theme-border rounded-xl text-sm text-theme-text placeholder-theme-text-muted focus:outline-none focus:border-theme-accent transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-theme-text mb-1.5">
              Custom Slug <span className="text-theme-text-muted">(Optional)</span>
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="engineering-knowledge"
              className="w-full px-3 py-2 bg-theme-surface-secondary border border-theme-border rounded-xl text-sm text-theme-text placeholder-theme-text-muted focus:outline-none focus:border-theme-accent font-mono text-xs transition-colors"
            />
            <p className="text-[11px] text-theme-text-muted mt-1">
              Used in scoped URLs and workspace routing
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-theme-accent hover:opacity-90 text-white rounded-xl text-xs font-medium shadow-xs transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Create Workspace
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
