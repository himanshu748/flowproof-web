-- Run separately after the write succeeds: all inputs are now persisted in Tiger.
-- Lexical SQL plus normalized-vector cosine search; no pgvector claim.
WITH ranked AS (
  SELECT f.id, f.check_id, f.requirement, f.observed,
    (SELECT sum(a*b) FROM unnest(f.embedding,q.embedding) AS pair(a,b)) AS similarity
  FROM "flowproof_console_5324093d89d24b5eb3407bf99c997a41".failures f CROSS JOIN "flowproof_console_5324093d89d24b5eb3407bf99c997a41".queries q WHERE q.id='semantic'
), lexical AS (
  SELECT id,check_id,requirement,observed FROM "flowproof_console_5324093d89d24b5eb3407bf99c997a41".failures
  WHERE search @@ websearch_to_tsquery('english','horizontal')
), fingerprints AS (
  SELECT count(*)::int AS rows_read,
    bool_and(content_md5=md5(requirement || chr(10) || observed)) AS row_content_hashes_match,
    bool_and(array_length(embedding,1)=384) AS every_vector_has_384_dimensions,
    max(abs(1-(SELECT sum(x*x) FROM unnest(embedding) AS v(x)))) AS maximum_squared_norm_error
  FROM "flowproof_console_5324093d89d24b5eb3407bf99c997a41".failures
)
SELECT jsonb_build_object(
  'provider','Tiger Data',
  'transport','Authenticated provider HTTPS SQL console; direct application TLS adapter remains blocked',
  'schema','flowproof_console_5324093d89d24b5eb3407bf99c997a41',
  'sourceAuditSha256',(SELECT source_audit_sha256 FROM "flowproof_console_5324093d89d24b5eb3407bf99c997a41".provenance),
  'sourceAuditSha256Matches',(SELECT source_audit_sha256='07c53cfdc1fa38aa0ed15a38a5032892ab2212723b94cd2c121c5d9e63a2fe31' FROM "flowproof_console_5324093d89d24b5eb3407bf99c997a41".provenance),
  'fingerprints',(SELECT to_jsonb(fingerprints) FROM fingerprints),
  'lexicalQuery','horizontal',
  'lexicalResults',(SELECT jsonb_agg(to_jsonb(lexical) ORDER BY id) FROM lexical),
  'semanticQuery',(SELECT text FROM "flowproof_console_5324093d89d24b5eb3407bf99c997a41".queries WHERE id='semantic'),
  'semanticLexicalMatches',(SELECT count(*) FROM "flowproof_console_5324093d89d24b5eb3407bf99c997a41".failures f CROSS JOIN "flowproof_console_5324093d89d24b5eb3407bf99c997a41".queries q WHERE q.id='semantic' AND f.search @@ websearch_to_tsquery('english',q.text)),
  'vectorResults',(SELECT jsonb_agg(to_jsonb(ranked) ORDER BY similarity DESC,id) FROM ranked),
  'model',(SELECT embedding_model FROM "flowproof_console_5324093d89d24b5eb3407bf99c997a41".provenance),
  'modelDigest',(SELECT embedding_model_digest FROM "flowproof_console_5324093d89d24b5eb3407bf99c997a41".provenance)
) AS proof;
