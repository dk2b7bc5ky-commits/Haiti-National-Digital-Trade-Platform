-- CreateEnum
CREATE TYPE "DeadlineType" AS ENUM ('LAST_FREE_DAY', 'ACCRUAL_START');

-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "deadlines" (
    "id" TEXT NOT NULL,
    "container_id" TEXT NOT NULL,
    "payee_org_id" TEXT NOT NULL,
    "type" "DeadlineType" NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "alert_schedule" INTEGER[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deadline_alerts" (
    "id" TEXT NOT NULL,
    "deadline_id" TEXT NOT NULL,
    "container_id" TEXT NOT NULL,
    "recipient_org_id" TEXT NOT NULL,
    "channel" "AlertChannel" NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deadline_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deadlines_container_id_idx" ON "deadlines"("container_id");

-- CreateIndex
CREATE UNIQUE INDEX "deadlines_container_id_payee_org_id_type_key" ON "deadlines"("container_id", "payee_org_id", "type");

-- CreateIndex
CREATE INDEX "deadline_alerts_status_scheduled_for_idx" ON "deadline_alerts"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "deadline_alerts_recipient_org_id_status_idx" ON "deadline_alerts"("recipient_org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "deadline_alerts_deadline_id_channel_offset_days_key" ON "deadline_alerts"("deadline_id", "channel", "offset_days");

-- AddForeignKey
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline_alerts" ADD CONSTRAINT "deadline_alerts_deadline_id_fkey" FOREIGN KEY ("deadline_id") REFERENCES "deadlines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline_alerts" ADD CONSTRAINT "deadline_alerts_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
