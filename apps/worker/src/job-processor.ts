import type { JobExecutionSnapshot } from '@affiliate-content-os/domain';
import type { JobProcessorDependencies } from './job-processor-types.js';
import { processAnalysisJob } from './analysis-job-processor.js';
import { processWorkforcePlanningJob } from './workforce-job-processor.js';
import { processScriptwritingJob } from './scriptwriting-job-processor.js';

export type { JobProcessorDependencies };

export async function processJobExecution(
  job: JobExecutionSnapshot,
  deps: JobProcessorDependencies,
): Promise<void> {
  if (job.jobType === 'workforce_planning') {
    if (!deps.pool) {
      throw new Error(`Database pool required to process workforce_planning job ${job.id}`);
    }
    return processWorkforcePlanningJob(job, {
      workerId: deps.workerId,
      gatewayPort: deps.gatewayPort,
      pool: deps.pool,
    });
  }

  if (job.jobType === 'scriptwriting') {
    if (!deps.pool) {
      throw new Error(`Database pool required to process scriptwriting job ${job.id}`);
    }
    return processScriptwritingJob(job, {
      workerId: deps.workerId,
      gatewayPort: deps.gatewayPort,
      pool: deps.pool,
    });
  }

  return processAnalysisJob(job, deps);
}
