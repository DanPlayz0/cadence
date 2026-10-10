// SPDX-License-Identifier: GPL-2.0-or-later
import React, { useEffect, useState } from "react";
import { Disc3 } from "lucide-react";
import { cover } from "../../services/api";

export function Artwork({
  id,
  label,
  has = false,
  className = "",
}: {
  id: string;
  label: string;
  has?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  const color = [...label].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className={`art ${className}`}
      style={{ "--hue": color } as React.CSSProperties}
    >
      {has && !failed ? (
        <img
          src={cover(id)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <Disc3 size={42} />
          <span>{label.slice(0, 1).toUpperCase()}</span>
        </>
      )}
    </div>
  );
}
