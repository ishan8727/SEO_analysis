-- DropForeignKey
ALTER TABLE "Verification" DROP CONSTRAINT "Verification_leadId_fkey";

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "firebaseUid" TEXT;

-- DropTable
DROP TABLE "Verification";

-- CreateIndex
CREATE UNIQUE INDEX "Lead_scanId_phoneE164_key" ON "Lead"("scanId", "phoneE164");

