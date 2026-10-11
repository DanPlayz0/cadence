-- Parse featuring credits without changing source metadata or requiring a rescan.
CREATE OR REPLACE FUNCTION artist_names(credit text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(name ORDER BY first_position), ARRAY['Unknown artist'])
  FROM (
    SELECT regexp_replace(piece, '^[[:space:]]+|[[:space:]]+$', '', 'g') AS name,
           min(ordinality) AS first_position
    FROM unnest(regexp_split_to_array(coalesce(credit, ''), ',|[[:space:]]+(feat\.?|ft\.?|featuring)[[:space:]]+', 'i')) WITH ORDINALITY AS parts(piece, ordinality)
    GROUP BY 1
    HAVING regexp_replace(piece, '^[[:space:]]+|[[:space:]]+$', '', 'g') <> ''
  ) AS names
$$;
-- Function changes do not automatically update previously indexed values.
REINDEX INDEX tracks_artist_names;
