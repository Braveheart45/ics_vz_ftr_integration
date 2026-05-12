'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import {
  Inbox,
  Search,
  Database,
  ShieldCheck,
  Layers,
  Code,
  CheckCircle,
  Rocket,
  Filter,
  Activity,
  X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppStore } from '@/stores/use-app-store';
import { WORKFLOW_STAGES, STAGE_COLORS } from '@/lib/mock-data';
import type { WorkflowStage } from '@/lib/types';

// ============================================================
// Stage Icon Map
// ============================================================

const STAGE_ICON_MAP: Record<WorkflowStage, React.ElementType> = {
  intake: Inbox,
  requirement_analysis: Search,
  object_resolution: Database,
  schema_verification: ShieldCheck,
  design_decisions: Layers,
  sql_construction: Code,
  validation: CheckCircle,
  delivery: Rocket,
};

// ============================================================
// Animation Variants
// ============================================================

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.2 },
  },
};

// ============================================================
// Component
// ============================================================

export function ActivityView() {
  const { activity, selectJob } = useAppStore();

  // Local filter state
  const [stageFilter, setStageFilter] = useState<WorkflowStage | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Filtered activity
  const filteredActivity = useMemo(() => {
    let filtered = activity;

    if (stageFilter !== 'all') {
      filtered = filtered.filter((entry) => entry.stage === stageFilter);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(
        (entry) =>
          entry.action.toLowerCase().includes(query) ||
          entry.description.toLowerCase().includes(query) ||
          entry.jobTitle.toLowerCase().includes(query) ||
          entry.performedBy.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [activity, stageFilter, searchQuery]);

  // Handlers
  const handleJobClick = (jobId: string) => {
    selectJob(jobId);
  };

  const handleClearFilters = () => {
    setStageFilter('all');
    setSearchQuery('');
  };

  const hasActiveFilters = stageFilter !== 'all' || searchQuery.trim() !== '';

  return (
    <div className="flex flex-col gap-6">
      {/* ============================================================
          Header
          ============================================================ */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-gray-500" />
          <h1 className="text-xl font-bold tracking-tight text-gray-900 md:text-2xl">
            Activity Feed
          </h1>
          <Badge variant="secondary" className="text-xs">
            {filteredActivity.length}
            {filteredActivity.length !== activity.length
              ? ` of ${activity.length}`
              : ''}
          </Badge>
        </div>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={handleClearFilters} className="gap-1.5">
            <X className="h-3.5 w-3.5" />
            Clear filters
          </Button>
        )}
      </motion.div>

      {/* ============================================================
          Filter Row
          ============================================================ */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.05 }}
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
      >
        {/* All / Stage Filter */}
        <div className="flex items-center gap-2">
          <Button
            variant={stageFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStageFilter('all')}
          >
            All
          </Button>

          <Select
            value={stageFilter === 'all' ? '__all__' : stageFilter}
            onValueChange={(value) => setStageFilter(value === '__all__' ? 'all' : (value as WorkflowStage))}
          >
            <SelectTrigger size="sm" className="w-[180px] gap-1.5">
              <Filter className="h-3.5 w-3.5" />
              <SelectValue placeholder="By Stage" />
            </SelectTrigger>
            <SelectContent>
              {WORKFLOW_STAGES.map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: STAGE_COLORS[stage.id] }}
                    />
                    {stage.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Search */}
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search activity..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </motion.div>

      {/* ============================================================
          Activity List
          ============================================================ */}
      {filteredActivity.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <Card className="border-dashed">
            <CardContent className="flex items-center justify-center py-16">
              <div className="text-center">
                <Activity className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="text-sm font-medium text-gray-500">
                  {hasActiveFilters
                    ? 'No activity matches your filters.'
                    : 'No activity entries yet.'}
                </p>
                {hasActiveFilters && (
                  <Button
                    variant="link"
                    size="sm"
                    onClick={handleClearFilters}
                    className="mt-1"
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <ScrollArea className="h-[calc(100vh-260px)] min-h-[400px]">
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="flex flex-col gap-3 pr-4"
          >
            <AnimatePresence mode="popLayout">
              {filteredActivity.map((entry) => {
                const stageColor = STAGE_COLORS[entry.stage];
                const StageIcon = STAGE_ICON_MAP[entry.stage];
                const stageLabel =
                  WORKFLOW_STAGES.find((s) => s.id === entry.stage)?.label ?? entry.stage;

                return (
                  <motion.div
                    key={entry.id}
                    variants={itemVariants}
                    layout
                    exit="exit"
                  >
                    <Card
                      className="gap-0 border-l-4 py-0 transition-shadow hover:shadow-md"
                      style={{ borderLeftColor: stageColor }}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          {/* Left: Stage icon */}
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                            style={{ backgroundColor: `${stageColor}18` }}
                          >
                            <StageIcon
                              className="h-4 w-4"
                              style={{ color: stageColor }}
                            />
                          </div>

                          {/* Center: Content */}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-gray-900">{entry.action}</p>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              {entry.description}
                            </p>

                            {/* Job link */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleJobClick(entry.jobId);
                              }}
                              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
                            >
                              {entry.jobTitle}
                            </button>

                            {/* Performed by */}
                            <div className="mt-1 flex items-center gap-2">
                              <span
                                className="inline-block h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: stageColor }}
                              />
                              <span className="text-xs text-muted-foreground">
                                {entry.performedBy}
                              </span>
                            </div>
                          </div>

                          {/* Right: Timestamp + Stage badge */}
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatDistanceToNow(new Date(entry.timestamp), {
                                addSuffix: true,
                              })}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[10px] font-semibold uppercase"
                              style={{
                                backgroundColor: `${stageColor}18`,
                                color: stageColor,
                                borderColor: `${stageColor}40`,
                              }}
                            >
                              {stageLabel}
                            </Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        </ScrollArea>
      )}
    </div>
  );
}
