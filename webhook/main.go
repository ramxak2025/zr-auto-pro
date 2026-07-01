package main

import (
	"crypto/subtle"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

var (
	deploying   bool
	deployMutex sync.Mutex
)

func main() {
	// No hardcoded fallback: a guessable default secret on an endpoint that
	// runs deploys is an RCE-grade hole. docker-compose.yml already enforces
	// DEPLOY_SECRET via ${DEPLOY_SECRET:?...}, this is defense in depth.
	secret := os.Getenv("DEPLOY_SECRET")
	if secret == "" {
		log.Fatal("DEPLOY_SECRET is not set — refusing to start (no insecure default)")
	}

	port := os.Getenv("WEBHOOK_PORT")
	if port == "" {
		port = "9000"
	}

	http.HandleFunc("/deploy", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		// Check auth
		token := r.Header.Get("X-Deploy-Token")
		if token == "" {
			token = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		}
		// Constant-time comparison — a plain != leaks secret length/prefix
		// via response timing.
		if subtle.ConstantTimeCompare([]byte(token), []byte(secret)) != 1 {
			log.Printf("[DENIED] Unauthorized deploy attempt from %s", r.RemoteAddr)
			http.Error(w, `{"error":"unauthorized"}`, http.StatusForbidden)
			return
		}

		deployMutex.Lock()
		if deploying {
			deployMutex.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			fmt.Fprint(w, `{"status":"busy","message":"Deploy already in progress"}`)
			return
		}
		deploying = true
		deployMutex.Unlock()

		log.Printf("[DEPLOY] Triggered by %s", r.RemoteAddr)

		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"status":"ok","message":"Deploy started"}`)

		// Run deploy in background
		go func() {
			defer func() {
				deployMutex.Lock()
				deploying = false
				deployMutex.Unlock()
			}()

			start := time.Now()
			cmd := exec.Command("bash", "/deploy/deploy.sh")
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			err := cmd.Run()
			elapsed := time.Since(start)

			if err != nil {
				log.Printf("[DEPLOY] FAILED after %v: %v", elapsed, err)
			} else {
				log.Printf("[DEPLOY] SUCCESS in %v", elapsed)
			}
		}()
	})

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"status":"ok"}`)
	})

	http.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		deployMutex.Lock()
		d := deploying
		deployMutex.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if d {
			fmt.Fprint(w, `{"deploying":true}`)
		} else {
			fmt.Fprint(w, `{"deploying":false}`)
		}
	})

	log.Printf("Webhook server listening on :%s", port)
	log.Printf("POST /deploy with X-Deploy-Token header to trigger deploy")
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
