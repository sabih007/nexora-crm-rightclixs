import { z } from 'zod';
import { CURRENCY_REGEX } from '@/lib/money';

/** Project and task input validation. */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** `YYYY-MM-DD` from a date input, or empty. */
const dateString = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use the date picker.')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

/** Decimal amount as a string — never parsed to a JS float. */
const decimalString = z
  .string()
  .trim()
  .regex(/^(\d+(\.\d{1,4})?)?$/, 'Enter a valid amount.')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

export const PROJECT_STATUSES = [
  'PLANNING',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
] as const;
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED'] as const;

export const projectInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Project name is required.').max(200),
    code: optionalText(40),
    clientId: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional()
      .refine((v) => v === null || v === undefined || z.uuid().safeParse(v).success, {
        message: 'Select a valid client.',
      }),
    description: optionalText(5000),
    ownerId: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional()
      .refine((v) => v === null || v === undefined || z.uuid().safeParse(v).success, {
        message: 'Select a valid owner.',
      }),
    status: z.enum(PROJECT_STATUSES).default('PLANNING'),
    priority: z.enum(PRIORITIES).default('MEDIUM'),
    budgetAmount: decimalString,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(CURRENCY_REGEX, 'Use a 3-letter ISO currency code.'),
    startDate: dateString,
    dueDate: dateString,
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    memberIds: z.array(z.uuid()).max(100).default([]),
  })
  .refine((v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate, {
    message: 'The due date cannot be before the start date.',
    path: ['dueDate'],
  });

export type ProjectInput = z.output<typeof projectInputSchema>;
export type ProjectFormValues = z.input<typeof projectInputSchema>;

export const updateProjectSchema = z.object({
  id: z.uuid(),
  data: projectInputSchema,
});

export const projectIdSchema = z.object({ id: z.uuid() });

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const checklistItemSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().trim().min(1).max(300),
  done: z.boolean().default(false),
});

export const taskInputSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, 'Task title is required.').max(300),
  description: optionalText(5000),
  assigneeId: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || z.uuid().safeParse(v).success, {
      message: 'Select a valid assignee.',
    }),
  status: z.enum(TASK_STATUSES).default('TODO'),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  dueDate: dateString,
  checklist: z.array(checklistItemSchema).max(50).default([]),
});

export type TaskInput = z.output<typeof taskInputSchema>;
export type TaskFormValues = z.input<typeof taskInputSchema>;

export const updateTaskSchema = z.object({
  id: z.uuid(),
  data: taskInputSchema.partial().omit({ projectId: true }),
});

export const moveTaskSchema = z.object({
  id: z.uuid(),
  status: z.enum(TASK_STATUSES),
  /** Ids of the tasks immediately before and after the drop position. */
  beforeTaskId: z.uuid().nullable().optional(),
  afterTaskId: z.uuid().nullable().optional(),
});

export const taskIdSchema = z.object({ id: z.uuid() });

export const taskCommentSchema = z.object({
  taskId: z.uuid(),
  body: z.string().trim().min(1, 'Write a comment.').max(5000),
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const PROJECT_SORT_KEYS = ['name', 'dueDate', 'status', 'priority', 'createdAt'] as const;
export type ProjectSortKey = (typeof PROJECT_SORT_KEYS)[number];

export const projectFilterSchema = z.object({
  search: z.string().trim().max(120).default(''),
  status: z.array(z.enum(PROJECT_STATUSES)).default([]),
  priority: z.array(z.enum(PRIORITIES)).default([]),
  clientId: z.string().trim().default(''),
  ownerId: z.string().trim().default(''),
  includeArchived: z.boolean().default(false),
});

export type ProjectFilters = z.infer<typeof projectFilterSchema>;
