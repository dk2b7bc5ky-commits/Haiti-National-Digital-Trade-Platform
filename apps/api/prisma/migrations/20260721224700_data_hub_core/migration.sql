-- CreateEnum
CREATE TYPE "ManifestStatus" AS ENUM ('SUBMITTED', 'PROCESSED');

-- CreateEnum
CREATE TYPE "ContainerSize" AS ENUM ('TWENTY', 'FORTY', 'REEFER');

-- CreateEnum
CREATE TYPE "ContainerStatus" AS ENUM ('ARRIVED', 'CLEARED', 'RELEASED', 'GATED_OUT');

-- CreateTable
CREATE TABLE "vessels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imo" TEXT NOT NULL,
    "line_org_id" TEXT NOT NULL,

    CONSTRAINT "vessels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voyages" (
    "id" TEXT NOT NULL,
    "vessel_id" TEXT NOT NULL,
    "voyage_number" TEXT NOT NULL,
    "eta" TIMESTAMP(3) NOT NULL,
    "port" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voyages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifests" (
    "id" TEXT NOT NULL,
    "voyage_id" TEXT NOT NULL,
    "submitted_by_org_id" TEXT NOT NULL,
    "status" "ManifestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "raw_ref" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manifests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills_of_lading" (
    "id" TEXT NOT NULL,
    "manifest_id" TEXT NOT NULL,
    "bl_number" TEXT NOT NULL,
    "shipper" TEXT NOT NULL,
    "importer_org_id" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "bills_of_lading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "containers" (
    "id" TEXT NOT NULL,
    "bl_id" TEXT NOT NULL,
    "container_number" TEXT NOT NULL,
    "size_type" "ContainerSize" NOT NULL,
    "importer_org_id" TEXT NOT NULL,
    "terminal_org_id" TEXT,
    "arrival_date" TIMESTAMP(3),
    "status" "ContainerStatus" NOT NULL DEFAULT 'ARRIVED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "containers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vessels_imo_key" ON "vessels"("imo");

-- CreateIndex
CREATE INDEX "vessels_line_org_id_idx" ON "vessels"("line_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "voyages_vessel_id_voyage_number_key" ON "voyages"("vessel_id", "voyage_number");

-- CreateIndex
CREATE INDEX "manifests_submitted_by_org_id_idx" ON "manifests"("submitted_by_org_id");

-- CreateIndex
CREATE INDEX "manifests_voyage_id_idx" ON "manifests"("voyage_id");

-- CreateIndex
CREATE UNIQUE INDEX "bills_of_lading_bl_number_key" ON "bills_of_lading"("bl_number");

-- CreateIndex
CREATE INDEX "bills_of_lading_manifest_id_idx" ON "bills_of_lading"("manifest_id");

-- CreateIndex
CREATE INDEX "bills_of_lading_importer_org_id_idx" ON "bills_of_lading"("importer_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "containers_container_number_key" ON "containers"("container_number");

-- CreateIndex
CREATE INDEX "containers_bl_id_idx" ON "containers"("bl_id");

-- CreateIndex
CREATE INDEX "containers_importer_org_id_idx" ON "containers"("importer_org_id");

-- CreateIndex
CREATE INDEX "containers_terminal_org_id_idx" ON "containers"("terminal_org_id");

-- CreateIndex
CREATE INDEX "containers_status_idx" ON "containers"("status");

-- AddForeignKey
ALTER TABLE "vessels" ADD CONSTRAINT "vessels_line_org_id_fkey" FOREIGN KEY ("line_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voyages" ADD CONSTRAINT "voyages_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_voyage_id_fkey" FOREIGN KEY ("voyage_id") REFERENCES "voyages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_submitted_by_org_id_fkey" FOREIGN KEY ("submitted_by_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills_of_lading" ADD CONSTRAINT "bills_of_lading_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "manifests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills_of_lading" ADD CONSTRAINT "bills_of_lading_importer_org_id_fkey" FOREIGN KEY ("importer_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "containers" ADD CONSTRAINT "containers_bl_id_fkey" FOREIGN KEY ("bl_id") REFERENCES "bills_of_lading"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "containers" ADD CONSTRAINT "containers_importer_org_id_fkey" FOREIGN KEY ("importer_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "containers" ADD CONSTRAINT "containers_terminal_org_id_fkey" FOREIGN KEY ("terminal_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
