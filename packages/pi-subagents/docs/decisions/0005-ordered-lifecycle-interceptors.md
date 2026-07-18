---
status: accepted
date: 2026-07-16
---

# 0005 — Ordered lifecycle interceptors are a narrow provider seam

## Context

Child lifecycle events are observational.
Event listeners cannot replace the exact prompt, prevent a turn, inspect a candidate result before finalization, or request a same-session continuation.
Some Pi extensions need those generative decisions.

## Decision

The package exposes `SubagentsService.registerLifecycleInterceptor()`.
A registration receives immutable execution identity and path facts, an exact prompt immediately before `AgentSession.prompt()`, and a proposed result before workspace teardown, state changes, completion events, history, notifications, or disposal.

Registrations run sequentially in registration order.
Prompt and result replacements flow to the next registration.
A registration may abort a turn or request another turn on the same child session.
The package owns a fixed bound of three continuation rounds to prevent unbounded loops.

The callback surface intentionally exposes neither `SubagentManager` nor `AgentSession`.
It has no host-specific hook names, policy, process execution, configuration, or model/tool behavior.
Existing child lifecycle events remain observational and unchanged.

## Lifetime and failure rules

- A registration handle unregisters idempotently.
  It excludes future boundary snapshots immediately; a snapshot that already captured it finishes in order.
- A provider's optional `dispose()` runs once after its captured callbacks finish.
- Parent cancellation and manager shutdown abort an in-flight callback wait.
  A callback rejection or malformed decision fails the execution before any completion finalization occurs.
- With no active registration, the released prompt, result, event, workspace, queue, session, and resume paths retain their existing behavior and ordering.

## Consequences

The core now has one additional, concrete generative seam.
Extensions compose by registering a provider, while the core continues to own configuration, models, sessions, tools, queueing, concurrency, steering, persistence, workspaces, turn limits, notifications, and disposal.
