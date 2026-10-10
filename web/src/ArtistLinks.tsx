// SPDX-License-Identifier: GPL-2.0-or-later
import { Fragment } from "react";
import { artistNames } from "./artists";
import { routeURL } from "./navigation";

export function ArtistLinks({
  credit,
  onNavigate,
  single = false,
  featuredArtists = "",
  videoGuests = "",
}: {
  credit: string;
  featuredArtists?: string;
  videoGuests?: string;
  onNavigate: (name: string) => void;
  single?: boolean;
}) {
  return (
    <span className="artist-links">
      {artistNames(credit).map((name, i) => (
        <Fragment key={name}>
          {i > 0 && ", "}
          <a
            href={routeURL({ view: "artist", artist: name })}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              onNavigate(name);
            }}
          >
            {name}
          </a>
        </Fragment>
      ))}
      {featuredArtists.trim() && (
        <>
          {" "}
          · feat.{" "}
          <ArtistLinks credit={featuredArtists} onNavigate={onNavigate} />
        </>
      )}
      {videoGuests.trim() && (
        <>
          {" "}
          · Video guests:{" "}
          <ArtistLinks credit={videoGuests} onNavigate={onNavigate} />
        </>
      )}
      {single && <span className="single-label"> · Single</span>}
    </span>
  );
}
