-- CreateTable
CREATE TABLE "companion_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'win32',
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companion_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companion_devices_tokenHash_key" ON "companion_devices"("tokenHash");

-- CreateIndex
CREATE INDEX "companion_devices_userId_idx" ON "companion_devices"("userId");

-- CreateIndex
CREATE INDEX "companion_devices_tokenHash_idx" ON "companion_devices"("tokenHash");

-- CreateIndex
CREATE INDEX "companion_devices_revokedAt_idx" ON "companion_devices"("revokedAt");

-- AddForeignKey
ALTER TABLE "companion_devices" ADD CONSTRAINT "companion_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
