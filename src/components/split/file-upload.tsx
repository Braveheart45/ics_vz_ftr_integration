'use client';

import { useState, useRef, useCallback, type DragEvent } from 'react';
import { useAppStore } from '@/stores/use-app-store';
import { Upload, X, FileText, FileSpreadsheet, File, FileCode, FileImage } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Helpers ───────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type: string) {
  if (type.includes('csv') || type.includes('spreadsheet') || type.includes('excel')) {
    return <FileSpreadsheet className="size-4 text-emerald-500" />;
  }
  if (type.includes('pdf')) {
    return <File className="size-4 text-red-500" />;
  }
  if (type.includes('word') || type.includes('document')) {
    return <FileText className="size-4 text-blue-500" />;
  }
  if (type.includes('markdown') || type.includes('text') || type.includes('md')) {
    return <FileCode className="size-4 text-amber-600" />;
  }
  if (type.includes('image')) {
    return <FileImage className="size-4 text-purple-500" />;
  }
  return <File className="size-4 text-muted-foreground" />;
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
      // Reset input so the same file can be re-selected
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
          'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-4 transition-colors',
          isDragOver
            ? 'border-primary/50 bg-primary/5'
            : 'border-muted-foreground/25 bg-muted/30 hover:border-muted-foreground/40 hover:bg-muted/50'
        )}
      >
        <Upload className="size-5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          Drop files here or <span className="font-medium text-foreground">browse</span>
        </span>
        <span className="text-[10px] text-muted-foreground/60">
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
              className="group flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs shadow-xs"
            >
              {getFileIcon(file.type)}
              <span className="max-w-[140px] truncate font-medium">{file.name}</span>
              <span className="text-muted-foreground/60">{formatFileSize(file.size)}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(file.id);
                }}
                className="ml-0.5 rounded-full p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
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
