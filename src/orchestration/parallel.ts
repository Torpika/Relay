export interface SettledTask<T> {
  status: "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
}

export async function settleWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  task: (input: Input, index: number) => Promise<Output>,
  signal?: AbortSignal
): Promise<SettledTask<Output>[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive integer");
  }

  const results = new Array<SettledTask<Output>>(inputs.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < inputs.length) {
      if (signal?.aborted) {
        return;
      }

      const index = nextIndex;
      nextIndex += 1;

      try {
        results[index] = { status: "fulfilled", value: await task(inputs[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  const workerCount = Math.min(concurrency, inputs.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  for (let index = 0; index < results.length; index += 1) {
    results[index] ??= {
      status: "rejected",
      reason: signal?.reason ?? new Error("Task was cancelled before it started")
    };
  }

  return results;
}
