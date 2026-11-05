import React, { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';

interface DocumentUploaderProps {
  onFilesSelected: (files: File[]) => void;
  isUploading?: boolean;
}

const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];

export const DocumentUploader: React.FC<DocumentUploaderProps> = ({
  onFilesSelected,
  isUploading,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      onFilesSelected(files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      onFilesSelected(files);
      e.target.value = '';
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
        isDragOver
          ? 'border-blue-500 bg-blue-500/10 scale-[1.01]'
          : 'border-vault-800 bg-vault-900/30 hover:border-vault-700 hover:bg-vault-900/50'
      } ${isUploading ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        multiple
        accept=".pdf,.docx,.txt,.md"
        className="hidden"
      />

      <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
        <UploadCloud className="w-6 h-6" />
      </div>

      <h4 className="text-sm font-semibold text-white mb-1">
        Click to upload or drag & drop files here
      </h4>
      <p className="text-xs text-vault-400 max-w-sm mx-auto mb-4">
        Supports PDF, Word (.docx), Markdown (.md), and plain text (.txt) up to 25 MB per file.
      </p>

      {/* Format tags */}
      <div className="flex items-center justify-center gap-2">
        {SUPPORTED_EXTENSIONS.map((ext) => (
          <span
            key={ext}
            className="px-2 py-0.5 rounded text-[11px] font-mono bg-vault-850 text-vault-300 border border-vault-700"
          >
            {ext}
          </span>
        ))}
      </div>
    </div>
  );
};
