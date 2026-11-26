import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Central Prometheus metrics registry.
 *
 * Naming convention: `ruidong_<domain>_<name>_<unit>` following prom-client
 * best practice. `_total` suffix for counters, `_seconds` for duration.
 *
 * Cardinality discipline:
 *   - HTTP histograms use method + route-pattern + status_class, NOT raw paths
 *     (paths contain IDs and would blow up label cardinality).
 *   - Business gauges are scraped values — do NOT add user-level labels.
 */

export const registry = new Registry();

// Default Node metrics: process_resident_memory_bytes, nodejs_eventloop_lag_seconds,
// nodejs_gc_duration_seconds, process_cpu_seconds_total, etc.
// Prefix keeps our metrics distinct from other services scraped by the same Prometheus.
collectDefaultMetrics({ register: registry, prefix: 'ruidong_' });

// ============================================================
// HTTP
// ============================================================

export const httpRequestDuration = new Histogram({
  name: 'ruidong_http_request_duration_seconds',
  help: 'HTTP request latency grouped by method, route, and status class',
  // Route pattern ("/api/user/:id"), NOT the raw URL. Status class ("2xx", "5xx")
  // instead of each individual code to cap label permutations.
  labelNames: ['method', 'route', 'status_class'],
  // Buckets tuned for a NestJS API: 5ms ... 10s.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpRequestTotal = new Counter({
  name: 'ruidong_http_requests_total',
  help: 'Total HTTP requests handled by the API',
  labelNames: ['method', 'route', 'status_class'],
  registers: [registry],
});
