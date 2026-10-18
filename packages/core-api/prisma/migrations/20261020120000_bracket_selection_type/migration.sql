-- Bracket pools (#721): a PREDICTION contest can be played with the BRACKET selection type, an
-- entry's pick of every game of a knockout event before it starts.

-- AlterEnum
ALTER TYPE "PrismaSelectionType" ADD VALUE 'BRACKET';
