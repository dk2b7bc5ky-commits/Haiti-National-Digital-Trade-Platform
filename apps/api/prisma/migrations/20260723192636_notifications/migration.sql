-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DEADLINE_REMINDER', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'CONTAINER_RELEASED', 'GATE_APPOINTMENT_CONFIRMED', 'GATE_REMINDER', 'VERIFICATION_NEEDED', 'CHARGE_ADDED', 'DOCUMENT_REQUIRED', 'TRUCKING_JOB_OFFERED', 'TRUCKING_JOB_ACCEPTED', 'TRUCKING_JOB_DELIVERED');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('CRITICAL', 'SOON', 'INFO');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notify_quiet_end" INTEGER,
ADD COLUMN     "notify_quiet_start" INTEGER;

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "recipient_org_id" TEXT NOT NULL,
    "recipient_user_id" TEXT,
    "container_id" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "amount_at_risk" INTEGER,
    "amount_currency" TEXT,
    "channel" "AlertChannel" NOT NULL DEFAULT 'IN_APP',
    "deep_link" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_channel_read_at_idx" ON "notifications"("recipient_user_id", "channel", "read_at");

-- CreateIndex
CREATE INDEX "notifications_recipient_org_id_idx" ON "notifications"("recipient_org_id");

-- CreateIndex
CREATE INDEX "notifications_container_id_idx" ON "notifications"("container_id");

-- CreateIndex
CREATE INDEX "notification_preferences_user_id_idx" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_type_key" ON "notification_preferences"("user_id", "type");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
