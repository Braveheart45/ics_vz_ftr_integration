'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Settings, Save, Bot, Workflow, Bell } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';

// ============================================================
// Animation Variants
// ============================================================

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: 'easeOut' },
  },
};

// ============================================================
// Component
// ============================================================

export function SettingsView() {
  // Agent Configuration
  const [agentName, setAgentName] = useState('SQLForge Agent');
  const [projectId, setProjectId] = useState('');
  const [defaultSchema, setDefaultSchema] = useState('');

  // Workflow Preferences
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [requireApproval, setRequireApproval] = useState(true);
  const [enableDryRun, setEnableDryRun] = useState(true);

  // Notifications
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [completionAlerts, setCompletionAlerts] = useState(true);
  const [errorAlerts, setErrorAlerts] = useState(true);

  const handleSave = () => {
    toast.success('Settings saved');
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ============================================================
          Header
          ============================================================ */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="flex items-center gap-3">
          <Settings className="h-5 w-5 text-gray-500" />
          <h1 className="text-xl font-bold tracking-tight text-gray-900 md:text-2xl">
            Settings
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure your SQL Agent preferences and workflow behavior.
        </p>
      </motion.div>

      {/* ============================================================
          Settings Cards
          ============================================================ */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="flex flex-col gap-6"
      >
        {/* ---- 1. Agent Configuration ---- */}
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-violet-500" />
                <CardTitle className="text-base">Agent Configuration</CardTitle>
              </div>
              <CardDescription>
                Configure the SQL Agent identity and BigQuery connection settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="agent-name">Agent Name</Label>
                  <Input
                    id="agent-name"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="SQLForge Agent"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="project-id">BigQuery Project ID</Label>
                  <Input
                    id="project-id"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    placeholder="my-project-id"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5 sm:max-w-sm">
                <Label htmlFor="default-schema">Default Schema</Label>
                <Input
                  id="default-schema"
                  value={defaultSchema}
                  onChange={(e) => setDefaultSchema(e.target.value)}
                  placeholder="analytics"
                />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ---- 2. Workflow Preferences ---- */}
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Workflow className="h-4 w-4 text-cyan-500" />
                <CardTitle className="text-base">Workflow Preferences</CardTitle>
              </div>
              <CardDescription>
                Control how jobs progress through the pipeline stages.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-0">
              {/* Auto-advance */}
              <div className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-advance" className="text-sm font-medium">
                    Auto-advance stages
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically move jobs to the next stage when current stage completes.
                  </p>
                </div>
                <Switch
                  id="auto-advance"
                  checked={autoAdvance}
                  onCheckedChange={setAutoAdvance}
                />
              </div>

              <Separator />

              {/* Require approval */}
              <div className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <Label htmlFor="require-approval" className="text-sm font-medium">
                    Require approval for SQL deployment
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Jobs must be manually approved before SQL is deployed to production.
                  </p>
                </div>
                <Switch
                  id="require-approval"
                  checked={requireApproval}
                  onCheckedChange={setRequireApproval}
                />
              </div>

              <Separator />

              {/* Enable dry-run */}
              <div className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <Label htmlFor="enable-dry-run" className="text-sm font-medium">
                    Enable dry-run before validation
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Run a BigQuery dry-run to estimate costs before full validation.
                  </p>
                </div>
                <Switch
                  id="enable-dry-run"
                  checked={enableDryRun}
                  onCheckedChange={setEnableDryRun}
                />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ---- 3. Notifications ---- */}
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-amber-500" />
                <CardTitle className="text-base">Notifications</CardTitle>
              </div>
              <CardDescription>
                Manage how and when you receive alerts about pipeline activity.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-0">
              {/* Email notifications */}
              <div className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <Label htmlFor="email-notifications" className="text-sm font-medium">
                    Email notifications
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Receive email updates for all pipeline events.
                  </p>
                </div>
                <Switch
                  id="email-notifications"
                  checked={emailNotifications}
                  onCheckedChange={setEmailNotifications}
                />
              </div>

              <Separator />

              {/* Job completion alerts */}
              <div className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <Label htmlFor="completion-alerts" className="text-sm font-medium">
                    Job completion alerts
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Get notified when a job reaches the delivery stage.
                  </p>
                </div>
                <Switch
                  id="completion-alerts"
                  checked={completionAlerts}
                  onCheckedChange={setCompletionAlerts}
                />
              </div>

              <Separator />

              {/* Error alerts */}
              <div className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <Label htmlFor="error-alerts" className="text-sm font-medium">
                    Error alerts
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Immediate notifications for validation errors and job failures.
                  </p>
                </div>
                <Switch
                  id="error-alerts"
                  checked={errorAlerts}
                  onCheckedChange={setErrorAlerts}
                />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ---- Save Button ---- */}
        <motion.div
          variants={itemVariants}
          className="flex justify-end"
        >
          <Button onClick={handleSave} className="gap-2">
            <Save className="h-4 w-4" />
            Save Settings
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}
