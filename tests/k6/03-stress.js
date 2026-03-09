/**
 * Test 3: Stress / Ramp-up Test
 *
 * Ramps VUs from 0 → 100 → 200 → 0 to find the breaking point.
 * Targets both H2 and H1.1 backends simultaneously.
 *
 * Run: k6 run --env BASE_URL=https://network-test.<domain> 03-stress.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "https://network-test.example.com";

const errorRate = new Rate("stress_error_rate");
const latency = new Trend("stress_latency_ms", true);

export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "60s", target: 50 },
    { duration: "60s", target: 100 },
    { duration: "60s", target: 200 },
    { duration: "30s", target: 200 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    stress_error_rate: ["rate<0.05"],
    "stress_latency_ms": ["p(95)<10000", "p(99)<20000"],
    http_req_failed: ["rate<0.05"],
  },
};

export default function () {
  const paths = ["/h2/", "/h1/", "/health"];
  const path = paths[Math.floor(Math.random() * paths.length)];

  const start = Date.now();
  const res = http.get(`${BASE_URL}${path}`, {
    timeout: "30s",
  });
  latency.add(Date.now() - start);

  const ok = res.status >= 200 && res.status < 300;
  errorRate.add(!ok ? 1 : 0);

  check(res, {
    "stress: status 2xx": (r) => r.status >= 200 && r.status < 300,
  });

  sleep(0.5);
}

export function handleSummary(data) {
  var m = data.metrics;
  function mv(name, key) { return m[name] && m[name].values ? m[name].values[key] : undefined; }

  const summary = {
    timestamp: new Date().toISOString(),
    test: "stress-ramp",
    base_url: BASE_URL,
    metrics: {
      error_rate: mv("stress_error_rate", "rate"),
      p50_ms: mv("stress_latency_ms", "p(50)"),
      p95_ms: mv("stress_latency_ms", "p(95)"),
      p99_ms: mv("stress_latency_ms", "p(99)"),
      max_ms: mv("stress_latency_ms", "max"),
      total_requests: mv("http_reqs", "count"),
      rps: mv("http_reqs", "rate"),
    },
  };

  return {
    "results/stress-summary.json": JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(summary, null, 2),
  };
}
