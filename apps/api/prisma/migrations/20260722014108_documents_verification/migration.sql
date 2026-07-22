-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('UPLOAD', 'EMAIL');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('TERMINAL_INVOICE', 'CUSTOMS_DECLARATION', 'BILL_OF_LADING', 'OTHER');

-- CreateEnum
CREATE TYPE "DocVerificationStatus" AS ENUM ('PROCESSING', 'EXTRACTED', 'NEEDS_REVIEW', 'VERIFIED');

-- CreateEnum
CREATE TYPE "VerificationTaskStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "container_id" TEXT,
    "uploaded_by_org_id" TEXT NOT NULL,
    "source" "DocumentSource" NOT NULL DEFAULT 'UPLOAD',
    "doc_type" "DocType" NOT NULL DEFAULT 'OTHER',
    "language" TEXT NOT NULL DEFAULT 'fr',
    "file_ref" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "raw_text" TEXT,
    "extraction_confidence" DOUBLE PRECISION,
    "verification_status" "DocVerificationStatus" NOT NULL DEFAULT 'PROCESSING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tasks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT,
    "charge_id" TEXT,
    "container_id" TEXT,
    "field" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "VerificationTaskStatus" NOT NULL DEFAULT 'OPEN',
    "before_value" JSONB,
    "after_value" JSONB,
    "resolved_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "verification_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_container_id_idx" ON "documents"("container_id");

-- CreateIndex
CREATE INDEX "verification_tasks_status_idx" ON "verification_tasks"("status");

-- CreateIndex
CREATE INDEX "verification_tasks_document_id_idx" ON "verification_tasks"("document_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tasks" ADD CONSTRAINT "verification_tasks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
