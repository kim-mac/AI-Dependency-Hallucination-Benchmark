# Mechanize Agent Evaluation Lab - Project Brief

## Overview

I built this project to study how coding agents behave in a realistic backend task when dependency decisions matter for reliability.
The system runs repeated agent trials, captures run artifacts, grades outcomes deterministically + rubric-style, and summarizes risk patterns across runs.

## Problem

In agent-assisted software development, dependency choices can quietly introduce risk:

- fake or wrong package names,
- invalid version ranges,
- deprecated dependencies,
- code importing packages not declared in manifests,
- passing-looking output that fails when installed or tested.

These failures are costly in production pipelines and hard to detect from a single run.

## What I built

### 1) Benchmark harness

- Automated runner for single and batch executions across providers/models
- Strict vs minimal prompt variants for behavior comparison
- Transcript capture for every run

### 2) Per-run artifact integrity

- Workspace snapshot per run (source + manifest context, excluding `node_modules`)
- Grading resolves each transcript to its matching snapshot to avoid cross-run contamination

### 3) Grading + analytics

- Deterministic dependency checks:
  - package existence
  - version validity
  - deprecation status
  - undeclared imports
- Test and implementation checks
- Aggregate reporting in `summary.json` and per-run records in `grading_results.json`

### 4) Control dashboard

- Start/stop jobs
- Configure providers/models/prompts
- Stream live logs
- Trigger grading
- Browse history/transcripts/snapshots

## Key metrics tracked

- `hallucination_rate`
- `name_hallucination_rate`
- `version_hallucination_rate`
- `deprecated_dependency_rate`
- `undeclared_import_rate`
- `avg_prod_dependency_count`
- `success_rate`

## Why this matters

This turns agent reliability from a subjective impression into a measurable engineering signal.
It supports safer iteration by making failure modes visible and reproducible before deployment.

## Practical outcome

- Faster diagnosis of dependency-related agent failures
- Better prompt/policy comparison (strict vs minimal)
- Stronger confidence in whether improvements are real vs anecdotal

## Current limitations

- Not RL or model training; this is evaluation, not policy optimization
- Single task domain (price-checker API)
- Rubric components can still include subjective variance

## Next steps

- Add subset grading controls and experiment tags
- Expand tasks to multiple software domains
- Add CI-based scheduled benchmark runs
- Introduce policy guardrails informed by recurring failure patterns
