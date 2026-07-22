-- AlterTable
ALTER TABLE "containers" ADD COLUMN     "cleared_at" TIMESTAMP(3),
ADD COLUMN     "gated_out_at" TIMESTAMP(3),
ADD COLUMN     "released_at" TIMESTAMP(3);
