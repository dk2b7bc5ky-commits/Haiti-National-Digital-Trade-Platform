-- CreateEnum
CREATE TYPE "MailAutonomy" AS ENUM ('REVIEW_ALL', 'AUTO_CONTAINER', 'AUTO_ALL');

-- CreateEnum
CREATE TYPE "MailIntakeStatus" AS ENUM ('PENDING', 'IGNORED', 'PROCESSED', 'NEEDS_REVIEW', 'CONFIRMED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "mailbox_connections" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "host" TEXT NOT NULL DEFAULT 'imap.gmail.com',
    "port" INTEGER NOT NULL DEFAULT 993,
    "use_tls" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT NOT NULL,
    "secret_env_var" TEXT NOT NULL DEFAULT 'MAIL_INTAKE_PASSWORD',
    "folder" TEXT NOT NULL DEFAULT 'INBOX',
    "autonomy" "MailAutonomy" NOT NULL DEFAULT 'AUTO_CONTAINER',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "last_uid" INTEGER,
    "last_checked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailbox_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_intake_messages" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "uid" INTEGER,
    "from_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "status" "MailIntakeStatus" NOT NULL DEFAULT 'PENDING',
    "classification" TEXT,
    "attachment_count" INTEGER NOT NULL DEFAULT 0,
    "extracted" JSONB,
    "confidence" DOUBLE PRECISION,
    "container_id" TEXT,
    "document_ids" TEXT[],
    "charge_ids" TEXT[],
    "error" TEXT,
    "processed_at" TIMESTAMP(3),
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_intake_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mailbox_connections_org_id_idx" ON "mailbox_connections"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_connections_org_id_address_key" ON "mailbox_connections"("org_id", "address");

-- CreateIndex
CREATE INDEX "mail_intake_messages_org_id_status_idx" ON "mail_intake_messages"("org_id", "status");

-- CreateIndex
CREATE INDEX "mail_intake_messages_container_id_idx" ON "mail_intake_messages"("container_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_intake_messages_connection_id_message_id_key" ON "mail_intake_messages"("connection_id", "message_id");

-- AddForeignKey
ALTER TABLE "mailbox_connections" ADD CONSTRAINT "mailbox_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_intake_messages" ADD CONSTRAINT "mail_intake_messages_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "mailbox_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
