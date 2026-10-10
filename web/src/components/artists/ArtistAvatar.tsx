// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import { Artwork } from "../ui/Artwork";

export function ArtistAvatar({
  name,
  image,
}: {
  name: string;
  image?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  return image && !failed ? (
    <img
      className="artist-grid-avatar"
      src={image}
      alt={`${name} artist avatar`}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <Artwork id="" label={name} />
  );
}
