-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'EMAIL_SUMMARY';

-- AlterTable
ALTER TABLE "mail_intake_messages" ADD COLUMN     "action_required" TEXT,
ADD COLUMN     "demands_payment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "doc_kind" TEXT,
ADD COLUMN     "summary" TEXT;
