# Features Overview

This document tracks implemented features and candidates. Items are grouped for quick scanning.

## Implemented

- SSH sessions: connect, shell, write/resize/close, exec, keepalive.
- Known hosts: best-effort verification against `~/.ssh/known_hosts`.
- Port forwards: Local (L) and Remote (R) via system `ssh`, events.
- SFTP basics: list, mkdir -p, upload (base64) with progress events.
  - UI panel (sidebar) for remote browse and local→remote upload.
  - File download (remote→local) via base64 data URI (initial).
- Git tools: status, changes, diff, stage/unstage, commit, sync via helper.
- Helper installer: local and SSH; versioned ensure with progress events.
- Local PTY: open/write/resize/kill with events.

## High-Impact Candidates

- Host Trust Flow: first-connect fingerprint prompt and persisted trust.
- SFTP Phase 1: download, delete, rename/move, chmod/chown, attrs; transfer queue.
- Port Forward Manager: persisted presets, health checks, auto-restart.
- Dynamic SOCKS (D) forwarding: per-session toggle.

## Productivity & UX

- Command palette; snippets/macros with prompts; workspaces (save/restore tabs, panes, forwards).

## SSH & Connectivity

- Jump hosts (ProxyJump) chaining; mosh fallback for high-latency links.

## Collaboration & Automation

- Session recording and share-view; task runner and watchers (local/SSH via helper).
