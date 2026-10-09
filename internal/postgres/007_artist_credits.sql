-- Keep source metadata intact while exposing each comma-separated performer.
CREATE FUNCTION artist_names(credit text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(name ORDER BY first_position), ARRAY['Unknown artist'])
  FROM (
    SELECT regexp_replace(piece, '^[[:space:]]+|[[:space:]]+$', '', 'g') AS name,
           min(ordinality) AS first_position
    FROM unnest(string_to_array(coalesce(credit, ''), ',')) WITH ORDINALITY AS parts(piece, ordinality)
    GROUP BY 1
    HAVING regexp_replace(piece, '^[[:space:]]+|[[:space:]]+$', '', 'g') <> ''
  ) AS names
$$;
CREATE INDEX tracks_artist_names ON tracks USING gin(artist_names(coalesce(overrides->>'artist',artist))) WHERE available;
