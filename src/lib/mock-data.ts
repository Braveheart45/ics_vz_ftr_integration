import type {
  WorkflowStage,
  PipelineStats,
  SqlJob,
  ActivityEntry,
} from './types';

// ============================================================
// Workflow Stages
// ============================================================

export const WORKFLOW_STAGES: {
  id: WorkflowStage;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    id: 'intake',
    label: 'Intake',
    description: 'Receive and register incoming request from Jira, STM, or legacy SQL upload.',
    icon: 'Inbox',
  },
  {
    id: 'requirement_analysis',
    label: 'Requirement Analysis',
    description: 'Parse and extract structured requirements from the input source.',
    icon: 'Search',
  },
  {
    id: 'object_resolution',
    label: 'Object Resolution',
    description: 'Identify and resolve referenced schema objects, tables, and views.',
    icon: 'GitMerge',
  },
  {
    id: 'schema_verification',
    label: 'Schema Verification',
    description: 'Verify the existence and structure of all referenced schema objects.',
    icon: 'ShieldCheck',
  },
  {
    id: 'design_decisions',
    label: 'Design Decisions',
    description: 'Present design choices to the team for review and approval.',
    icon: 'MessageSquare',
  },
  {
    id: 'sql_construction',
    label: 'SQL Construction',
    description: 'Generate BigQuery-compatible SQL based on approved requirements and decisions.',
    icon: 'Code',
  },
  {
    id: 'validation',
    label: 'Validation',
    description: 'Run dry-run, syntax validation, and data quality checks on generated SQL.',
    icon: 'CheckCircle',
  },
  {
    id: 'delivery',
    label: 'Delivery',
    description: 'Package and deliver approved SQL artifacts to the target environment.',
    icon: 'Package',
  },
];

// ============================================================
// Stage Colors
// ============================================================

export const STAGE_COLORS: Record<WorkflowStage, string> = {
  intake: '#6b7280',               // gray
  requirement_analysis: '#8b5cf6', // violet
  object_resolution: '#06b6d4',    // cyan
  schema_verification: '#14b8a6',  // teal
  design_decisions: '#f59e0b',     // amber
  sql_construction: '#3b82f6',     // blue
  validation: '#ec4899',           // pink
  delivery: '#22c55e',             // green
};

// ============================================================
// Pipeline Stats
// ============================================================

export const mockPipelineStats: PipelineStats = {
  totalJobs: 47,
  intake: 6,
  analyzing: 5,
  generating: 8,
  validating: 7,
  approved: 12,
  deployed: 18,
  needsReview: 4,
  needsApproval: 3,
  failed: 2,
};

// ============================================================
// Mock Jobs
// ============================================================

export const mockJobs: SqlJob[] = [
  // ── Job 1: Intake stage from Jira ──────────────────────────
  {
    id: 'job-001',
    title: 'Customer Churn Fact Table — BigQuery Migration',
    description:
      'Migrate the existing customer churn fact table from on-prem PostgreSQL to BigQuery. Requires incremental loading and partitioning by snapshot_date.',
    inputSource: {
      type: 'jira',
      reference: 'DE-2847',
      summary: 'Migrate churn_fact table to BigQuery with incremental logic',
      attachments: ['churn_fact_ddl_pg.sql', 'er_diagram_v3.png'],
      uploadedAt: '2025-06-14T09:15:00Z',
    },
    currentStage: 'intake',
    status: 'in_progress',
    requirements: [],
    schemaObjects: [],
    designDecisions: [],
    sqlArtifacts: [],
    progress: 5,
    priority: 'high',
    assignee: 'Sarah Chen',
    createdAt: '2025-06-14T09:15:00Z',
    updatedAt: '2025-06-14T09:20:00Z',
  },

  // ── Job 2: Intake stage from legacy SQL ────────────────────
  {
    id: 'job-002',
    title: 'Legacy ETL — Order Aggregation Pipeline',
    description:
      'Convert a complex legacy T-SQL stored procedure for order aggregation into BigQuery SQL. The source proc spans 340 lines and uses temp tables extensively.',
    inputSource: {
      type: 'legacy_sql',
      reference: 'sp_aggregate_orders_v2.sql',
      summary: 'Convert T-SQL stored procedure for order aggregation to BigQuery',
      attachments: ['sp_aggregate_orders_v2.sql'],
      uploadedAt: '2025-06-13T16:42:00Z',
    },
    currentStage: 'intake',
    status: 'in_progress',
    requirements: [],
    schemaObjects: [],
    designDecisions: [],
    sqlArtifacts: [],
    progress: 2,
    priority: 'medium',
    assignee: 'Marcus Rivera',
    createdAt: '2025-06-13T16:42:00Z',
    updatedAt: '2025-06-13T16:45:00Z',
  },

  // ── Job 3: Requirement Analysis from STM ───────────────────
  {
    id: 'job-003',
    title: 'Revenue Recognition — Daily Summary View',
    description:
      'Build a daily revenue summary view from the revenue_events_raw staging table, joining with dim_account and dim_product to produce the reporting aggregate.',
    inputSource: {
      type: 'stm',
      reference: 'STM-2025-0612-revenue_daily',
      summary: 'Create daily revenue summary view from raw events with account and product dimensions',
      attachments: ['revenue_events_schema.json'],
      uploadedAt: '2025-06-12T11:30:00Z',
    },
    currentStage: 'requirement_analysis',
    status: 'in_progress',
    requirements: [
      {
        id: 'req-301',
        description:
          'Aggregate revenue_events_raw by event_date, account_id, and product_category',
        sourceTable: 'analytics_staging.revenue_events_raw',
        targetTable: 'analytics_mart.fct_revenue_daily',
        transformation: 'GROUP BY with SUM(amount_usd) and COUNT(DISTINCT event_id)',
        complexity: 'medium',
        status: 'confirmed',
      },
      {
        id: 'req-302',
        description:
          'Join dim_account to capture account_segment and region fields',
        sourceTable: 'analytics_mart.dim_account',
        targetTable: 'analytics_mart.fct_revenue_daily',
        transformation: 'LEFT JOIN on account_id',
        complexity: 'low',
        status: 'confirmed',
      },
      {
        id: 'req-303',
        description:
          'Add trailing 7-day and 30-day revenue rolling averages per account',
        sourceTable: 'analytics_mart.fct_revenue_daily',
        targetTable: 'analytics_mart.fct_revenue_daily',
        transformation: 'Window function AVG with ROWS BETWEEN',
        complexity: 'high',
        status: 'ambiguous',
        ambiguityNotes:
          'Requirement mentions "rolling" but does not specify whether to use calendar days or business days. Also unclear if the rolling window should include partial data for the current date.',
      },
    ],
    schemaObjects: [
      {
        name: 'revenue_events_raw',
        type: 'staging_table',
        database: 'analytics_staging',
        schema: 'analytics_staging',
        columnCount: 14,
        status: 'unverified',
      },
      {
        name: 'dim_account',
        type: 'dimension',
        database: 'analytics_mart',
        schema: 'analytics_mart',
        columnCount: 22,
        status: 'unverified',
      } as any,
      {
        name: 'dim_product',
        type: 'dimension',
        database: 'analytics_mart',
        schema: 'analytics_mart',
        columnCount: 18,
        status: 'unverified',
      } as any,
    ],
    designDecisions: [],
    sqlArtifacts: [],
    progress: 18,
    priority: 'high',
    assignee: 'Priya Patel',
    createdAt: '2025-06-12T11:30:00Z',
    updatedAt: '2025-06-14T10:05:00Z',
  },

  // ── Job 4: Schema Verification ─────────────────────────────
  {
    id: 'job-004',
    title: 'User Engagement Metrics — Mart Table Build',
    description:
      'Create the fct_user_engagement table in analytics_mart from event_stream and user_profile sources. Includes daily active users, session duration, and feature adoption metrics.',
    inputSource: {
      type: 'jira',
      reference: 'DE-2819',
      summary: 'Build user engagement mart table from event stream data',
      attachments: ['engagement_spec_v2.docx', 'event_stream_sample.csv'],
      uploadedAt: '2025-06-10T14:20:00Z',
    },
    currentStage: 'schema_verification',
    status: 'in_progress',
    requirements: [
      {
        id: 'req-401',
        description: 'Calculate daily active users (DAU) from event_stream',
        sourceTable: 'raw_events.event_stream',
        targetTable: 'analytics_mart.fct_user_engagement',
        transformation: 'COUNT(DISTINCT user_id) grouped by event_date',
        complexity: 'low',
        status: 'confirmed',
      },
      {
        id: 'req-402',
        description:
          'Compute average session duration per user per day',
        sourceTable: 'raw_events.event_stream',
        targetTable: 'analytics_mart.fct_user_engagement',
        transformation:
          'Sessionization via TIMESTAMP_DIFF between first and last event per session',
        complexity: 'high',
        status: 'confirmed',
      },
      {
        id: 'req-403',
        description: 'Track feature adoption flag per user per feature per day',
        sourceTable: 'raw_events.event_stream',
        targetTable: 'analytics_mart.fct_user_engagement',
        transformation:
          'PIVOT on feature_name to boolean flags per event_date/user_id',
        complexity: 'high',
        status: 'confirmed',
      },
    ],
    schemaObjects: [
      {
        name: 'event_stream',
        type: 'table',
        database: 'raw_events',
        schema: 'raw_events',
        columnCount: 19,
        status: 'verified',
        lastVerified: '2025-06-12T08:30:00Z',
      },
      {
        name: 'user_profile',
        type: 'table',
        database: 'raw_events',
        schema: 'raw_events',
        columnCount: 31,
        status: 'verified',
        lastVerified: '2025-06-12T08:32:00Z',
      },
      {
        name: 'fct_user_engagement',
        type: 'table',
        database: 'analytics_mart',
        schema: 'analytics_mart',
        columnCount: 0,
        status: 'not_found',
      },
    ],
    designDecisions: [],
    sqlArtifacts: [],
    progress: 35,
    priority: 'medium',
    assignee: 'James Okafor',
    createdAt: '2025-06-10T14:20:00Z',
    updatedAt: '2025-06-13T15:45:00Z',
  },

  // ── Job 5: Design Decisions — Pending ──────────────────────
  {
    id: 'job-005',
    title: 'Inventory Snapshot — Partitioned Staging Table',
    description:
      'Create a partitioned staging table for daily inventory snapshots sourced from the ERP system, supporting backfill from 2023-01-01.',
    inputSource: {
      type: 'stm',
      reference: 'STM-2025-0608-inventory_snap',
      summary:
        'Partitioned staging table for daily inventory snapshots from ERP feed',
      attachments: ['erp_inventory_mapping.xlsx', 'sample_erp_data.csv'],
      uploadedAt: '2025-06-08T09:00:00Z',
    },
    currentStage: 'design_decisions',
    status: 'needs_review',
    requirements: [
      {
        id: 'req-501',
        description: 'Load daily full snapshots from ERP inventory extract',
        sourceTable: 'erp_feed.inventory_extract',
        targetTable: 'analytics_staging.stg_inventory_snapshot',
        transformation: 'Direct load with type casting and NULL handling',
        complexity: 'medium',
        status: 'confirmed',
      },
      {
        id: 'req-502',
        description: 'Partition by snapshot_date for cost-efficient querying',
        sourceTable: 'analytics_staging.stg_inventory_snapshot',
        targetTable: 'analytics_staging.stg_inventory_snapshot',
        transformation: 'PARTITION BY snapshot_date with 3-year clustering',
        complexity: 'medium',
        status: 'confirmed',
      },
    ],
    schemaObjects: [
      {
        name: 'inventory_extract',
        type: 'staging_table',
        database: 'erp_feed',
        schema: 'erp_feed',
        columnCount: 42,
        status: 'verified',
        lastVerified: '2025-06-11T10:15:00Z',
      },
      {
        name: 'stg_inventory_snapshot',
        type: 'staging_table',
        database: 'analytics_staging',
        schema: 'analytics_staging',
        columnCount: 0,
        status: 'not_found',
      },
    ],
    designDecisions: [
      {
        id: 'dd-501',
        title: 'Partitioning Strategy',
        description:
          'Choose how to partition the staging table for optimal query performance and cost.',
        options: [
          {
            label: 'Daily partitioning by snapshot_date',
            description:
              'One partition per day. Best for point-in-time queries. Moderate partition count over 3 years (~1,095 partitions).',
            recommended: true,
          },
          {
            label: 'Monthly partitioning by DATE_TRUNC(snapshot_date, MONTH)',
            description:
              'One partition per month. Fewer partitions but larger scan size per query. Good for aggregated monthly reports.',
            recommended: false,
          },
        ],
        status: 'pending',
      },
      {
        id: 'dd-502',
        title: 'Clustering Columns',
        description:
          'Select clustering columns to optimize common query patterns on the staging table.',
        options: [
          {
            label: 'warehouse_id, product_sku',
            description:
              'Optimizes queries filtering by warehouse and product. Covers 78% of historical query patterns.',
            recommended: true,
          },
          {
            label: 'product_sku, warehouse_id',
            description:
              'Optimizes product-centric queries first. Slightly less aligned with current dashboard patterns.',
            recommended: false,
          },
          {
            label: 'No clustering',
            description:
              'Skip clustering to reduce write costs. May increase query costs for filtered reads.',
            recommended: false,
          },
        ],
        status: 'pending',
      },
    ],
    sqlArtifacts: [],
    progress: 52,
    priority: 'high',
    assignee: 'Sarah Chen',
    createdAt: '2025-06-08T09:00:00Z',
    updatedAt: '2025-06-13T11:20:00Z',
  },

  // ── Job 6: SQL Construction — Draft SQL ────────────────────
  {
    id: 'job-006',
    title: 'Marketing Attribution — Channel ROI View',
    description:
      'Build a marketing attribution view that calculates ROI by channel using clickstream and order data, supporting first-touch and last-touch models.',
    inputSource: {
      type: 'jira',
      reference: 'DE-2791',
      summary:
        'Marketing channel ROI view with first-touch and last-touch attribution models',
      attachments: ['attribution_spec_final.pdf', 'clickstream_schema.json'],
      uploadedAt: '2025-06-05T10:00:00Z',
    },
    currentStage: 'sql_construction',
    status: 'in_progress',
    requirements: [
      {
        id: 'req-601',
        description:
          'Implement first-touch attribution using the first click channel per user session',
        sourceTable: 'raw_events.clickstream',
        targetTable: 'analytics_mart.vw_marketing_attribution',
        transformation:
          'FIRST_VALUE(channel) OVER (PARTITION BY session_id ORDER BY event_ts) as first_touch_channel',
        complexity: 'high',
        status: 'confirmed',
      },
      {
        id: 'req-602',
        description:
          'Join orders to attribute revenue to marketing channels',
        sourceTable: 'analytics_staging.stg_orders',
        targetTable: 'analytics_mart.vw_marketing_attribution',
        transformation: 'JOIN on user_id with session-to-order matching via timestamp window',
        complexity: 'high',
        status: 'confirmed',
      },
    ],
    schemaObjects: [
      {
        name: 'clickstream',
        type: 'table',
        database: 'raw_events',
        schema: 'raw_events',
        columnCount: 24,
        status: 'verified',
        lastVerified: '2025-06-08T14:00:00Z',
      },
      {
        name: 'stg_orders',
        type: 'staging_table',
        database: 'analytics_staging',
        schema: 'analytics_staging',
        columnCount: 18,
        status: 'verified',
        lastVerified: '2025-06-08T14:05:00Z',
      },
    ],
    designDecisions: [
      {
        id: 'dd-601',
        title: 'Attribution Window',
        description: 'Define the lookback window for attributing orders to marketing sessions.',
        options: [
          {
            label: '7-day window',
            description: 'Attribute orders within 7 days of the last session touchpoint.',
            recommended: false,
          },
          {
            label: '14-day window',
            description: 'Standard industry window. Captures most assisted conversions.',
            recommended: true,
          },
          {
            label: '30-day window',
            description: 'Broad window. May over-attribute and inflate channel credit.',
            recommended: false,
          },
        ],
        selectedOption: '14-day window',
        status: 'approved',
        decidedBy: 'Lisa Park',
        decidedAt: '2025-06-10T09:30:00Z',
      },
    ],
    sqlArtifacts: [
      {
        id: 'sql-601',
        name: 'vw_marketing_attribution',
        sql: `-- Marketing Attribution View (First-Touch & Last-Touch)
-- Jira: DE-2791 | Author: SQL Agent | Status: DRAFT

CREATE OR REPLACE VIEW \`analytics_mart.vw_marketing_attribution\` AS
WITH session_attribution AS (
  SELECT
    session_id,
    user_id,
    MIN(event_date) AS session_date,
    FIRST_VALUE(channel) OVER (
      PARTITION BY session_id ORDER BY event_ts
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS first_touch_channel,
    LAST_VALUE(channel) OVER (
      PARTITION BY session_id ORDER BY event_ts
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS last_touch_channel,
    COUNT(*) AS session_events
  FROM \`raw_events.clickstream\`
  WHERE event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
  GROUP BY session_id, user_id
),
order_attribution AS (
  SELECT
    o.order_id,
    o.user_id,
    o.order_date,
    o.revenue_usd,
    o.order_count,
    sa.first_touch_channel,
    sa.last_touch_channel
  FROM \`analytics_staging.stg_orders\` o
  INNER JOIN session_attribution sa
    ON o.user_id = sa.user_id
    AND o.order_date BETWEEN sa.session_date
      AND DATE_ADD(sa.session_date, INTERVAL 14 DAY)
)
SELECT
  DATE_TRUNC(order_date, MONTH) AS attribution_month,
  first_touch_channel,
  last_touch_channel,
  COUNT(DISTINCT order_id) AS attributed_orders,
  SUM(revenue_usd) AS attributed_revenue,
  AVG(revenue_usd) AS avg_order_value,
  SAFE_DIVIDE(SUM(revenue_usd), NULLIF(SUM(o.order_count), 0)) AS revenue_per_item
FROM order_attribution o
GROUP BY 1, 2, 3
ORDER BY attribution_month DESC, attributed_revenue DESC;`,
        type: 'production',
        targetPlatform: 'bigquery',
        status: 'draft',
        createdAt: '2025-06-12T16:00:00Z',
        updatedAt: '2025-06-14T08:30:00Z',
      },
    ],
    progress: 70,
    priority: 'critical',
    assignee: 'Marcus Rivera',
    createdAt: '2025-06-05T10:00:00Z',
    updatedAt: '2025-06-14T08:30:00Z',
  },

  // ── Job 7: Validation — With results ───────────────────────
  {
    id: 'job-007',
    title: 'Product Catalog — Slowly Changing Dimension',
    description:
      'Build a Type 2 SCD for the product catalog dimension table, tracking price changes and category reclassifications with effective date ranges.',
    inputSource: {
      type: 'jira',
      reference: 'DE-2756',
      summary:
        'Type 2 SCD for product catalog tracking price and category changes',
      attachments: ['product_scd_design.md'],
      uploadedAt: '2025-06-02T08:45:00Z',
    },
    currentStage: 'validation',
    status: 'needs_approval',
    requirements: [
      {
        id: 'req-701',
        description: 'Track product price history with effective date ranges',
        sourceTable: 'analytics_staging.stg_product_catalog',
        targetTable: 'analytics_mart.dim_product_scd2',
        transformation:
          'Type 2 SCD with is_current flag, effective_from/effective_to, and surrogate key',
        complexity: 'high',
        status: 'confirmed',
      },
    ],
    schemaObjects: [
      {
        name: 'stg_product_catalog',
        type: 'staging_table',
        database: 'analytics_staging',
        schema: 'analytics_staging',
        columnCount: 27,
        status: 'verified',
        lastVerified: '2025-06-06T11:00:00Z',
      },
      {
        name: 'dim_product_scd2',
        type: 'table',
        database: 'analytics_mart',
        schema: 'analytics_mart',
        columnCount: 0,
        status: 'verified',
        lastVerified: '2025-06-10T09:00:00Z',
      },
    ],
    designDecisions: [
      {
        id: 'dd-701',
        title: 'Surrogate Key Strategy',
        description: 'Choose the surrogate key generation method for the SCD Type 2 table.',
        options: [
          {
            label: 'GENERATE_UUID()',
            description:
              'Standard BigQuery UUID. Simple, no collisions, but opaque and not sortable.',
            recommended: false,
          },
          {
            label: 'MD5 hash of natural key + effective_from',
            description:
              'Deterministic key generation. Supports idempotent re-runs. Recommended for SCD2.',
            recommended: true,
          },
        ],
        selectedOption: 'MD5 hash of natural key + effective_from',
        status: 'approved',
        decidedBy: 'James Okafor',
        decidedAt: '2025-06-08T14:20:00Z',
      },
    ],
    sqlArtifacts: [
      {
        id: 'sql-701',
        name: 'dim_product_scd2_ddl',
        sql: `-- Product Catalog SCD Type 2 — DDL
-- Jira: DE-2756 | Author: SQL Agent

CREATE OR REPLACE TABLE \`analytics_mart.dim_product_scd2\` (
  product_sk STRING NOT NULL OPTIONS(description='MD5(product_id || effective_from)'),
  product_id STRING NOT NULL,
  product_name STRING NOT NULL,
  category STRING,
  subcategory STRING,
  brand STRING,
  base_price_usd FLOAT64,
  currency STRING DEFAULT 'USD',
  is_active BOOL DEFAULT TRUE,
  effective_from DATE NOT NULL,
  effective_to DATE,
  is_current BOOL DEFAULT TRUE,
  row_hash STRING OPTIONS(description='MD5 of all tracked columns for change detection'),
  loaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE_TRUNC(effective_from, MONTH)
CLUSTER BY product_id, is_current
OPTIONS(
  description='Type 2 SCD for product catalog — tracks price and category changes',
  partition_expiration_days=NULL,
  require_partition_filter=FALSE
);`,
        type: 'ddl',
        targetPlatform: 'bigquery',
        status: 'approved',
        dryRunResult: {
          success: true,
          bytesProcessed: 0,
          slotsUsed: 0,
        },
        createdAt: '2025-06-09T10:00:00Z',
        updatedAt: '2025-06-11T16:30:00Z',
      },
      {
        id: 'sql-702',
        name: 'dim_product_scd2_merge',
        sql: `-- Product Catalog SCD Type 2 — MERGE Statement
-- Jira: DE-2756 | Author: SQL Agent

MERGE \`analytics_mart.dim_product_scd2\` AS target
USING (
  SELECT
    product_id,
    product_name,
    category,
    subcategory,
    brand,
    base_price_usd,
    currency,
    is_active,
    TO_BASE64(MD5(CONCAT(
      COALESCE(CAST(product_name AS STRING), ''),
      '|', COALESCE(CAST(category AS STRING), ''),
      '|', COALESCE(CAST(subcategory AS STRING), ''),
      '|', COALESCE(CAST(brand AS STRING), ''),
      '|', COALESCE(CAST(base_price_usd AS STRING), ''),
      '|', COALESCE(CAST(currency AS STRING), ''),
      '|', COALESCE(CAST(is_active AS STRING), '')
    ))) AS new_row_hash,
    CURRENT_DATE() AS effective_from
  FROM \`analytics_staging.stg_product_catalog\`
  WHERE _loaded_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
) AS source
ON target.product_id = source.product_id
  AND target.is_current = TRUE
WHEN MATCHED AND target.row_hash != source.new_row_hash THEN
  UPDATE SET
    effective_to = source.effective_from,
    is_current = FALSE
WHEN NOT MATCHED THEN
  INSERT (product_sk, product_id, product_name, category, subcategory,
          brand, base_price_usd, currency, is_active, effective_from,
          effective_to, is_current, row_hash, loaded_at)
  VALUES (
    TO_HEX(MD5(CONCAT(source.product_id, CAST(source.effective_from AS STRING)))),
    source.product_id, source.product_name, source.category, source.subcategory,
    source.brand, source.base_price_usd, source.currency, source.is_active,
    source.effective_from, NULL, TRUE, source.new_row_hash, CURRENT_TIMESTAMP()
  );`,
        type: 'dml',
        targetPlatform: 'bigquery',
        status: 'review',
        dryRunResult: {
          success: true,
          bytesProcessed: 214_500_000,
          slotsUsed: 42,
          warnings: [
            'This statement will modify 1 table. Consider running in a transaction.',
          ],
        },
        validationResult: {
          valid: true,
          errors: [],
          warnings: [
            {
              code: 'BQ-COST-001',
              message:
                'MERGE scans the full target table. Estimated cost: ~$0.12 per run.',
              severity: 'warning',
              suggestion:
                'Consider adding a _PARTITIONTIME filter on effective_from to limit scan scope.',
            },
            {
              code: 'BQ-IDEAL-001',
              message:
                'No LIMIT clause found on source subquery.',
              severity: 'info',
              suggestion:
                'The _loaded_at filter bounds the source. Verify it matches your CDC watermark.',
            },
          ],
          dqFindings: [
            {
              id: 'dq-701',
              type: 'data_quality',
              severity: 'medium',
              description:
                '12% of product_name values in stg_product_catalog contain leading/trailing whitespace.',
              affectedObject: 'analytics_staging.stg_product_catalog.product_name',
              recommendation:
                'Add TRIM(product_name) in the source subquery before computing row_hash.',
            },
          ],
        },
        createdAt: '2025-06-10T14:00:00Z',
        updatedAt: '2025-06-13T17:00:00Z',
      },
    ],
    progress: 88,
    priority: 'high',
    assignee: 'James Okafor',
    createdAt: '2025-06-02T08:45:00Z',
    updatedAt: '2025-06-13T17:00:00Z',
  },

  // ── Job 8: Completed / Delivery ────────────────────────────
  {
    id: 'job-008',
    title: 'Fraud Detection — Transaction Scoring Pipeline',
    description:
      'Build a materialized view that scores transactions for fraud risk using rule-based heuristics and joins to known-bad actor lists.',
    inputSource: {
      type: 'jira',
      reference: 'DE-2701',
      summary:
        'Transaction fraud scoring pipeline with rule-based risk assessment',
      attachments: ['fraud_rules_v4.xlsx', 'bad_actors_list.csv'],
      uploadedAt: '2025-05-28T13:00:00Z',
    },
    currentStage: 'delivery',
    status: 'completed',
    requirements: [
      {
        id: 'req-801',
        description: 'Score each transaction with a fraud risk score (0–100)',
        sourceTable: 'analytics_staging.stg_transactions',
        targetTable: 'analytics_mart.fct_transaction_fraud_score',
        transformation:
          'Rule engine: velocity checks, amount anomalies, geo-mismatch, bad-actor match',
        complexity: 'high',
        status: 'confirmed',
      },
      {
        id: 'req-802',
        description: 'Join against known bad actor list for instant flagging',
        sourceTable: 'security_ref.known_bad_actors',
        targetTable: 'analytics_mart.fct_transaction_fraud_score',
        transformation: 'LEFT JOIN on user_id and email_hash',
        complexity: 'low',
        status: 'confirmed',
      },
    ],
    schemaObjects: [
      {
        name: 'stg_transactions',
        type: 'staging_table',
        database: 'analytics_staging',
        schema: 'analytics_staging',
        columnCount: 35,
        status: 'verified',
        lastVerified: '2025-06-01T10:00:00Z',
      },
      {
        name: 'known_bad_actors',
        type: 'table',
        database: 'security_ref',
        schema: 'security_ref',
        columnCount: 8,
        status: 'verified',
        lastVerified: '2025-06-01T10:05:00Z',
      },
      {
        name: 'fct_transaction_fraud_score',
        type: 'table',
        database: 'analytics_mart',
        schema: 'analytics_mart',
        columnCount: 12,
        status: 'verified',
        lastVerified: '2025-06-11T14:00:00Z',
      },
    ],
    designDecisions: [
      {
        id: 'dd-801',
        title: 'Score Calculation Method',
        description: 'Select how individual fraud signals are combined into an overall risk score.',
        options: [
          {
            label: 'Weighted sum of rule scores',
            description:
              'Each rule contributes a weighted score. Final score is capped at 100.',
            recommended: true,
          },
          {
            label: 'Maximum rule score',
            description:
              'The highest individual rule score becomes the transaction score.',
            recommended: false,
          },
        ],
        selectedOption: 'Weighted sum of rule scores',
        status: 'approved',
        decidedBy: 'Lisa Park',
        decidedAt: '2025-06-02T11:00:00Z',
      },
    ],
    sqlArtifacts: [
      {
        id: 'sql-801',
        name: 'fct_transaction_fraud_score',
        sql: `-- Transaction Fraud Scoring — Production SQL
-- Jira: DE-2701 | Author: SQL Agent | Status: APPROVED

CREATE OR REPLACE TABLE \`analytics_mart.fct_transaction_fraud_score\` AS
WITH scored_transactions AS (
  SELECT
    t.transaction_id,
    t.user_id,
    t.transaction_ts,
    t.amount_usd,
    t.merchant_category,
    t.device_type,
    t.ip_country,
    t.billing_country,
    -- Rule 1: High amount (weight 25)
    CASE
      WHEN t.amount_usd > 5000 THEN 25
      WHEN t.amount_usd > 2000 THEN 15
      ELSE 0
    END AS amt_score,
    -- Rule 2: Geo mismatch (weight 30)
    CASE
      WHEN t.ip_country != t.billing_country AND t.billing_country IS NOT NULL THEN 30
      ELSE 0
    END AS geo_score,
    -- Rule 3: Velocity — >5 txns in 1 hour (weight 20)
    CASE
      WHEN (
        SELECT COUNT(*)
        FROM \`analytics_staging.stg_transactions\` t2
        WHERE t2.user_id = t.user_id
          AND t2.transaction_ts BETWEEN TIMESTAMP_SUB(t.transaction_ts, INTERVAL 1 HOUR)
              AND t.transaction_ts
      ) > 5 THEN 20
      ELSE 0
    END AS velocity_score,
    -- Rule 4: Known bad actor (weight 25)
    CASE
      WHEN b.user_id IS NOT NULL THEN 25
      ELSE 0
    END AS bad_actor_score,
    COALESCE(b.risk_level, 'unknown') AS bad_actor_risk
  FROM \`analytics_staging.stg_transactions\` t
  LEFT JOIN \`security_ref.known_bad_actors\` b
    ON t.user_id = b.user_id
  WHERE t.transaction_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
)
SELECT
  transaction_id,
  user_id,
  transaction_ts,
  amount_usd,
  merchant_category,
  device_type,
  ip_country,
  billing_country,
  LEAST(amt_score + geo_score + velocity_score + bad_actor_score, 100) AS fraud_risk_score,
  CASE
    WHEN LEAST(amt_score + geo_score + velocity_score + bad_actor_score, 100) >= 70 THEN 'high'
    WHEN LEAST(amt_score + geo_score + velocity_score + bad_actor_score, 100) >= 40 THEN 'medium'
    ELSE 'low'
  END AS risk_tier,
  bad_actor_risk,
  CURRENT_TIMESTAMP() AS scored_at
FROM scored_transactions
WHERE amt_score + geo_score + velocity_score + bad_actor_score > 0
ORDER BY fraud_risk_score DESC;`,
        type: 'production',
        targetPlatform: 'bigquery',
        status: 'approved',
        dryRunResult: {
          success: true,
          bytesProcessed: 1_820_000_000,
          slotsUsed: 128,
          warnings: [],
        },
        validationResult: {
          valid: true,
          errors: [],
          warnings: [
            {
              code: 'BQ-PERF-001',
              message:
                'Correlated subquery in velocity_score may cause performance issues at scale.',
              severity: 'warning',
              suggestion:
                'Consider pre-aggregating per-user transaction counts in a CTE before joining.',
            },
          ],
          dqFindings: [],
        },
        createdAt: '2025-06-04T11:00:00Z',
        updatedAt: '2025-06-11T14:00:00Z',
      },
    ],
    progress: 100,
    priority: 'critical',
    assignee: 'Priya Patel',
    createdAt: '2025-05-28T13:00:00Z',
    updatedAt: '2025-06-12T10:00:00Z',
    completedAt: '2025-06-12T10:00:00Z',
  },
];

// ============================================================
// Mock Activity Entries
// ============================================================

export const mockActivity: ActivityEntry[] = [
  {
    id: 'act-001',
    jobId: 'job-001',
    jobTitle: 'Customer Churn Fact Table — BigQuery Migration',
    action: 'Job created from Jira ticket',
    description: 'New job created from Jira DE-2847. Intake initiated.',
    stage: 'intake',
    performedBy: 'Sarah Chen',
    timestamp: '2025-06-14T09:15:00Z',
  },
  {
    id: 'act-002',
    jobId: 'job-007',
    jobTitle: 'Product Catalog — Slowly Changing Dimension',
    action: 'Validation completed',
    description:
      'SQL artifact dim_product_scd2_merge passed validation with 0 errors, 2 warnings, and 1 DQ finding.',
    stage: 'validation',
    performedBy: 'System',
    timestamp: '2025-06-13T17:00:00Z',
  },
  {
    id: 'act-003',
    jobId: 'job-005',
    jobTitle: 'Inventory Snapshot — Partitioned Staging Table',
    action: 'Design decisions pending review',
    description:
      '2 design decisions awaiting review: Partitioning Strategy and Clustering Columns.',
    stage: 'design_decisions',
    performedBy: 'System',
    timestamp: '2025-06-13T11:20:00Z',
  },
  {
    id: 'act-004',
    jobId: 'job-006',
    jobTitle: 'Marketing Attribution — Channel ROI View',
    action: 'SQL draft generated',
    description:
      'SQL Agent generated initial draft for vw_marketing_attribution with first-touch and last-touch models.',
    stage: 'sql_construction',
    performedBy: 'SQL Agent',
    timestamp: '2025-06-12T16:00:00Z',
  },
  {
    id: 'act-005',
    jobId: 'job-008',
    jobTitle: 'Fraud Detection — Transaction Scoring Pipeline',
    action: 'Job completed and delivered',
    description:
      'All SQL artifacts approved. fct_transaction_fraud_score deployed to analytics_mart.',
    stage: 'delivery',
    performedBy: 'Priya Patel',
    timestamp: '2025-06-12T10:00:00Z',
  },
  {
    id: 'act-006',
    jobId: 'job-003',
    jobTitle: 'Revenue Recognition — Daily Summary View',
    action: 'Ambiguity detected in requirement',
    description:
      'req-303 flagged as ambiguous: rolling average window (calendar vs business days) needs clarification.',
    stage: 'requirement_analysis',
    performedBy: 'SQL Agent',
    timestamp: '2025-06-14T10:05:00Z',
  },
  {
    id: 'act-007',
    jobId: 'job-004',
    jobTitle: 'User Engagement Metrics — Mart Table Build',
    action: 'Schema verification in progress',
    description:
      'Verified event_stream (19 cols) and user_profile (31 cols). fct_user_engagement does not exist yet — expected.',
    stage: 'schema_verification',
    performedBy: 'James Okafor',
    timestamp: '2025-06-13T15:45:00Z',
  },
  {
    id: 'act-008',
    jobId: 'job-007',
    jobTitle: 'Product Catalog — Slowly Changing Dimension',
    action: 'Design decision approved',
    description:
      'dd-701 "Surrogate Key Strategy" approved by James Okafor. Selected: MD5 hash of natural key + effective_from.',
    stage: 'design_decisions',
    performedBy: 'James Okafor',
    timestamp: '2025-06-08T14:20:00Z',
  },
  {
    id: 'act-009',
    jobId: 'job-002',
    jobTitle: 'Legacy ETL — Order Aggregation Pipeline',
    action: 'Legacy SQL uploaded',
    description:
      'Uploaded sp_aggregate_orders_v2.sql (340 lines, T-SQL). Conversion to BigQuery pending.',
    stage: 'intake',
    performedBy: 'Marcus Rivera',
    timestamp: '2025-06-13T16:42:00Z',
  },
  {
    id: 'act-010',
    jobId: 'job-008',
    jobTitle: 'Fraud Detection — Transaction Scoring Pipeline',
    action: 'Dry run succeeded',
    description:
      'fct_transaction_fraud_score dry run: 1.82 GB processed, 128 slots, 0 errors.',
    stage: 'validation',
    performedBy: 'System',
    timestamp: '2025-06-11T14:00:00Z',
  },
  {
    id: 'act-011',
    jobId: 'job-006',
    jobTitle: 'Marketing Attribution — Channel ROI View',
    action: 'Design decision approved',
    description:
      'dd-601 "Attribution Window" approved by Lisa Park. Selected: 14-day window.',
    stage: 'design_decisions',
    performedBy: 'Lisa Park',
    timestamp: '2025-06-10T09:30:00Z',
  },
  {
    id: 'act-012',
    jobId: 'job-003',
    jobTitle: 'Revenue Recognition — Daily Summary View',
    action: 'Job created from STM',
    description:
      'New job created from STM-2025-0612-revenue_daily. Requirement analysis initiated.',
    stage: 'intake',
    performedBy: 'Priya Patel',
    timestamp: '2025-06-12T11:30:00Z',
  },
];
