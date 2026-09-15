export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface JobAccepted {
  job_id: string;
  status: JobStatus;
}

export interface JobRecord<TResult = unknown> {
  job_id: string;
  type: string;
  status: JobStatus;
  meta: Record<string, unknown>;
  result: TResult | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
