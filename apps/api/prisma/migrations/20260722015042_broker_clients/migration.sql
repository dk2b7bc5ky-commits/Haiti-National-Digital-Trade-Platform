-- CreateTable
CREATE TABLE "broker_clients" (
    "id" TEXT NOT NULL,
    "broker_org_id" TEXT NOT NULL,
    "importer_org_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broker_clients_broker_org_id_idx" ON "broker_clients"("broker_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "broker_clients_broker_org_id_importer_org_id_key" ON "broker_clients"("broker_org_id", "importer_org_id");
