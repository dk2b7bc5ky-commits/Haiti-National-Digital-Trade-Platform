-- CreateTable
CREATE TABLE "SchemaMarker" (
    "id" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT 'rezo scaffold marker — replaced by real models in step 2',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchemaMarker_pkey" PRIMARY KEY ("id")
);
