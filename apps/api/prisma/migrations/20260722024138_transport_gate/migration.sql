-- CreateEnum
CREATE TYPE "TransportJobStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GateAppointmentStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "transport_jobs" (
    "id" TEXT NOT NULL,
    "container_id" TEXT NOT NULL,
    "created_by_org_id" TEXT NOT NULL,
    "trucker_org_id" TEXT,
    "pickup" TEXT NOT NULL,
    "dropoff" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "TransportJobStatus" NOT NULL DEFAULT 'OFFERED',
    "insurance_ref" TEXT,
    "pod_ref" TEXT,
    "gps_lat" DOUBLE PRECISION,
    "gps_lng" DOUBLE PRECISION,
    "gps_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_appointments" (
    "id" TEXT NOT NULL,
    "container_id" TEXT NOT NULL,
    "trucker_org_id" TEXT NOT NULL,
    "terminal_org_id" TEXT,
    "slot_time" TIMESTAMP(3) NOT NULL,
    "status" "GateAppointmentStatus" NOT NULL DEFAULT 'REQUESTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gate_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transport_jobs_container_id_idx" ON "transport_jobs"("container_id");

-- CreateIndex
CREATE INDEX "transport_jobs_trucker_org_id_idx" ON "transport_jobs"("trucker_org_id");

-- CreateIndex
CREATE INDEX "transport_jobs_status_idx" ON "transport_jobs"("status");

-- CreateIndex
CREATE INDEX "gate_appointments_container_id_idx" ON "gate_appointments"("container_id");

-- CreateIndex
CREATE INDEX "gate_appointments_terminal_org_id_idx" ON "gate_appointments"("terminal_org_id");

-- CreateIndex
CREATE INDEX "gate_appointments_trucker_org_id_idx" ON "gate_appointments"("trucker_org_id");

-- AddForeignKey
ALTER TABLE "transport_jobs" ADD CONSTRAINT "transport_jobs_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_appointments" ADD CONSTRAINT "gate_appointments_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
