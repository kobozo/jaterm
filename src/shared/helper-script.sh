#!/bin/sh

case "$1" in
  health)
    echo '{"ok":true,"version":"HELPER_VERSION_PLACEHOLDER"}'
    exit 0
    ;;
  git-status)
    DIR="$2"
    case "$DIR" in
      ~*) DIR="$HOME${DIR#~}" ;;
    esac
    if [ -z "$DIR" ]; then DIR="."; fi
    cd "$DIR" 2>/dev/null || cd .
    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      echo '{"branch":"-","ahead":0,"behind":0,"staged":0,"unstaged":0}'
      exit 0
    fi
    BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo DETACHED)
    AHEAD=0; BEHIND=0
    if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
      set -- $(git rev-list --left-right --count @{upstream}...HEAD 2>/dev/null || echo "0 0")
      BEHIND=$1; AHEAD=$2
    fi
    read STAGED UNSTAGED <<EOF
$(git status --porcelain 2>/dev/null | awk 'BEGIN{s=0;u=0} {xy=substr($0,1,2); if (xy=="??") u++; else {x=substr(xy,1,1); y=substr(xy,2,1); if (x!=" ") s++; if (y!=" ") u++;}} END{print s, u}')
EOF
    printf '{"branch":"%s","ahead":%s,"behind":%s,"staged":%s,"unstaged":%s}\n' "$BRANCH" "$AHEAD" "$BEHIND" "$STAGED" "$UNSTAGED"
    ;;
  git-changes)
    DIR="$2"
    case "$DIR" in
      ~*) DIR="$HOME${DIR#~}" ;;
    esac
    if [ -z "$DIR" ]; then DIR="."; fi
    cd "$DIR" 2>/dev/null || cd .
    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      echo '[]'
      exit 0
    fi
    git status --porcelain 2>/dev/null | awk '
      {
        xy=substr($0,1,2);
        if (xy=="!!") next;
        x=substr(xy,1,1); y=substr(xy,2,1);
        p=substr($0,4);
        arrow=index(p, " -> "); if (arrow>0) { p=substr(p, arrow+4); }
        staged=((x!=" " && x!="?"))?"true":"false";
        gsub(/\\\\/, "\\\\\\\\", p); gsub(/"/, "\\"", p);
        if (NR>1) printf ",";
        printf "{\"path\":\"%s\",\"x\":\"%s\",\"y\":\"%s\",\"staged\":%s}", p, x, y, staged;
      }
    END { }' | awk 'BEGIN{printf "["}{print}END{printf "]"}'
    ;;
  git-diff)
    DIR="$2"; FILE="$3"; MODE="$4"
    case "$DIR" in
      ~*) DIR="$HOME${DIR#~}" ;;
    esac
    cd "$DIR" 2>/dev/null || cd .
    if [ "$MODE" = "staged" ]; then git diff --cached -- "$FILE" 2>/dev/null; else git diff -- "$FILE" 2>/dev/null; fi
    ;;
  git-commit)
    DIR="$2"; shift 2; MSG="$*"
    case "$DIR" in
      ~*) DIR="$HOME${DIR#~}" ;;
    esac
    if [ -z "$DIR" ]; then DIR="."; fi
    cd "$DIR" 2>/dev/null || cd .
    git commit -m "$MSG" 2>&1
    ;;
  git-sync)
    DIR="$2"
    case "$DIR" in
      ~*) DIR="$HOME${DIR#~}" ;;
    esac
    if [ -z "$DIR" ]; then DIR="."; fi
    cd "$DIR" 2>/dev/null || cd .
    git pull --rebase 2>&1 && git push 2>&1
    ;;
  git-stage)
    DIR="$2"; FILE="$3"
    case "$DIR" in
      ~*) DIR="$HOME${DIR#~}" ;;
    esac
    if [ -z "$DIR" ]; then DIR="."; fi
    cd "$DIR" 2>/dev/null || cd .
    git add -- "$FILE" 2>&1
    ;;
  git-unstage)
    DIR="$2"; FILE="$3"
    case "$DIR" in
      ~*) DIR="$HOME${DIR#~}" ;;
    esac
    if [ -z "$DIR" ]; then DIR="."; fi
    cd "$DIR" 2>/dev/null || cd .
    git restore --staged -- "$FILE" 2>&1
    ;;
  git-discard)
    DIR="$2"; FILE="$3"
    case "$DIR" in
      ~*) DIR="$HOME${DIR#~}" ;;
    esac
    if [ -z "$DIR" ] ; then DIR="."; fi
    cd "$DIR" 2>/dev/null || cd .
    git restore --source=HEAD --staged --worktree -- "$FILE" 2>&1 || rm -f -- "$FILE" 2>&1
    ;;
  git-stage-all)
    DIR="$2"
    case "$DIR" in
      ~*) DIR="$HOME${DIR#~}" ;;
    esac
    if [ -z "$DIR" ] ; then DIR="."; fi
    cd "$DIR" 2>/dev/null || cd .
    git add -A 2>&1
    ;;
  git-unstage-all)
    DIR="$2"
    case "$DIR" in
      ~*) DIR="$HOME${DIR#~}" ;;
    esac
    if [ -z "$DIR" ] ; then DIR="."; fi
    cd "$DIR" 2>/dev/null || cd .
    git reset HEAD -- . 2>&1
    ;;
  git-pull)
    DIR="$2"
    case "$DIR" in
      ~*) DIR="$HOME${DIR#~}" ;;
    esac
    if [ -z "$DIR" ] ; then DIR="."; fi
    cd "$DIR" 2>/dev/null || cd .
    git pull --rebase 2>&1
    ;;
  git-push)
    DIR="$2"
    case "$DIR" in
      ~*) DIR="$HOME${DIR#~}" ;;
    esac
    if [ -z "$DIR" ] ; then DIR="."; fi
    cd "$DIR" 2>/dev/null || cd .
    git push 2>&1
    ;;
  detect-ports)
    # Detect listening ports (common dev ports)
    # Use different methods based on what's available
    PORTS=""
    
    if command -v ss >/dev/null 2>&1; then
      # Linux with ss - handles both IPv4 and IPv6
      PORTS=$(ss -tln 2>/dev/null | grep LISTEN | awk '{
        # Extract port from the local address field
        split($4, parts, ":")
        port = parts[length(parts)]
        if (port ~ /^[0-9]+$/ && port > 1024 && port < 65536) print port
      }' | sort -nu | head -20)
    elif command -v netstat >/dev/null 2>&1; then
      # macOS/BSD with netstat  
      PORTS=$(netstat -an 2>/dev/null | grep LISTEN | awk '{
        # Handle both . and : as separators
        n = split($4, parts, /[.:]/)
        port = parts[n]
        if (port ~ /^[0-9]+$/ && port > 1024 && port < 65536) print port
      }' | sort -nu | head -20)
    elif command -v lsof >/dev/null 2>&1; then
      # Fallback to lsof - more reliable parsing
      PORTS=$(lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | awk '
        NR>1 {
          # Extract port from the NAME field (e.g., *:3000 or 127.0.0.1:3000)
          n = split($9, parts, ":")
          port = parts[n]
          if (port ~ /^[0-9]+$/ && port > 1024 && port < 65536) print port
        }' | sort -nu | head -20)
    fi
    
    # Convert to JSON array
    if [ -n "$PORTS" ]; then
      echo "$PORTS" | awk 'BEGIN{printf "["} {if(NR>1) printf ","; printf "%s", $1} END{printf "]"}'
    else
      echo "[]"
    fi
    ;;
  watchdog)
    # Combined watchdog that returns git status and detected ports
    DIR="$2"
    case "$DIR" in
      ~*) DIR="$HOME${DIR#~}" ;;
    esac
    if [ -z "$DIR" ]; then DIR="."; fi
    
    # Get git status
    cd "$DIR" 2>/dev/null || cd .
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo DETACHED)
      AHEAD=0; BEHIND=0
      if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
        set -- $(git rev-list --left-right --count @{upstream}...HEAD 2>/dev/null || echo "0 0")
        BEHIND=$1; AHEAD=$2
      fi
      read STAGED UNSTAGED <<EOF
$(git status --porcelain 2>/dev/null | awk 'BEGIN{s=0;u=0} {xy=substr($0,1,2); if (xy=="??") u++; else {x=substr(xy,1,1); y=substr(xy,2,1); if (x!=" ") s++; if (y!=" ") u++;}} END{print s, u}')
EOF
      GIT_STATUS="{\"branch\":\"$BRANCH\",\"ahead\":$AHEAD,\"behind\":$BEHIND,\"staged\":$STAGED,\"unstaged\":$UNSTAGED}"
    else
      GIT_STATUS="{\"branch\":\"-\",\"ahead\":0,\"behind\":0,\"staged\":0,\"unstaged\":0}"
    fi
    
    # Get detected ports (same logic as detect-ports)
    PORTS=""
    if command -v ss >/dev/null 2>&1; then
      # Linux with ss - handles both IPv4 and IPv6
      PORTS=$(ss -tln 2>/dev/null | grep LISTEN | awk '{
        split($4, parts, ":")
        port = parts[length(parts)]
        if (port ~ /^[0-9]+$/ && port > 1024 && port < 65536) print port
      }' | sort -nu | head -20)
    elif command -v netstat >/dev/null 2>&1; then
      # macOS/BSD with netstat
      PORTS=$(netstat -an 2>/dev/null | grep LISTEN | awk '{
        n = split($4, parts, /[.:]/)
        port = parts[n]
        if (port ~ /^[0-9]+$/ && port > 1024 && port < 65536) print port
      }' | sort -nu | head -20)
    elif command -v lsof >/dev/null 2>&1; then
      # Fallback to lsof
      PORTS=$(lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | awk '
        NR>1 {
          n = split($9, parts, ":")
          port = parts[n]
          if (port ~ /^[0-9]+$/ && port > 1024 && port < 65536) print port
        }' | sort -nu | head -20)
    fi
    
    # Convert to JSON array
    if [ -n "$PORTS" ]; then
      PORTS_JSON=$(echo "$PORTS" | awk 'BEGIN{printf "["} {if(NR>1) printf ","; printf "%s", $1} END{printf "]"}')
    else
      PORTS_JSON="[]"
    fi
    
    # Return combined result
    printf '{"git":%s,"ports":%s}\n' "$GIT_STATUS" "$PORTS_JSON"
    ;;
  *)
    echo "jaterm-agent: unknown command: $1" 1>&2
    exit 1
    ;;
esac