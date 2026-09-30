/** BullMQ queue names. */
export const Queues = {
  /** Delayed jobs that simulate carrier progress for the mock provider. */
  MOCK_PROVIDER: 'mock-provider',
  /** Uploads a call's recording to object storage once COMPLETED. */
  RECORDINGS: 'recordings',
  /** Repeatable job that flushes Redis events to MySQL. */
  PERSISTENCE: 'persistence',
} as const;
