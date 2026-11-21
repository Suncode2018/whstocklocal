const monitored = new Set([
  '/api/inbound/list',
  '/api/stock/balance',
  '/api/warehouse-tracking'
]);

const counts = new Map();
const inFlight = new Map();

module.exports = function requestMetrics(req, res, next) {
  const route = req.path;
  if (req.method !== 'GET' || !monitored.has(route)) return next();

  const startedAt = Date.now();
  const active = (inFlight.get(route) || 0) + 1;
  inFlight.set(route, active);
  const requestNo = (counts.get(route) || 0) + 1;
  counts.set(route, requestNo);
  // Keep a stable correlation id on the request. Reading counts at response
  // completion caused overlapping requests to all be logged with the latest id.
  req.apiRequestNo = requestNo;
  req.apiActiveAtStart = active;
  let recorded = false;

  const finish = outcome => {
    if (recorded) return;
    recorded = true;
    inFlight.set(route, Math.max(0, (inFlight.get(route) || 1) - 1));
    console.info('[API TIMING]', JSON.stringify({
      route,
      requestNo,
      durationMs: Date.now() - startedAt,
      status: res.statusCode,
      activeAtStart: active,
      outcome
    }));
  };

  res.once('finish', () => finish('finished'));
  res.once('close', () => finish(res.writableEnded ? 'finished' : 'client_closed'));
  next();
};
