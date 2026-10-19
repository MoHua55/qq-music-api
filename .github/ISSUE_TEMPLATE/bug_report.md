---
name: Bug report
about: Report a reproducible problem without exposing credentials
title: "bug: "
labels: bug
assignees: ''
---

## Environment

- Package version or commit:
- Node.js and npm versions:
- Operating system:
- Usage mode: Node.js / Docker / Electron / Vercel / Cloudflare / other embedded host
- Login channel, if relevant: `qq` (mobile QQ) / `wechat` / `qqmusic` (QQ Music App)

## Reproduction

Describe the smallest reproducible sequence, including the endpoint and sanitized parameters.

## Expected and actual behavior

Describe what should happen and what happened instead.

## Verification

State whether the problem is reproducible without a real QQ login and whether it depends on a live QQ Music response.

## Sanitized logs

Include only sanitized status codes, error keys, field names, and counts needed to explain the problem. Do not include cookies, QR keys, session tokens, musickey values, account or device identifiers, auth-state files, `.env` contents, complete playback or authenticated URLs, or HAR files containing credentials. For security-sensitive reports, use the private security report linked in the issue chooser.
