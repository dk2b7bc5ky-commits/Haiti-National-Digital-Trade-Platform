-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('CUSTOMS_DUTY', 'CUSTOMS_FEE', 'PORT_DUES', 'TERMINAL_HANDLING', 'STORAGE', 'DEMURRAGE', 'DETENTION', 'INSPECTION', 'SCANNING', 'REZO_FEE');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'PENDING_REVIEW', 'REQUESTED', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "ChargeSource" AS ENUM ('MANIFEST', 'ASYCUDA', 'OCTOPI', 'DOCUMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('NONE', 'PENDING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "PayeeType" AS ENUM ('CUSTOMS', 'PORT', 'TERMINAL', 'LINE', 'REZO', 'OTHER');

-- CreateTable
CREATE TABLE "payees" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PayeeType" NOT NULL,
    "settlement_ref" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charges" (
    "id" TEXT NOT NULL,
    "container_id" TEXT NOT NULL,
    "payee_org_id" TEXT NOT NULL,
    "type" "ChargeType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "due_date" TIMESTAMP(3),
    "last_free_day" TIMESTAMP(3),
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
    "review_state" "ReviewState" NOT NULL DEFAULT 'NONE',
    "source" "ChargeSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markets" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_currency" TEXT NOT NULL,
    "currencies" TEXT[],
    "languages" TEXT[],
    "tariff" JSONB NOT NULL,
    "enabled_modules" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payees_org_id_idx" ON "payees"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "payees_org_id_type_key" ON "payees"("org_id", "type");

-- CreateIndex
CREATE INDEX "charges_container_id_idx" ON "charges"("container_id");

-- CreateIndex
CREATE INDEX "charges_payee_org_id_idx" ON "charges"("payee_org_id");

-- CreateIndex
CREATE INDEX "charges_status_idx" ON "charges"("status");

-- CreateIndex
CREATE UNIQUE INDEX "markets_code_key" ON "markets"("code");

-- AddForeignKey
ALTER TABLE "payees" ADD CONSTRAINT "payees_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_payee_org_id_fkey" FOREIGN KEY ("payee_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
