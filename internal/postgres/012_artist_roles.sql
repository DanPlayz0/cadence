-- Curated role credits survive library rescans.
ALTER TABLE suggestions DROP CONSTRAINT suggestions_field_check;
ALTER TABLE suggestions ADD CONSTRAINT suggestions_field_check CHECK (field IN ('title','artist','featuredArtists','videoGuests','album','albumArtist','year','genre','number','disc','artwork'));
ALTER TABLE tracks DROP COLUMN search;
ALTER TABLE tracks ADD COLUMN search tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(overrides->>'title',title)||' '||coalesce(overrides->>'artist',artist)||' '||coalesce(overrides->>'featuredArtists','')||' '||coalesce(overrides->>'videoGuests','')||' '||coalesce(overrides->>'album',album)||' '||coalesce(overrides->>'albumArtist',album_artist))) STORED;
CREATE INDEX tracks_search ON tracks USING gin(search);
