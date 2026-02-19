#!/bin/bash
# Simple webhook server using socat/netcat
# Listens on port 9000 for POST requests and triggers deploy
# Secured with a secret token

DEPLOY_SECRET="${DEPLOY_SECRET:-zr-auto-deploy-secret-change-me}"
DEPLOY_SCRIPT="/deploy/deploy.sh"
LOG="/var/log/webhook.log"

echo "[$(date)] Webhook server starting on :9000" | tee -a "$LOG"

while true; do
    # Use a simple HTTP response approach with socat
    {
        read -r REQUEST_LINE
        METHOD=$(echo "$REQUEST_LINE" | cut -d' ' -f1)
        PATH_INFO=$(echo "$REQUEST_LINE" | cut -d' ' -f2)

        # Read headers
        CONTENT_LENGTH=0
        AUTH_TOKEN=""
        while read -r HEADER; do
            HEADER=$(echo "$HEADER" | tr -d '\r\n')
            [ -z "$HEADER" ] && break
            case "$HEADER" in
                Content-Length:*) CONTENT_LENGTH=$(echo "$HEADER" | cut -d: -f2 | tr -d ' ') ;;
                X-Deploy-Token:*) AUTH_TOKEN=$(echo "$HEADER" | cut -d: -f2 | tr -d ' ') ;;
                Authorization:*) AUTH_TOKEN=$(echo "$HEADER" | sed 's/Authorization: Bearer //; s/\r//') ;;
            esac
        done

        # Read body if any
        BODY=""
        if [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
            read -rn "$CONTENT_LENGTH" BODY
        fi

        echo "[$(date)] $METHOD $PATH_INFO token=${AUTH_TOKEN:0:8}..." >> "$LOG"

        if [ "$PATH_INFO" = "/deploy" ] && [ "$METHOD" = "POST" ]; then
            if [ "$AUTH_TOKEN" = "$DEPLOY_SECRET" ]; then
                echo "[$(date)] Authorized deploy triggered" >> "$LOG"
                # Run deploy in background
                nohup bash "$DEPLOY_SCRIPT" >> "$LOG" 2>&1 &
                RESPONSE='{"status":"ok","message":"Deploy started"}'
                echo -e "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${#RESPONSE}\r\nConnection: close\r\n\r\n$RESPONSE"
            else
                echo "[$(date)] Unauthorized attempt" >> "$LOG"
                RESPONSE='{"status":"error","message":"Unauthorized"}'
                echo -e "HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: ${#RESPONSE}\r\nConnection: close\r\n\r\n$RESPONSE"
            fi
        elif [ "$PATH_INFO" = "/health" ]; then
            RESPONSE='{"status":"ok"}'
            echo -e "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${#RESPONSE}\r\nConnection: close\r\n\r\n$RESPONSE"
        else
            RESPONSE='{"status":"not_found"}'
            echo -e "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: ${#RESPONSE}\r\nConnection: close\r\n\r\n$RESPONSE"
        fi
    } | nc -l -p 9000 -q 1 2>/dev/null || sleep 1
done
