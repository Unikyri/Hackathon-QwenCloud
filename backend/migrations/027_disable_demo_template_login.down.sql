-- Irreversible security migration: do not restore a shared template login or
-- JWT-shaped session values when rolling back development migrations.
SELECT 1;
