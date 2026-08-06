-- Enterprise Dispatch Engine Enhancement
-- Additive only: adds a NOT NULL column with a constant default, which Postgres (11+) applies as
-- metadata-only (no table rewrite, no lock beyond a brief ACCESS EXCLUSIVE for the DDL itself).
-- Every pre-existing row is backfilled to cycle=1 by the DEFAULT clause automatically — no
-- separate UPDATE/backfill statement needed, no data loss, no downtime.
ALTER TABLE "delivery_assignments" ADD COLUMN "cycle" INTEGER NOT NULL DEFAULT 1;
