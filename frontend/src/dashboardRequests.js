const inFlightRequests = new Map();

function createAbortError() {
  return Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' });
}

export function requestDashboardData(api, owner, path, signal) {
  if (!owner) return api(path, { signal });

  const key = `${owner}:${path}`;
  let request = inFlightRequests.get(key);
  if (!request) {
    const controller = new AbortController();
    request = {
      controller,
      subscribers: 0,
      settled: false,
      promise: null,
    };
    request.promise = Promise.resolve()
      .then(() => api(path, { signal: controller.signal }))
      .finally(() => {
        request.settled = true;
        if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
      });
    inFlightRequests.set(key, request);
  }

  return new Promise((resolve, reject) => {
    let completed = false;
    const unsubscribe = () => {
      if (completed) return;
      completed = true;
      signal?.removeEventListener('abort', handleAbort);
      request.subscribers -= 1;
      if (request.subscribers === 0 && !request.settled) {
        queueMicrotask(() => {
          if (request.subscribers === 0 && !request.settled) request.controller.abort();
        });
      }
    };
    const handleAbort = () => {
      unsubscribe();
      reject(createAbortError());
    };

    request.subscribers += 1;
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    signal?.addEventListener('abort', handleAbort, { once: true });
    request.promise.then(
      (value) => {
        if (completed) return;
        unsubscribe();
        resolve(value);
      },
      (error) => {
        if (completed) return;
        unsubscribe();
        reject(error);
      },
    );
  });
}
