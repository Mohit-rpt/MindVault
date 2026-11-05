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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-md rounded-2xl bg-vault-900 border border-vault-800 p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-vault-800 mb-4">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-400" />
            <h3 className="font-semibold text-white text-base">Create New Workspace</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-vault-400 hover:text-white hover:bg-vault-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-vault-300 mb-1.5">
              Workspace Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Engineering Knowledge"
              className="w-full px-3 py-2 bg-vault-950 border border-vault-800 rounded-lg text-sm text-white placeholder-vault-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-vault-300 mb-1.5">
              Custom Slug <span className="text-vault-500">(Optional)</span>
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="engineering-knowledge"
              className="w-full px-3 py-2 bg-vault-950 border border-vault-800 rounded-lg text-sm text-white placeholder-vault-500 focus:outline-none focus:border-blue-500 font-mono text-xs transition-colors"
            />
            <p className="text-[11px] text-vault-500 mt-1">
              Used in scoped URLs and workspace routing
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-vault-400 hover:text-white hover:bg-vault-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium shadow-md shadow-blue-500/20 transition-all flex items-center gap-2 disabled:opacity-50"
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
