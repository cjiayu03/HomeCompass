# HomeCompass Improvement Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Turn HomeCompass from a partially fixture-backed prototype into a trustworthy, evidence-led family home research workflow while preserving the historical-data boundary.

**Architecture:** The work is split into seven independently testable phase plans. The phases share a small API result contract, a versioned scoring policy, provenance metadata, and explicit workspace request state. Each phase ends with its own backend/frontend verification gate before the next phase is started.

**Tech Stack:** FastAPI, Pydantic 2, asyncpg, PostgreSQL/PostGIS, Next.js 16, React 19, Leaflet/react-leaflet, Supabase Auth, OneMap, pytest, Vitest/React Testing Library, and Playwright for the final browser smoke path.

**Spec:** docs/superpowers/specs/2026-10-20-homecompass-improvement-roadmap-design.md

## Global Constraints

- Historical HDB transaction records must remain visibly historical and must never be presented as current listings.
- Fixture homes are available only through an explicit fixture/demo mode and are never an implicit fallback for failed live requests.
- A score must expose components, coverage, missing evidence, timestamp, and policy version; unsupported evidence contributes nothing.
- Straight-line distances must be labelled as estimates; unverified route data must not be called commute time.
- Paid AI interpretation must not remain an unrestricted unauthenticated production endpoint.
- All account-owned reads and writes must remain ownership-scoped and idempotent where synchronization is retried.
- Lab 3, Lab 4, Lab 5, course reports, diagrams, generated artifacts, and course packaging are out of scope and must not be modified, staged, committed, or pushed.
- No push is authorized by this plan.

## Review Focus

- A live request fails after a previous success: the expected behavior is to retain the last good data, show an error, and never replace it with fixtures. Test in Phase 1, workspace provider state tests.
- Two searches resolve out of order: the expected behavior is that the newest request wins. Test in Phase 1, abort/race tests.
- A home has sparse evidence or only missing distance data: the expected behavior is a nullable score with visible coverage and missing evidence. Test in Phase 2, scoring policy tests.
- A guest signs in after saving local shortlist and places: the expected behavior is an ownership-safe, repeatable merge with conflicts reported and no silent overwrite. Test in Phase 5, sync tests.
- A map viewport or provider request is malformed or too large: the expected behavior is a bounded validation error, not an unbounded query or browser crash. Test in Phases 3 and 4, API contract tests.

## Plan set and required order

The approved design spans independent subsystems, so each phase has a separate
plan with its own working test cycle:

1. docs/superpowers/plans/2026-10-20-homecompass-phase-1-trustworthy-search.md
2. docs/superpowers/plans/2026-10-20-homecompass-phase-2-transparent-scoring.md
3. docs/superpowers/plans/2026-10-20-homecompass-phase-3-family-places.md
4. docs/superpowers/plans/2026-10-20-homecompass-phase-4-map-scale.md
5. docs/superpowers/plans/2026-10-20-homecompass-phase-5-security-sync.md
6. docs/superpowers/plans/2026-10-20-homecompass-phase-6-saved-decisions.md
7. docs/superpowers/plans/2026-10-20-homecompass-phase-7-hardening.md

Do not start a later phase until the prior phase's acceptance gate passes.
The phase plans are the executable source of truth; this file is the order,
scope, and safety contract.

## Dependency and file-safety policy

Before each phase, inspect the current dirty worktree. The existing Lab 3
changes are user-owned and must remain untouched. For commits, use explicit
application-path allowlists from the phase plan and verify the staged path list
before creating the commit.

Application paths that may be changed by the phase plans include:

- frontend/app/(workspace)/**
- frontend/components/**
- frontend/lib/**
- frontend/package.json
- package-lock.json
- frontend/vitest.config.js
- frontend/test/**
- frontend/playwright.config.js
- frontend/e2e/**
- backend/app/**
- backend/tests/**
- backend/requirements.txt only when a backend dependency is strictly required
- database/migrations/005_*.sql and later application migrations
- docs/superpowers/**

Do not modify any path below lab3, any existing Lab export script, or any
course report/diagram/generated artifact.

## Commit policy

Each completed task should end with a focused local commit when execution
begins. Commits must contain only the task's application paths and tests. Do
not push any commit. If the worktree contains unrelated dirty files, stage
only the exact paths listed by the task.

## Final roadmap gate

After Phase 7, run the backend suite, frontend unit/integration suite, frontend
production build, migration/readiness checks, and the browser smoke path. Then
inspect:

    git status --short
    git diff --cached --name-only
    git log --oneline --decorate -n 12

The final review must confirm that no Lab or course-deliverable path appears
in any HomeCompass implementation commit. The private branch remains local
until the user separately authorizes a push.
