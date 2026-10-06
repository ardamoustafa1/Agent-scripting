-- CreateEnum
CREATE TYPE "service_client_auth_method" AS ENUM ('client_secret_basic', 'client_secret_post', 'tls_client_auth');

-- CreateEnum
CREATE TYPE "service_client_status" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "local_credential_status" AS ENUM ('pending_mfa', 'active', 'disabled');

-- DropIndex
DROP INDEX "user_roles_user_role_active_key";

-- AlterTable
ALTER TABLE "user_roles" ADD COLUMN     "source" VARCHAR(64) NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_login_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "idp_id" UUID NOT NULL,
    "subject" VARCHAR(512) NOT NULL,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(128) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" VARCHAR(128) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_provider_domains" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "idp_id" UUID NOT NULL,
    "domain" VARCHAR(253) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(128) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" VARCHAR(128) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "identity_provider_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "idp_id" UUID,
    "external_id" TEXT,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(128) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" VARCHAR(128) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(128) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" VARCHAR(128) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_tokens" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "idp_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(128) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" VARCHAR(128) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "scim_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_clients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "auth_method" "service_client_auth_method" NOT NULL,
    "secret_hash" CHAR(64),
    "certificate_thumbprint" VARCHAR(64),
    "scopes" TEXT[],
    "status" "service_client_status" NOT NULL DEFAULT 'active',
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(128) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" VARCHAR(128) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "service_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_credentials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "totp_secret" TEXT NOT NULL,
    "totp_last_step" BIGINT,
    "status" "local_credential_status" NOT NULL DEFAULT 'pending_mfa',
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(128) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" VARCHAR(128) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "local_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_identities_tenant_id_user_id_idx" ON "user_identities"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_idp_subject_active_key" ON "user_identities"("tenant_id", "idp_id", "subject") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "identity_provider_domains_tenant_id_idp_id_idx" ON "identity_provider_domains"("tenant_id", "idp_id");

-- CreateIndex
CREATE UNIQUE INDEX "identity_provider_domains_domain_active_key" ON "identity_provider_domains"("domain") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "groups_tenant_id_created_at_id_idx" ON "groups"("tenant_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "groups_tenant_display_name_active_key" ON "groups"("tenant_id", "display_name") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "group_members_tenant_id_user_id_idx" ON "group_members"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_group_user_active_key" ON "group_members"("group_id", "user_id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "scim_tokens_tenant_id_idp_id_idx" ON "scim_tokens"("tenant_id", "idp_id");

-- CreateIndex
CREATE UNIQUE INDEX "scim_tokens_token_hash_key" ON "scim_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "service_clients_tenant_id_created_at_id_idx" ON "service_clients"("tenant_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_clients_tenant_name_active_key" ON "service_clients"("tenant_id", "name") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "local_credentials_tenant_id_created_at_id_idx" ON "local_credentials"("tenant_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "local_credentials_user_key" ON "local_credentials"("user_id");

-- CreateIndex
CREATE INDEX "user_roles_tenant_id_user_id_idx" ON "user_roles"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_role_source_active_key" ON "user_roles"("user_id", "role_id", "source") WHERE (deleted_at IS NULL);

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_idp_id_fkey" FOREIGN KEY ("idp_id") REFERENCES "identity_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_provider_domains" ADD CONSTRAINT "identity_provider_domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_provider_domains" ADD CONSTRAINT "identity_provider_domains_idp_id_fkey" FOREIGN KEY ("idp_id") REFERENCES "identity_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_idp_id_fkey" FOREIGN KEY ("idp_id") REFERENCES "identity_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_tokens" ADD CONSTRAINT "scim_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_tokens" ADD CONSTRAINT "scim_tokens_idp_id_fkey" FOREIGN KEY ("idp_id") REFERENCES "identity_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_clients" ADD CONSTRAINT "service_clients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_credentials" ADD CONSTRAINT "local_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_credentials" ADD CONSTRAINT "local_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

