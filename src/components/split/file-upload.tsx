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
          'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border transition-all duration-200',
          isDragOver
            ? 'border-primary/30 bg-primary/[0.03] shadow-[0_0_0_1px_oklch(0.22_0.012_60/0.1)]'
            : 'border-border hover:border-muted-foreground/25 hover:bg-secondary/30'
        )}
      >
        <div className={cn(
          'flex size-7 items-center justify-center rounded-md transition-colors',
          isDragOver ? 'bg-primary/10' : 'bg-muted/50'
        )}>
          <Upload className="size-3.5 text-muted-foreground/60" />
        </div>
        <span className="text-xs text-muted-foreground/70">
          Drop files here or <span className="font-medium text-foreground/70">browse</span>
        </span>
        <span className="text-[10px] text-muted-foreground/35 tracking-wide">
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
              className="group flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs shadow-[0_1px_2px_0_oklch(0_0_0/0.03)]"
            >
              <FileText className="size-3.5 text-muted-foreground/50" />
              <span className="max-w-[120px] truncate font-medium text-foreground/80">{file.name}</span>
              <span className="text-muted-foreground/40">{formatFileSize(file.size)}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(file.id);
                }}
                className="ml-0.5 rounded-full p-0.5 text-muted-foreground/30 opacity-0 transition-all hover:text-foreground/60 group-hover:opacity-100"
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
