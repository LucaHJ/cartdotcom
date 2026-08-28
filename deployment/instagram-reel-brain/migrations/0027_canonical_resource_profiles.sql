-- Every reusable entity receives the same stable identity and page across Reels.
-- Artefact identities retain their existing type prefix; ordinary resources use
-- their normalised resource kind. Existing per-Reel paths are preserved until
-- the bounded library reconciliation replaces them with navigational aliases.
UPDATE resources
SET canonical_key = CASE
  WHEN artifact_type IS NOT NULL AND artifact_type != '' THEN artifact_type || ':' || slug
  ELSE 'entity:' || slug
END
WHERE canonical_key IS NULL OR canonical_key = '';
