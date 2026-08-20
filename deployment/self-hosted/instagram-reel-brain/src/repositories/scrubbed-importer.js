import { artifactLibraryPath, canonicalArtifactKey, slugify } from "../domain/artifacts.js";

export async function importScrubbedD1Export({ repository, objectStore, exportData }) {
  const imported = { jobs: 0, resources: 0, artifacts: 0 };
  for (const row of exportData.jobs || []) {
    const job = await repository.createJob({
      id: row.id,
      sourceUrl: row.source_url,
      canonicalUrl: row.canonical_url,
      shortcode: row.shortcode,
      dedupeKey: row.dedupe_key,
      senderId: row.sender_id,
      sourceMessageId: row.source_message_id,
      sourceMediaJson: row.source_media_json,
      instructions: row.instructions,
    });
    if (job) imported.jobs += 1;
  }

  for (const row of exportData.resources || []) {
    const artifactType = row.artifact_type || null;
    const canonicalKey = row.canonical_key || canonicalArtifactKey({ artifactType, name: row.name, canonicalUrl: row.canonical_url });
    await repository.upsertResource({
      id: row.id,
      jobId: row.job_id,
      name: row.name,
      slug: row.slug || slugify(row.name),
      kind: row.kind || "reference",
      canonicalUrl: row.canonical_url || null,
      summary: row.summary || null,
      whyUseful: row.why_useful || null,
      guideText: row.guide_text || null,
      artifactType,
      canonicalKey,
      mediaJson: row.media_json || null,
      libraryPath: row.library_path || artifactLibraryPath({ artifactType, name: row.name }),
    });
    imported.resources += 1;
  }

  for (const row of exportData.artifacts || []) {
    const written = await objectStore.put(row.object_key, row.content || "", { contentType: row.content_type || "text/plain" });
    await repository.recordArtifactWrite({
      jobId: row.job_id,
      key: written.key,
      checksum: written.checksum,
      byteLength: written.byteLength,
      contentType: written.contentType,
    });
    imported.artifacts += 1;
  }

  return imported;
}
