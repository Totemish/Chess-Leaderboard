-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "currentRound" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "format" TEXT NOT NULL DEFAULT 'rapid';

-- Backfill: tournaments that already have rounds start from their latest one.
UPDATE "Tournament" t
SET "currentRound" = COALESCE((SELECT MAX(m."round") FROM "Match" m WHERE m."tournamentId" = t."id"), 0);
