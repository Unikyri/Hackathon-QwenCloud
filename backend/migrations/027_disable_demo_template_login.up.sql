-- Disable the legacy shared demo credential in already-migrated databases.
-- The template account remains only as the source of clone data; it is never
-- a visitor identity. Also remove JWT-shaped values accidentally persisted by
-- the legacy client as demo session IDs.
UPDATE users
SET password_hash = '!',
    display_name = 'Internal Demo Template',
    updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000001';

UPDATE universes
SET session_id = NULL,
    updated_at = NOW()
WHERE session_id ~ '^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$';
