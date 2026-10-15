-- A member (User) can now sign in several ways; each way is an Identity row.
-- Players get a listing status and Chess.com's permanent account id.

-- CreateTable
CREATE TABLE "Identity" (
    "id" TEXT NOT NULL,
    "authId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "email" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Identity_pkey" PRIMARY KEY ("id")
);

-- Move every existing sign-in to the new table, attached to the member it belonged to.
-- Rows without a provider take it from authId ("provider:accountId"), or "unknown".
INSERT INTO "Identity" ("id", "authId", "provider", "email", "userId", "createdAt")
SELECT
    gen_random_uuid()::text,
    "authId",
    COALESCE("provider", NULLIF(split_part("authId", ':', 1), "authId"), 'unknown'),
    "email",
    "id",
    "createdAt"
FROM "User";

-- DropIndex
DROP INDEX "User_authId_key";

-- DropIndex
DROP INDEX "User_provider_providerAccountId_key";

-- AlterTable: sign-in details now live on Identity. instituteEmail is not
-- backfilled: the app sets it the next time the member signs in with a
-- provider that has verified the address.
ALTER TABLE "User" DROP COLUMN "authId",
DROP COLUMN "provider",
DROP COLUMN "providerAccountId",
ADD COLUMN     "instituteEmail" TEXT;

-- CreateEnum
CREATE TYPE "PlayerStatus" AS ENUM ('ACTIVE', 'CLOSED', 'CLOSED_FAIR_PLAY', 'MISSING', 'REMOVED');

-- AlterTable
ALTER TABLE "ChessProfile" ADD COLUMN     "chessComId" INTEGER,
ADD COLUMN     "missingSince" TIMESTAMP(3),
ADD COLUMN     "status" "PlayerStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "Identity_authId_key" ON "Identity"("authId");

-- CreateIndex
CREATE INDEX "Identity_userId_idx" ON "Identity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChessProfile_chessComId_key" ON "ChessProfile"("chessComId");

-- CreateIndex
CREATE UNIQUE INDEX "User_instituteEmail_key" ON "User"("instituteEmail");

-- AddForeignKey
ALTER TABLE "Identity" ADD CONSTRAINT "Identity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
