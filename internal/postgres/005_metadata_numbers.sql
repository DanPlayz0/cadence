ALTER TABLE suggestions DROP CONSTRAINT suggestions_field_check;
ALTER TABLE suggestions ADD CONSTRAINT suggestions_field_check
  CHECK (field IN ('title','artist','album','albumArtist','year','genre','number','disc','artwork'));
DROP INDEX tracks_browse_order;
CREATE INDEX tracks_browse_order ON tracks (
  lower(coalesce(overrides->>'albumArtist',album_artist)),
  lower(coalesce(overrides->>'album',album)),
  coalesce((overrides->>'disc')::integer,disc),
  coalesce((overrides->>'number')::integer,number),id
) WHERE available;
