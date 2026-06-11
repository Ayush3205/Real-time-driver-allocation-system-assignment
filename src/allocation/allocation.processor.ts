import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ALLOCATION_ATTEMPT_JOB, ALLOCATION_QUEUE } from './allocation.constants';
import { AllocationService } from './allocation.service';

type AllocationAttemptJob = {
  rideId: string;
  attempt: number;
};

@Processor(ALLOCATION_QUEUE)
export class AllocationProcessor extends WorkerHost {
  constructor(private readonly allocationService: AllocationService) {
    super();
  }

  async process(job: Job<AllocationAttemptJob>) {
    if (job.name !== ALLOCATION_ATTEMPT_JOB) {
      return;
    }

    await this.allocationService.processAttempt(job.data.rideId, job.data.attempt);
  }
}
