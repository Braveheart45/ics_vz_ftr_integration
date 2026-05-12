'use client';

import { useState, useRef, useCallback, type DragEvent } from 'react';
import { useAppStore } from '@/stores/use-app-store';
import { Upload, X, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Helpers ───────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SUPPORTED_FORMATS = ['TXT', 'CSV', 'XLSX', 'DOCX', 'PPTX', 'PDF', 'MD'];

// ── Component ─────────────────────────────────────────────────
export function FileUpload() {
  const uploadedFiles = useAppStore((s) => s.uploadedFiles);
  const addFile = useAppStore((s) => s.addFile);
  const removeFile = useAppStore((s) => s.removeFile);

  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      Array.from(fileList).forEach((file) => {
        addFile({
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          type: file.type,
          uploadedAt: new Date().toISOString(),
        });
      });
    },
    [addFile]
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      e.target.value = '';
    },
    [handleFiles]
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleClick();
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2.5 transition-colors',
          isDragOver
            ? 'border-foreground/20 bg-foreground/[0.02]'
            : 'border-muted-foreground/20 hover:border-muted-foreground/35'
        )}
      >
        <Upload className="size-4 text-muted-foreground/50" />
        <span className="text-xs text-muted-foreground/60">
          Attach files
        </span>
        <span className="text-[10px] text-muted-foreground/30">
          {SUPPORTED_FORMATS.join(' · ')}
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".txt,.csv,.xlsx,.docx,.pptx,.pdf,.md"
          onChange={handleInputChange}
          className="sr-only"
          aria-label="Upload files"
        />
      </div>

      {/* File chips */}
      {uploadedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {uploadedFiles.map((file) => (
            <div
              key={file.id}
              className="group flex items-center gap-1.5 rounded-md border border-muted-foreground/15 bg-muted/40 px-2 py-1 text-xs"
            >
              <FileText className="size-3.5 text-muted-foreground/60" />
              <span className="max-w-[120px] truncate text-foreground/80">{file.name}</span>
              <span className="text-muted-foreground/40">{formatFileSize(file.size)}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(file.id);
                }}
                className="ml-0.5 rounded-full p-0.5 text-muted-foreground/40 opacity-0 transition-opacity hover:text-foreground/70 group-hover:opacity-100"
                aria-label={`Remove ${file.name}`}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
