-- Instagram's outbound message-reaction endpoint accepts love for this account.
-- Other stage icons remain dashboard-only and must never trigger API calls.
UPDATE settings
SET value = json_set(value, '$.reaction', 'love'),
    updated_at = CURRENT_TIMESTAMP
WHERE key LIKE 'emoji.%';
