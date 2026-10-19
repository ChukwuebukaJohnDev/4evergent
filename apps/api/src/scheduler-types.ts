export interface SchedulerConfig {
  intervalMs?: number;
  clock?: () => Date;
}

export interface ExecutionContext {
  executedAt: string;
}
