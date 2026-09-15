'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJob } from './job-client';
import type { JobRecord, JobStatus } from './types';

const POLL_INTERVAL_MS = 2000;
// A transient network blip should not kill a 60s generation job.
const MAX_CONSECUTIVE_ERRORS = 3;

interface UseJobOptions<TResult> {
  onDone?: (result: TResult) => void;
  onFailed?: (error: string) => void;
}

interface UseJobState<TResult> {
  /** Poll the given job until it settles. Replaces any job already tracked. */
  track: (jobId: string) => void;
  /** Stop polling and clear state. */
  reset: () => void;
  jobId: string | null;
  status: JobStatus | null;
  result: TResult | null;
  error: string | null;
  /** True while a tracked job is queued or running. */
  active: boolean;
}

export function useJob<TResult = unknown>(
  options: UseJobOptions<TResult> = {},
): UseJobState<TResult> {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [result, setResult] = useState<TResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Callbacks live in a ref so a caller passing inline arrows does not restart
  // the polling effect on every render. Synced in an effect rather than during
  // render, and declared before the polling effect so it lands first on mount.
  const callbacksRef = useRef(options);
  useEffect(() => {
    callbacksRef.current = options;
  });

  const track = useCallback((next: string) => {
    setJobId(next);
    setStatus('pending');
    setResult(null);
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setJobId(null);
    setStatus(null);
    setResult(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let errorCount = 0;

    const settleFailed = (message: string) => {
      if (cancelled) return;
      setStatus('failed');
      setError(message);
      callbacksRef.current.onFailed?.(message);
    };

    const poll = async () => {
      let record: JobRecord<TResult>;
      try {
        record = await fetchJob<TResult>(jobId);
        errorCount = 0;
      } catch (pollError) {
        errorCount += 1;
        if (errorCount >= MAX_CONSECUTIVE_ERRORS) {
          settleFailed(
            pollError instanceof Error ? pollError.message : '任务状态查询失败',
          );
          return;
        }
        timer = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      if (cancelled) return;
      setStatus(record.status);

      if (record.status === 'done') {
        setResult(record.result);
        if (record.result !== null) {
          callbacksRef.current.onDone?.(record.result);
        }
        return;
      }
      if (record.status === 'failed') {
        settleFailed(record.error || '任务执行失败');
        return;
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  return {
    track,
    reset,
    jobId,
    status,
    result,
    error,
    active: status === 'pending' || status === 'running',
  };
}
