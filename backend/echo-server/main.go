package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync/atomic"
	"time"
)

type InfoResponse struct {
	Protocol       string            `json:"protocol"`
	TLSVersion     string            `json:"tls_version,omitempty"`
	Headers        map[string]string `json:"headers"`
	RemoteAddr     string            `json:"remote_addr"`
	Host           string            `json:"host"`
	Path           string            `json:"path"`
	Timestamp      time.Time         `json:"timestamp"`
	ForwardedProto string            `json:"x_forwarded_proto,omitempty"`
	ServerVersion  string            `json:"server_version"`
}

var requestCounter int64

func infoHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&requestCounter, 1)

	headers := make(map[string]string)
	for k, v := range r.Header {
		if len(v) > 0 {
			headers[k] = v[0]
		}
	}

	tlsVersion := ""
	if r.TLS != nil {
		switch r.TLS.Version {
		case 0x0304:
			tlsVersion = "TLS 1.3"
		case 0x0303:
			tlsVersion = "TLS 1.2"
		default:
			tlsVersion = fmt.Sprintf("TLS 0x%04x", r.TLS.Version)
		}
	}

	resp := InfoResponse{
		Protocol:       r.Proto,
		TLSVersion:     tlsVersion,
		Headers:        headers,
		RemoteAddr:     r.RemoteAddr,
		Host:           r.Host,
		Path:           r.URL.Path,
		Timestamp:      time.Now().UTC(),
		ForwardedProto: r.Header.Get("X-Forwarded-Proto"),
		ServerVersion:  "echo-server/1.0",
	}

	istioProto := r.Header.Get("X-Forwarded-Proto")
	if istioProto == "" {
		istioProto = r.Proto
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Backend-Protocol", r.Proto)
	w.Header().Set("X-Forwarded-Protocol", istioProto)
	w.Header().Set("X-Request-Count", strconv.FormatInt(atomic.LoadInt64(&requestCounter), 10))
	json.NewEncoder(w).Encode(resp)
}

func throughputHandler(w http.ResponseWriter, r *http.Request) {
	sizeParam := r.URL.Query().Get("size")
	size := 1024 * 1024 // default 1MB
	if sizeParam != "" {
		if n, err := strconv.Atoi(sizeParam); err == nil && n > 0 && n <= 100*1024*1024 {
			size = n
		}
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-Backend-Protocol", r.Proto)
	w.Header().Set("Content-Length", strconv.Itoa(size))

	chunk := make([]byte, 4096)
	for i := range chunk {
		chunk[i] = 0x41 // 'A'
	}

	written := 0
	for written < size {
		toWrite := len(chunk)
		if written+toWrite > size {
			toWrite = size - written
		}
		n, err := w.Write(chunk[:toWrite])
		written += n
		if err != nil {
			break
		}
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"status":"ok","protocol":"%s","requests":%d}`, r.Proto, atomic.LoadInt64(&requestCounter))
}

func statsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"total_requests":%d}`, atomic.LoadInt64(&requestCounter))
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", infoHandler)
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/throughput", throughputHandler)
	mux.HandleFunc("/stats", statsHandler)

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	log.Printf("Echo server starting on port %s", port)
	log.Printf("Endpoints: / (info), /health, /throughput?size=<bytes>, /stats")

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
