# GitHub Copilot Instructions for Patheya Express

## Purpose

This file defines mandatory repository-wide instructions for AI coding agents working in the Patheya Express codebase. It is the entry point for agent behavior and implementation decisions.

Detailed architecture, product context, engineering standards, workflows, and decision records are maintained in the PADK documentation under .ai. AI agents must consult those documents before making changes when the task requires context beyond the immediate file.

## Technology Stack

Backend
- NestJS 11
- Prisma 6
- PostgreSQL
- Redis
- BullMQ
- Socket.IO
- Swagger/OpenAPI

Frontend
- Angular 21
- Nx Workspace
- Angular Signals
- Standalone Components

Package Manager
- pnpm

## Before Writing Code

Before implementing any change, AI agents must first read:

1. .ai/README.md
2. Relevant documents under .ai/context
3. Relevant documents under .ai/architecture
4. Relevant documents under .ai/standards
5. Relevant documents under .ai/workflows

Agents should read only the documents relevant to the requested task.

## Core Engineering Principles

Apply the following principles in all work:

- Enterprise architecture only
- Production-ready code only
- Simplicity over cleverness
- Reusability first
- Maintainability first
- Strong typing
- Follow the existing architecture
- Never redesign completed modules
- Prefer existing patterns over creating new ones

## Repository Rules

AI agents must:

- Understand the existing code before making changes
- Reuse existing implementations where possible
- Avoid duplicate functionality
- Keep changes minimal and focused
- Preserve backwards compatibility where practical

## Backend Rules

The backend should follow this responsibility flow:

Controller
↓
Service
↓
Repository
↓
Prisma

Business logic belongs in Services. Repositories own database access. Controllers remain thin.

## Frontend Rules

The frontend should follow this responsibility flow:

Generated SDK
↓
Feature Service
↓
Signal Store
↓
Facade
↓
Component

Components never contain business logic. Components never call HttpClient. Components never call the generated SDK directly. Use Angular Signals.

Generated SDK is the single source of truth for backend communication.

Do not introduce HttpClient-based services when an SDK endpoint already exists.

## Quality Expectations

All changes should be:

- Readable
- Structured around small methods and components
- Strongly typed
- Explicit in error handling
- Consistent in naming
- Covered by tests where appropriate

## AI Behaviour

When implementing features:

- Read the relevant PADK documentation first
- Search for existing implementations before creating new ones
- Reuse established patterns
- If the architecture is unclear, ask for clarification instead of guessing
- Never introduce competing architectures
- Never implement temporary or MVP shortcuts

## Do Not

AI agents must never:

- Redesign completed modules.
- Introduce new architectural patterns without justification.
- Duplicate existing functionality.
- Ignore PADK documentation.
- Leave the project in a failing build state.

## Completion Checklist

Before considering work complete:

- Ensure the code builds
- Fix lint errors
- Fix type errors
- Ensure tests pass when applicable
- Update PADK documentation if architecture or standards changed
