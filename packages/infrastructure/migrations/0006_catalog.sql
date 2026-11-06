-- 0006_catalog.sql: Products, Product Fact Sets, Product Facts, and Affiliate Destinations
-- Forward-only schema for catalog domain with composite tenant-safe constraints and PostgreSQL-enforced fact immutability.

CREATE TABLE products (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  merchant_name TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  canonical_url_hash BYTEA NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  audience_notes TEXT NULL,
  allowed_claims_notes TEXT NULL,
  prohibited_claims_notes TEXT NULL,
  status TEXT NOT NULL,
  current_fact_set_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT products_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT products_status_check CHECK (status IN ('draft', 'active', 'archived')),
  CONSTRAINT products_version_check CHECK (version >= 1),
  CONSTRAINT products_updated_at_check CHECK (updated_at >= created_at),
  CONSTRAINT products_name_check CHECK (char_length(name) BETWEEN 1 AND 256 AND name = btrim(name) AND name !~ '[[:cntrl:]]'),
  CONSTRAINT products_merchant_name_check CHECK (char_length(merchant_name) BETWEEN 1 AND 256 AND merchant_name = btrim(merchant_name) AND merchant_name !~ '[[:cntrl:]]'),
  CONSTRAINT products_category_check CHECK (char_length(category) BETWEEN 1 AND 128 AND category = btrim(category) AND category !~ '[[:cntrl:]]'),
  CONSTRAINT products_description_check CHECK (char_length(description) BETWEEN 1 AND 10000 AND description = btrim(description)),
  CONSTRAINT products_audience_notes_check CHECK (audience_notes IS NULL OR (char_length(audience_notes) <= 5000 AND audience_notes = btrim(audience_notes))),
  CONSTRAINT products_allowed_claims_notes_check CHECK (allowed_claims_notes IS NULL OR (char_length(allowed_claims_notes) <= 5000 AND allowed_claims_notes = btrim(allowed_claims_notes))),
  CONSTRAINT products_prohibited_claims_notes_check CHECK (prohibited_claims_notes IS NULL OR (char_length(prohibited_claims_notes) <= 5000 AND prohibited_claims_notes = btrim(prohibited_claims_notes))),
  CONSTRAINT products_canonical_url_check CHECK (char_length(canonical_url) BETWEEN 1 AND 2048 AND canonical_url = btrim(canonical_url) AND canonical_url !~ '[[:cntrl:]]'),
  CONSTRAINT products_canonical_url_hash_len CHECK (octet_length(canonical_url_hash) = 32)
);

CREATE INDEX idx_products_workspace_cursor ON products (workspace_id, updated_at DESC, id DESC);
CREATE INDEX idx_products_workspace_status ON products (workspace_id, status, updated_at DESC, id DESC);
CREATE INDEX idx_products_workspace_url_hash ON products (workspace_id, canonical_url_hash);

CREATE TABLE product_fact_sets (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_by_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT product_fact_sets_workspace_product_fk FOREIGN KEY (workspace_id, product_id) REFERENCES products(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT product_fact_sets_product_revision_unique UNIQUE (product_id, revision_number),
  CONSTRAINT product_fact_sets_workspace_product_id_unique UNIQUE (workspace_id, product_id, id),
  CONSTRAINT product_fact_sets_status_check CHECK (status IN ('proposed', 'confirmed')),
  CONSTRAINT product_fact_sets_revision_number_check CHECK (revision_number >= 1),
  CONSTRAINT product_fact_sets_version_check CHECK (version >= 1),
  CONSTRAINT product_fact_sets_updated_at_check CHECK (updated_at >= created_at),
  CONSTRAINT product_fact_sets_summary_check CHECK (summary IS NULL OR (char_length(summary) <= 2048 AND summary = btrim(summary))),
  CONSTRAINT product_fact_sets_confirmation_check CHECK (
    (status = 'proposed' AND confirmed_by_user_id IS NULL AND confirmed_at IS NULL) OR
    (status = 'confirmed' AND confirmed_by_user_id IS NOT NULL AND confirmed_at IS NOT NULL AND confirmed_at >= created_at)
  )
);

CREATE INDEX idx_product_fact_sets_product ON product_fact_sets (product_id, revision_number DESC);
CREATE INDEX idx_product_fact_sets_workspace ON product_fact_sets (workspace_id, product_id, revision_number DESC);

-- Composite tenant-safe FK linking product current_fact_set_id to product_fact_sets
ALTER TABLE products
  ADD CONSTRAINT products_current_fact_set_fk
  FOREIGN KEY (workspace_id, id, current_fact_set_id)
  REFERENCES product_fact_sets(workspace_id, product_id, id)
  ON DELETE RESTRICT;

CREATE TABLE product_facts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL,
  fact_set_id UUID NOT NULL,
  fact_key TEXT NOT NULL,
  value_text TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT NULL,
  source_excerpt TEXT NULL,
  confidence TEXT NOT NULL,
  claim_usage TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT product_facts_workspace_product_fact_set_fk FOREIGN KEY (workspace_id, product_id, fact_set_id) REFERENCES product_fact_sets(workspace_id, product_id, id) ON DELETE RESTRICT,
  CONSTRAINT product_facts_fact_set_key_unique UNIQUE (fact_set_id, fact_key),
  CONSTRAINT product_facts_source_type_check CHECK (source_type IN ('user', 'merchant_page', 'document', 'other')),
  CONSTRAINT product_facts_confidence_check CHECK (confidence IN ('confirmed', 'suggested', 'uncertain')),
  CONSTRAINT product_facts_claim_usage_check CHECK (claim_usage IN ('allowed', 'context_only', 'prohibited')),
  CONSTRAINT product_facts_fact_key_check CHECK (char_length(fact_key) BETWEEN 1 AND 128 AND fact_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  CONSTRAINT product_facts_value_text_check CHECK (char_length(value_text) BETWEEN 1 AND 10000 AND value_text = btrim(value_text)),
  CONSTRAINT product_facts_source_url_check CHECK (source_url IS NULL OR (char_length(source_url) BETWEEN 1 AND 2048 AND source_url = btrim(source_url) AND source_url !~ '[[:cntrl:]]')),
  CONSTRAINT product_facts_source_excerpt_check CHECK (source_excerpt IS NULL OR (char_length(source_excerpt) BETWEEN 1 AND 2048 AND source_excerpt = btrim(source_excerpt)))
);

CREATE INDEX idx_product_facts_set ON product_facts (fact_set_id);
CREATE INDEX idx_product_facts_workspace_set ON product_facts (workspace_id, fact_set_id);

CREATE TABLE affiliate_destinations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  network_name TEXT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT affiliate_destinations_workspace_product_fk FOREIGN KEY (workspace_id, product_id) REFERENCES products(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT affiliate_destinations_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT affiliate_destinations_version_check CHECK (version >= 1),
  CONSTRAINT affiliate_destinations_updated_at_check CHECK (updated_at >= created_at),
  CONSTRAINT affiliate_destinations_label_check CHECK (char_length(label) BETWEEN 1 AND 256 AND label = btrim(label) AND label !~ '[[:cntrl:]]'),
  CONSTRAINT affiliate_destinations_network_name_check CHECK (network_name IS NULL OR (char_length(network_name) BETWEEN 1 AND 128 AND network_name = btrim(network_name) AND network_name !~ '[[:cntrl:]]')),
  CONSTRAINT affiliate_destinations_url_check CHECK (char_length(url) BETWEEN 1 AND 2048 AND url = btrim(url) AND url !~ '[[:cntrl:]]')
);

CREATE INDEX idx_affiliate_destinations_workspace_product ON affiliate_destinations (workspace_id, product_id, status, updated_at DESC, id DESC);

-- PostgreSQL-enforced fact set and fact immutability triggers
CREATE OR REPLACE FUNCTION enforce_product_fact_set_immutability() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'confirmed' THEN
      RAISE EXCEPTION 'confirmed product fact sets cannot be deleted' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'confirmed' THEN
      RAISE EXCEPTION 'confirmed product fact sets are immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.status = 'proposed' AND NEW.status = 'confirmed' THEN
      IF NEW.product_id <> OLD.product_id OR
         NEW.workspace_id <> OLD.workspace_id OR
         NEW.revision_number <> OLD.revision_number OR
         NEW.created_by_user_id <> OLD.created_by_user_id OR
         NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'immutable fields of product fact set cannot be changed during confirmation' USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_product_fact_sets_immutability
BEFORE UPDATE OR DELETE ON product_fact_sets
FOR EACH ROW EXECUTE FUNCTION enforce_product_fact_set_immutability();

CREATE OR REPLACE FUNCTION enforce_product_fact_immutability() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_fact_set_status TEXT;
  v_target_fact_set_id UUID;
  v_target_product_id UUID;
  v_target_workspace_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_target_fact_set_id := NEW.fact_set_id;
    v_target_product_id := NEW.product_id;
    v_target_workspace_id := NEW.workspace_id;
  ELSE
    v_target_fact_set_id := OLD.fact_set_id;
    v_target_product_id := OLD.product_id;
    v_target_workspace_id := OLD.workspace_id;
  END IF;

  SELECT status INTO v_fact_set_status
  FROM product_fact_sets
  WHERE id = v_target_fact_set_id
    AND product_id = v_target_product_id
    AND workspace_id = v_target_workspace_id
  FOR SHARE;

  IF v_fact_set_status = 'confirmed' THEN
    RAISE EXCEPTION 'facts in a confirmed fact set cannot be inserted, updated, or deleted' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW.fact_set_id <> OLD.fact_set_id OR NEW.product_id <> OLD.product_id OR NEW.workspace_id <> OLD.workspace_id) THEN
    SELECT status INTO v_fact_set_status
    FROM product_fact_sets
    WHERE id = NEW.fact_set_id
      AND product_id = NEW.product_id
      AND workspace_id = NEW.workspace_id
    FOR SHARE;

    IF v_fact_set_status = 'confirmed' THEN
      RAISE EXCEPTION 'cannot move fact into a confirmed fact set' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_product_facts_immutability
BEFORE INSERT OR UPDATE OR DELETE ON product_facts
FOR EACH ROW EXECUTE FUNCTION enforce_product_fact_immutability();

CREATE OR REPLACE FUNCTION check_product_current_fact_set() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NEW.current_fact_set_id IS NOT NULL THEN
    SELECT status INTO v_status
    FROM product_fact_sets
    WHERE id = NEW.current_fact_set_id
      AND product_id = NEW.id
      AND workspace_id = NEW.workspace_id
    FOR SHARE;

    IF v_status IS NULL OR v_status <> 'confirmed' THEN
      RAISE EXCEPTION 'current_fact_set_id must reference a confirmed fact set of the same product' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_products_current_fact_set
BEFORE INSERT OR UPDATE OF current_fact_set_id ON products
FOR EACH ROW EXECUTE FUNCTION check_product_current_fact_set();
