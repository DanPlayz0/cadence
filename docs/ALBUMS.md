# Album grouping and moving songs

Albums use the current catalog album title and album artist, falling back to the song's artist if the album artist is blank. Matching ignores case and surrounding whitespace. Songs in different folders with the same album and artist appear together; the same title by different artists remains separate. Existing catalog entries regroup immediately, without rescanning.

As an administrator, open a song's actions menu, choose **Edit metadata / artwork…**, then **Move to album…**. Search for the destination, select it, and choose **Move song**. Save or discard unsaved metadata edits before moving.

Moving immediately applies both the destination's album title and album artist. Other song metadata and the music file stay intact. The assignment survives rescans. To undo a move, move the song back or restore its extracted album and album artist in the editor. Empty albums disappear from the album list automatically. Songs classified as singles can also move into an album.

Album lists and destinations respect library exclusions. Existing exclusions using extracted album IDs remain supported; newly selected album exclusions apply to the complete metadata group.
