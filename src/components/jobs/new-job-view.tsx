'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Ticket,
  FileText,
  Code,
  FileUp,
  Upload,
  Sparkles,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppStore } from '@/stores/use-app-store';
import type { InputMode } from '@/lib/types';

// ============================================================
// Types
// ============================================================

interface JiraFormData {
  ticketId: string;
  ticketTitle: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

interface StmFormData {
  documentTitle: string;
  sourceSystem: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

interface LegacySqlFormData {
  jobTitle: string;
  sourceDialect: string;
  sqlCode: string;
  conversionGoals: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

// ============================================================
// Input Mode Card Definitions
// ============================================================

interface ModeCardDef {
  mode: InputMode;
  title: string;
  description: string;
  icon: React.ElementType;
  accentBg: string;
  accentText: string;
  accentBorder: string;
  accentIconBg: string;
}

const MODE_CARDS: ModeCardDef[] = [
  {
    mode: 'jira',
    title: 'Jira Story or Ticket',
    description:
      'Import requirements from a Jira ticket. Attach supporting documents or mapping files.',
    icon: Ticket,
    accentBg: 'bg-blue-50',
    accentText: 'text-blue-700',
    accentBorder: 'border-blue-400',
    accentIconBg: 'bg-blue-100',
  },
  {
    mode: 'stm',
    title: 'STM or Business Document',
    description:
      'Upload a Source-to-Target Mapping file, business requirements document, or specification.',
    icon: FileText,
    accentBg: 'bg-purple-50',
    accentText: 'text-purple-700',
    accentBorder: 'border-purple-400',
    accentIconBg: 'bg-purple-100',
  },
  {
    mode: 'legacy_sql',
    title: 'Legacy SQL Modernization',
    description:
      'Upload legacy SQL code (T-SQL, PL/SQL, etc.) for conversion to BigQuery-compatible SQL.',
    icon: Code,
    accentBg: 'bg-emerald-50',
    accentText: 'text-emerald-700',
    accentBorder: 'border-emerald-400',
    accentIconBg: 'bg-emerald-100',
  },
];

// ============================================================
// Animation Variants
// ============================================================

const formVariants = {
  hidden: { opacity: 0, y: 20, height: 0 },
  visible: {
    opacity: 1,
    y: 0,
    height: 'auto',
    transition: { duration: 0.35, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    y: -10,
    height: 0,
    transition: { duration: 0.2, ease: 'easeIn' },
  },
};

// ============================================================
// Component
// ============================================================

export function NewJobView() {
  const { createJob, selectJob, setCurrentView } = useAppStore();

  // ── State ────────────────────────────────────────────────
  const [selectedMode, setSelectedMode] = useState<InputMode | null>(null);

  // Jira form
  const [jiraForm, setJiraForm] = useState<JiraFormData>({
    ticketId: '',
    ticketTitle: '',
    description: '',
    priority: 'medium',
  });

  // STM form
  const [stmForm, setStmForm] = useState<StmFormData>({
    documentTitle: '',
    sourceSystem: '',
    description: '',
    priority: 'medium',
  });

  // Legacy SQL form
  const [legacySqlForm, setLegacySqlForm] = useState<LegacySqlFormData>({
    jobTitle: '',
    sourceDialect: '',
    sqlCode: '',
    conversionGoals: '',
    priority: 'medium',
  });

  // Mock attached files for Jira
  const mockAttachments = ['schema_mapping.xlsx', 'business_rules.docx'];

  // ── Handlers ─────────────────────────────────────────────
  const handleBack = () => setCurrentView('dashboard');

  const handleModeSelect = (mode: InputMode) => {
    setSelectedMode(mode);
  };

  const handleSubmit = () => {
    if (!selectedMode) return;

    const now = new Date().toISOString();

    try {
      if (selectedMode === 'jira') {
        if (!jiraForm.ticketId.trim() || !jiraForm.ticketTitle.trim()) {
          toast.error('Please fill in the Ticket ID and Ticket Title.');
          return;
        }
        const job = createJob({
          title: jiraForm.ticketTitle,
          description: jiraForm.description || `Jira ticket: ${jiraForm.ticketId}`,
          inputSource: {
            type: 'jira',
            reference: jiraForm.ticketId,
            summary: jiraForm.description,
            attachments: mockAttachments,
            uploadedAt: now,
          },
          currentStage: 'intake',
          status: 'in_progress',
          progress: 5,
          priority: jiraForm.priority,
        });
        selectJob(job.id);
      }

      if (selectedMode === 'stm') {
        if (!stmForm.documentTitle.trim() || !stmForm.sourceSystem) {
          toast.error('Please fill in the Document Title and Source System.');
          return;
        }
        const job = createJob({
          title: stmForm.documentTitle,
          description:
            stmForm.description ||
            `STM migration from ${stmForm.sourceSystem} to BigQuery`,
          inputSource: {
            type: 'stm',
            reference: stmForm.documentTitle,
            summary: stmForm.description,
            uploadedAt: now,
          },
          currentStage: 'intake',
          status: 'in_progress',
          progress: 5,
          priority: stmForm.priority,
        });
        selectJob(job.id);
      }

      if (selectedMode === 'legacy_sql') {
        if (!legacySqlForm.jobTitle.trim() || !legacySqlForm.sqlCode.trim()) {
          toast.error('Please fill in the Job Title and SQL Code.');
          return;
        }
        const job = createJob({
          title: legacySqlForm.jobTitle,
          description:
            legacySqlForm.conversionGoals ||
            `Convert ${legacySqlForm.sourceDialect || 'legacy'} SQL to BigQuery`,
          inputSource: {
            type: 'legacy_sql',
            reference: legacySqlForm.jobTitle,
            summary: legacySqlForm.conversionGoals,
            uploadedAt: now,
          },
          currentStage: 'intake',
          status: 'in_progress',
          progress: 5,
          priority: legacySqlForm.priority,
        });
        selectJob(job.id);
      }

      toast.success('Job created successfully');
    } catch {
      toast.error('Failed to create job. Please try again.');
    }
  };

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* ============================================================
          Header
          ============================================================ */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <div className="mb-2 flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={handleBack} className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to dashboard</span>
            </Button>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Create New SQL Job
            </h1>
          </div>
          <p className="text-sm text-muted-foreground sm:ml-11">
            Select an input method to start a new SQL generation or conversion workflow.
          </p>
        </div>
      </motion.div>

      {/* ============================================================
          Input Mode Selection Cards
          ============================================================ */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.1 }}
        className="grid grid-cols-1 gap-6 md:grid-cols-3"
      >
        {MODE_CARDS.map((card) => {
          const isSelected = selectedMode === card.mode;
          const IconComp = card.icon;
          return (
            <button
              key={card.mode}
              type="button"
              onClick={() => handleModeSelect(card.mode)}
              className="group relative"
            >
              <Card
                className={`h-full cursor-pointer border-2 p-6 text-center transition-all duration-200 hover:shadow-lg ${
                  isSelected
                    ? `border-primary bg-primary/5 ${card.accentBg}`
                    : 'border-muted hover:border-primary/50'
                }`}
              >
                {/* Icon */}
                <div
                  className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl transition-colors ${
                    isSelected ? card.accentIconBg : 'bg-muted'
                  }`}
                >
                  <IconComp
                    className={`h-8 w-8 transition-colors ${
                      isSelected ? card.accentText : 'text-muted-foreground'
                    }`}
                  />
                </div>

                {/* Title */}
                <h3 className="mb-2 text-base font-semibold text-gray-900">{card.title}</h3>

                {/* Description */}
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {card.description}
                </p>

                {/* Selected indicator */}
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute right-3 top-3"
                  >
                    <Badge variant="default" className="text-[10px]">
                      Selected
                    </Badge>
                  </motion.div>
                )}
              </Card>
            </button>
          );
        })}
      </motion.div>

      {/* ============================================================
          Dynamic Form Section
          ============================================================ */}
      <AnimatePresence mode="wait">
        {selectedMode === 'jira' && (
          <motion.div
            key="jira-form"
            variants={formVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <Card className="p-6">
              <CardHeader className="mb-4 space-y-1 p-0">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Ticket className="h-5 w-5 text-blue-500" />
                  Jira Ticket Details
                </CardTitle>
                <CardDescription>
                  Enter the Jira ticket information to begin requirement analysis.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4 p-0">
                {/* Ticket ID & Title row */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="jira-ticket-id" className="text-sm font-medium">
                      Jira Ticket ID
                    </Label>
                    <Input
                      id="jira-ticket-id"
                      placeholder="e.g., DE-2847"
                      value={jiraForm.ticketId}
                      onChange={(e) =>
                        setJiraForm((prev) => ({ ...prev, ticketId: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="jira-ticket-title" className="text-sm font-medium">
                      Ticket Title
                    </Label>
                    <Input
                      id="jira-ticket-title"
                      placeholder="Enter ticket title..."
                      value={jiraForm.ticketTitle}
                      onChange={(e) =>
                        setJiraForm((prev) => ({ ...prev, ticketTitle: e.target.value }))
                      }
                    />
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="jira-description" className="text-sm font-medium">
                    Description
                  </Label>
                  <Textarea
                    id="jira-description"
                    rows={4}
                    placeholder="Describe the ticket requirements..."
                    value={jiraForm.description}
                    onChange={(e) =>
                      setJiraForm((prev) => ({ ...prev, description: e.target.value }))
                    }
                  />
                </div>

                {/* Priority */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Priority</Label>
                  <Select
                    value={jiraForm.priority}
                    onValueChange={(value) =>
                      setJiraForm((prev) => ({
                        ...prev,
                        priority: value as JiraFormData['priority'],
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* File Upload Area */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Attachments</Label>
                  <div className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-primary/50">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <FileUp className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-gray-700">
                      Drop attachments here or click to browse
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Supports .xlsx, .csv, .docx, .pdf files
                    </p>
                  </div>

                  {/* Mock file chips */}
                  <div className="flex flex-wrap gap-2">
                    {mockAttachments.map((fileName) => (
                      <Badge
                        key={fileName}
                        variant="secondary"
                        className="gap-1.5 px-3 py-1 text-xs"
                      >
                        <FileText className="h-3 w-3" />
                        {fileName}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Submit */}
                <Button onClick={handleSubmit} size="lg" className="w-full mt-4 gap-2">
                  <Sparkles className="h-4 w-4" />
                  Create Job &amp; Start Analysis
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {selectedMode === 'stm' && (
          <motion.div
            key="stm-form"
            variants={formVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <Card className="p-6">
              <CardHeader className="mb-4 space-y-1 p-0">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5 text-purple-500" />
                  STM / Business Document
                </CardTitle>
                <CardDescription>
                  Upload a Source-to-Target Mapping file or business requirements document.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4 p-0">
                {/* Document Title */}
                <div className="space-y-2">
                  <Label htmlFor="stm-title" className="text-sm font-medium">
                    Document Title
                  </Label>
                  <Input
                    id="stm-title"
                    placeholder="e.g., CRM Data Migration STM"
                    value={stmForm.documentTitle}
                    onChange={(e) =>
                      setStmForm((prev) => ({ ...prev, documentTitle: e.target.value }))
                    }
                  />
                </div>

                {/* Source & Target row */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Source System</Label>
                    <Select
                      value={stmForm.sourceSystem}
                      onValueChange={(value) =>
                        setStmForm((prev) => ({ ...prev, sourceSystem: value }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select source" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="teradata">Teradata</SelectItem>
                        <SelectItem value="oracle">Oracle</SelectItem>
                        <SelectItem value="sqlserver">SQL Server</SelectItem>
                        <SelectItem value="netezza">Netezza</SelectItem>
                        <SelectItem value="snowflake">Snowflake</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="stm-target" className="text-sm font-medium">
                      Target Platform
                    </Label>
                    <Input
                      id="stm-target"
                      defaultValue="BigQuery"
                      readOnly
                      className="bg-muted cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* Upload Area (larger) */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Upload Document</Label>
                  <div className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors hover:border-primary/50">
                    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-purple-50">
                      <Upload className="h-7 w-7 text-purple-500" />
                    </div>
                    <p className="text-sm font-medium text-gray-700">
                      Drop your STM or document here or click to browse
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Accepted formats: .xlsx, .csv, .docx, .pdf
                    </p>
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="stm-description" className="text-sm font-medium">
                    Description / Notes
                  </Label>
                  <Textarea
                    id="stm-description"
                    rows={3}
                    placeholder="Any additional context about the migration..."
                    value={stmForm.description}
                    onChange={(e) =>
                      setStmForm((prev) => ({ ...prev, description: e.target.value }))
                    }
                  />
                </div>

                {/* Priority */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Priority</Label>
                  <Select
                    value={stmForm.priority}
                    onValueChange={(value) =>
                      setStmForm((prev) => ({
                        ...prev,
                        priority: value as StmFormData['priority'],
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Submit */}
                <Button onClick={handleSubmit} size="lg" className="w-full mt-4 gap-2">
                  <Upload className="h-4 w-4" />
                  Upload &amp; Process Document
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {selectedMode === 'legacy_sql' && (
          <motion.div
            key="legacy-sql-form"
            variants={formVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <Card className="p-6">
              <CardHeader className="mb-4 space-y-1 p-0">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Code className="h-5 w-5 text-emerald-500" />
                  Legacy SQL Modernization
                </CardTitle>
                <CardDescription>
                  Paste your legacy SQL code for conversion to BigQuery-compatible SQL.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4 p-0">
                {/* Job Title & Dialect row */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="legacy-title" className="text-sm font-medium">
                      Job Title
                    </Label>
                    <Input
                      id="legacy-title"
                      placeholder="e.g., Customer Analytics Migration"
                      value={legacySqlForm.jobTitle}
                      onChange={(e) =>
                        setLegacySqlForm((prev) => ({ ...prev, jobTitle: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Source Dialect</Label>
                    <Select
                      value={legacySqlForm.sourceDialect}
                      onValueChange={(value) =>
                        setLegacySqlForm((prev) => ({ ...prev, sourceDialect: value }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select dialect" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tsql">T-SQL</SelectItem>
                        <SelectItem value="plsql">PL/SQL</SelectItem>
                        <SelectItem value="mysql">MySQL</SelectItem>
                        <SelectItem value="hiveql">HiveQL</SelectItem>
                        <SelectItem value="impala">Impala</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* SQL Code */}
                <div className="space-y-2">
                  <Label htmlFor="legacy-sql" className="text-sm font-medium">
                    SQL Code
                  </Label>
                  <Textarea
                    id="legacy-sql"
                    className="min-h-[200px] resize-y font-mono text-sm"
                    placeholder="-- Paste your legacy SQL here..."
                    value={legacySqlForm.sqlCode}
                    onChange={(e) =>
                      setLegacySqlForm((prev) => ({ ...prev, sqlCode: e.target.value }))
                    }
                  />
                </div>

                {/* Conversion Goals */}
                <div className="space-y-2">
                  <Label htmlFor="legacy-goals" className="text-sm font-medium">
                    Conversion Goals
                  </Label>
                  <Textarea
                    id="legacy-goals"
                    rows={3}
                    placeholder="Describe what you want to achieve with this conversion..."
                    value={legacySqlForm.conversionGoals}
                    onChange={(e) =>
                      setLegacySqlForm((prev) => ({
                        ...prev,
                        conversionGoals: e.target.value,
                      }))
                    }
                  />
                </div>

                {/* Priority */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Priority</Label>
                  <Select
                    value={legacySqlForm.priority}
                    onValueChange={(value) =>
                      setLegacySqlForm((prev) => ({
                        ...prev,
                        priority: value as LegacySqlFormData['priority'],
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Submit */}
                <Button onClick={handleSubmit} size="lg" className="w-full mt-4 gap-2">
                  <Sparkles className="h-4 w-4" />
                  Submit for Conversion
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
