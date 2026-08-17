-- Meta documents these Instagram reactions: angry, sad, wow, love, like,
-- laugh, and other. Preserve dashboard symbols while normalizing API names.
UPDATE settings
SET value = json_set(
      value,
      '$.reaction',
      CASE key
        WHEN 'emoji.queued' THEN 'like'
        WHEN 'emoji.downloading' THEN 'like'
        WHEN 'emoji.synthesizing' THEN 'wow'
        WHEN 'emoji.complete' THEN 'love'
        WHEN 'emoji.error_download' THEN 'angry'
        WHEN 'emoji.error_media' THEN 'sad'
        WHEN 'emoji.error_transcript' THEN 'sad'
        WHEN 'emoji.error_research' THEN 'sad'
        WHEN 'emoji.error_archive' THEN 'angry'
        ELSE 'other'
      END
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE key LIKE 'emoji.%';
