/** Tiny inline concurrency limiter shared by 'generate-exercises.ts' and 'generate-theory.ts'. Avoids a third-party dep. */

export type LimitFn = <T>(fn: () => Promise<T>) => Promise<T>;

export function pLimit(concurrency: number): LimitFn {
  if (concurrency < 1) throw new Error('pLimit: concurrency must be >= 1');
  let active = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (job) job();
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      };
      queue.push(run);
      next();
    });
}
