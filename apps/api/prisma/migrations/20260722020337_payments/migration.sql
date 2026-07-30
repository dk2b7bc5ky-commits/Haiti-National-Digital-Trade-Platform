-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('CREATED', 'AUTHORIZED', 'ROUTING', 'PARTIALLY_SETTLED', 'SETTLED', 'FAILED', 'REVERSING');

-- CreateEnum
CREATE TYPE "PaymentRoutingStatus" AS ENUM ('PENDING', 'SETTLED', 'FAILED', 'REVERSED');

-- AlterTable
ALTER TABLE "charges" ADD COLUMN     "payment_request_id" TEXT;

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" TEXT NOT NULL,
    "base_currency" TEXT NOT NULL,
    "quote_currency" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'mock',
    "effective_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "container_id" TEXT NOT NULL,
    "importer_org_id" TEXT NOT NULL,
    "settlement_currency" TEXT NOT NULL,
    "gross_amount_settlement" INTEGER NOT NULL,
    "rezo_fee" INTEGER NOT NULL,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'CREATED',
    "rail_ref" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorized_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_routings" (
    "id" TEXT NOT NULL,
    "payment_request_id" TEXT NOT NULL,
    "payee_org_id" TEXT NOT NULL,
    "charge_currency" TEXT NOT NULL,
    "charge_amount" INTEGER NOT NULL,
    "fx_rate" DOUBLE PRECISION NOT NULL,
    "settlement_amount" INTEGER NOT NULL,
    "rail" TEXT NOT NULL,
    "rail_txn_ref" TEXT,
    "status" "PaymentRoutingStatus" NOT NULL DEFAULT 'PENDING',
    "is_rezo_fee" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_routings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fx_rates_base_currency_quote_currency_effective_at_idx" ON "fx_rates"("base_currency", "quote_currency", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_idempotency_key_key" ON "payment_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_requests_container_id_idx" ON "payment_requests"("container_id");

-- CreateIndex
CREATE INDEX "payment_requests_importer_org_id_idx" ON "payment_requests"("importer_org_id");

-- CreateIndex
CREATE INDEX "payment_routings_payment_request_id_idx" ON "payment_routings"("payment_request_id");

-- CreateIndex
CREATE INDEX "payment_routings_status_idx" ON "payment_routings"("status");

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_routings" ADD CONSTRAINT "payment_routings_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
