import { Job } from 'bullmq';

import { TrendingSearchProcessor } from './trending-search.processor';

function buildJob(name: string): Job {
  return { name } as Job;
}

function lastPayload(mockFn: jest.Mock): Record<string, unknown> {
  const calls = mockFn.mock.calls as unknown[][];
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

describe('TrendingSearchProcessor', () => {
  let processor: TrendingSearchProcessor;
  let searchRepository: { recomputeTrendingScores: jest.Mock };
  let logger: { log: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    searchRepository = { recomputeTrendingScores: jest.fn() };
    logger = { log: jest.fn(), error: jest.fn() };

    processor = new TrendingSearchProcessor(
      searchRepository as never,
      logger as never,
    );
  });

  it('emits scheduled_job_completed with resultCount taken from recomputeTrendingScores', async () => {
    searchRepository.recomputeTrendingScores.mockResolvedValue(7);

    await processor.process(buildJob('aggregate-trending-searches'));

    expect(searchRepository.recomputeTrendingScores).toHaveBeenCalledWith(24);
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'scheduled_job_completed',
        job: 'trending-search-aggregation',
        queue: 'search',
        resultCount: 7,
      }),
      'TrendingSearchProcessor',
    );
    expect(typeof lastPayload(logger.log).durationMs).toBe('number');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('emits scheduled_job_completed with resultCount = 0 when nothing was trending', async () => {
    searchRepository.recomputeTrendingScores.mockResolvedValue(0);

    await processor.process(buildJob('aggregate-trending-searches'));

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ resultCount: 0 }),
      'TrendingSearchProcessor',
    );
  });

  it('emits scheduled_job_failed (not completed) and rethrows when the aggregation query fails', async () => {
    const boom = new Error('search_logs unavailable');
    searchRepository.recomputeTrendingScores.mockRejectedValue(boom);

    await expect(
      processor.process(buildJob('aggregate-trending-searches')),
    ).rejects.toThrow('search_logs unavailable');

    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'scheduled_job_failed',
        job: 'trending-search-aggregation',
        queue: 'search',
        reason: 'search_logs unavailable',
      }),
      boom.stack,
      'TrendingSearchProcessor',
    );
    expect(typeof lastPayload(logger.error).durationMs).toBe('number');
  });
});
