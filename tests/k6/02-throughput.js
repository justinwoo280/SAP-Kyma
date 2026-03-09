/**
 * Test 2: Network Throughput Benchmark
 *
 * Measures download throughput for:
 *   - /throughput/h2?size=N  → H2 backend (1MB, 10MB payloads)
 *   - /throughput/h1?size=N  → H1.1 backend (1MB, 10MB payloads)
 *
 * Metrics collected:
 *   - data_received (bytes) / duration → throughput (MB/s)
 *   - p50/p95/p99 response duration
 *   - Request rate (RPS)
 *   - Error rate
 *
 * Run: k6 run --env BASE_URL=https://network-test.<domain> \
 *             --env PAYLOAD_SIZE=1048576 02-throughput.js
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "https://network-test.example.com";
const PAYLOAD_SIZE = parseInt(__ENV.PAYLOAD_SIZE || "1048576", 10); // default 1MB
const DURATION = __ENV.DURATION || "120s";
const VUS = parseInt(__ENV.VUS || "20", 10);

const h2ThroughputDuration = new Trend("h2_throughput_duration_ms", true);
const h1ThroughputDuration = new Trend("h1_throughput_duration_ms", true);
const h2BytesReceived = new Counter("h2_bytes_received");
const h1BytesReceived = new Counter("h1_bytes_received");
const h2Errors = new Rate("h2_error_rate");
const h1Errors = new Rate("h1_error_rate");

export const options = {
  scenarios: {
    h2_throughput: {
      executor: "constant-vus",
      vus: VUS,
      duration: DURATION,
      exec: "testH2Throughput",
    },
    h1_throughput: {
      executor: "constant-vus",
      vus: Math.floor(VUS / 2),
      duration: DURATION,
      exec: "testH1Throughput",
      startTime: "5s",
    },
  },
  thresholds: {
    h2_error_rate: ["rate<0.01"],
    h1_error_rate: ["rate<0.01"],
    "h2_throughput_duration_ms{size:1MB}": ["p(95)<5000"],
    "h1_throughput_duration_ms{size:1MB}": ["p(95)<8000"],
    http_req_failed: ["rate<0.02"],
  },
};

export function testH2Throughput() {
  const url = `${BASE_URL}/throughput/h2?size=${PAYLOAD_SIZE}`;
  const start = Date.now();

  const res = http.get(url, {
    headers: { Accept: "*/*" },
    tags: { size: PAYLOAD_SIZE >= 1048576 ? `${Math.floor(PAYLOAD_SIZE / 1048576)}MB` : `${PAYLOAD_SIZE}B` },
    timeout: "120s",
  });

  const durationMs = Date.now() - start;
  const ok = res.status === 200 && res.body && res.body.length >= PAYLOAD_SIZE * 0.95;

  h2ThroughputDuration.add(durationMs, {
    size: PAYLOAD_SIZE >= 1048576 ? `${Math.floor(PAYLOAD_SIZE / 1048576)}MB` : `${PAYLOAD_SIZE}B`,
  });
  h2BytesReceived.add(res.body ? res.body.length : 0);
  h2Errors.add(!ok ? 1 : 0);

  check(res, {
    "H2 throughput: status 200": (r) => r.status === 200,
    "H2 throughput: body size correct": () => ok,
  });

  sleep(0.1);
}

export function testH1Throughput() {
  const url = `${BASE_URL}/throughput/h1?size=${PAYLOAD_SIZE}`;
  const start = Date.now();

  const res = http.get(url, {
    headers: { Accept: "*/*" },
    tags: { size: PAYLOAD_SIZE >= 1048576 ? `${Math.floor(PAYLOAD_SIZE / 1048576)}MB` : `${PAYLOAD_SIZE}B` },
    timeout: "120s",
  });

  const durationMs = Date.now() - start;
  const ok = res.status === 200 && res.body && res.body.length >= PAYLOAD_SIZE * 0.95;

  h1ThroughputDuration.add(durationMs, {
    size: PAYLOAD_SIZE >= 1048576 ? `${Math.floor(PAYLOAD_SIZE / 1048576)}MB` : `${PAYLOAD_SIZE}B`,
  });
  h1BytesReceived.add(res.body ? res.body.length : 0);
  h1Errors.add(!ok ? 1 : 0);

  check(res, {
    "H1 throughput: status 200": (r) => r.status === 200,
    "H1 throughput: body size correct": () => ok,
  });

  sleep(0.1);
}

export function handleSummary(data) {
  const durationSeconds = (parseInt(DURATION, 10) || 120);
  var m = data.metrics;
  function mv(name, key) { return m[name] && m[name].values ? m[name].values[key] : undefined; }

  const h2Bytes = mv("h2_bytes_received", "count") || 0;
  const h1Bytes = mv("h1_bytes_received", "count") || 0;

  const summary = {
    timestamp: new Date().toISOString(),
    test: "throughput-benchmark",
    base_url: BASE_URL,
    payload_size_bytes: PAYLOAD_SIZE,
    duration_seconds: durationSeconds,
    vus: VUS,
    results: {
      h2: {
        total_bytes: h2Bytes,
        throughput_mbps: ((h2Bytes / 1024 / 1024) / durationSeconds).toFixed(2),
        p50_ms: mv("h2_throughput_duration_ms", "p(50)"),
        p95_ms: mv("h2_throughput_duration_ms", "p(95)"),
        p99_ms: mv("h2_throughput_duration_ms", "p(99)"),
        error_rate: mv("h2_error_rate", "rate"),
      },
      h1: {
        total_bytes: h1Bytes,
        throughput_mbps: ((h1Bytes / 1024 / 1024) / durationSeconds).toFixed(2),
        p50_ms: mv("h1_throughput_duration_ms", "p(50)"),
        p95_ms: mv("h1_throughput_duration_ms", "p(95)"),
        p99_ms: mv("h1_throughput_duration_ms", "p(99)"),
        error_rate: mv("h1_error_rate", "rate"),
      },
    },
    http_req_failed_rate: mv("http_req_failed", "rate"),
  };

  return {
    "results/throughput-summary.json": JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(summary, null, 2),
  };
}
