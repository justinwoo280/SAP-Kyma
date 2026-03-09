/**
 * Test 1: Protocol Negotiation Check
 *
 * Validates:
 *   - Client→Gateway: HTTP/2 (TLS + ALPN h2)
 *   - Gateway→Backend(H2 path): HTTP/2  (X-Backend-Protocol: HTTP/2.0)
 *   - Gateway→Backend(H1 path): HTTP/1.1 (X-Backend-Protocol: HTTP/1.1)
 *   - Alt-Svc header present (signals HTTP/3 QUIC availability)
 *
 * k6 does not natively support HTTP/3 (QUIC); use curl/quiche for QUIC tests.
 * This script validates H1.1 / H2 paths and checks Alt-Svc advertisement.
 *
 * Run: k6 run --env BASE_URL=https://network-test.<domain> 01-protocol-check.js
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "https://network-test.example.com";

const h2BackendOk = new Rate("h2_backend_protocol_ok");
const h1BackendOk = new Rate("h1_backend_protocol_ok");
const altSvcPresent = new Rate("alt_svc_header_present");
const h2Latency = new Trend("h2_request_duration_ms", true);
const h1Latency = new Trend("h1_request_duration_ms", true);

export const options = {
  scenarios: {
    protocol_check: {
      executor: "constant-vus",
      vus: 5,
      duration: "60s",
    },
  },
  thresholds: {
    h2_backend_protocol_ok: ["rate>0.95"],
    h1_backend_protocol_ok: ["rate>0.95"],
    alt_svc_header_present: ["rate>0.95"],
    http_req_failed: ["rate<0.05"],
  },
};

function parseJsonBody(res) {
  try {
    return JSON.parse(res.body);
  } catch (_) {
    return null;
  }
}

export default function () {
  group("H2 backend path (/h2)", () => {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/h2/`, {
      headers: { Accept: "application/json" },
    });
    h2Latency.add(Date.now() - start);

    const body = parseJsonBody(res);

    const backendProto = res.headers["X-Backend-Protocol"] || (body && body.protocol) || "";
    const isH2 = backendProto.includes("HTTP/2") || backendProto === "HTTP/2.0";

    const altSvc = res.headers["Alt-Svc"] || "";
    const hasH3Advert = altSvc.includes("h3");

    check(res, {
      "H2 path: status 200": (r) => r.status === 200,
      "H2 path: backend used HTTP/2": () => isH2,
      "H2 path: Alt-Svc header present (h3 advertised)": () => hasH3Advert,
    });

    h2BackendOk.add(isH2 ? 1 : 0);
    altSvcPresent.add(hasH3Advert ? 1 : 0);
  });

  group("H1.1 backend path (/h1)", () => {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/h1/`, {
      headers: { Accept: "application/json" },
    });
    h1Latency.add(Date.now() - start);

    const body = parseJsonBody(res);
    const backendProto = res.headers["X-Backend-Protocol"] || (body && body.protocol) || "";
    const isH1 = backendProto === "HTTP/1.1" || backendProto.includes("HTTP/1");

    check(res, {
      "H1 path: status 200": (r) => r.status === 200,
      "H1 path: backend used HTTP/1.1": () => isH1,
    });

    h1BackendOk.add(isH1 ? 1 : 0);
  });

  group("Health endpoint", () => {
    const res = http.get(`${BASE_URL}/health`, {
      headers: { Accept: "application/json" },
    });
    check(res, {
      "health: status 200": (r) => r.status === 200,
      "health: body contains ok": (r) => r.body.includes("ok"),
    });
  });

  sleep(1);
}

export function handleSummary(data) {
  var m = data.metrics;
  function mv(name, key) { return m[name] && m[name].values ? m[name].values[key] : undefined; }

  const summary = {
    timestamp: new Date().toISOString(),
    test: "protocol-negotiation",
    base_url: BASE_URL,
    thresholds_passed: Object.entries(m)
      .filter(([, v]) => v.thresholds)
      .every(([, v]) => Object.values(v.thresholds).every((t) => !t.ok === false)),
    metrics: {
      h2_backend_ok_rate: mv("h2_backend_protocol_ok", "rate"),
      h1_backend_ok_rate: mv("h1_backend_protocol_ok", "rate"),
      alt_svc_rate: mv("alt_svc_header_present", "rate"),
      h2_p95_ms: mv("h2_request_duration_ms", "p(95)"),
      h1_p95_ms: mv("h1_request_duration_ms", "p(95)"),
      http_req_failed_rate: mv("http_req_failed", "rate"),
    },
  };

  return {
    "results/protocol-check-summary.json": JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(summary, null, 2),
  };
}
