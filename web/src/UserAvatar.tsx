// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import type { User } from "./api";

export function UserAvatar({ user }: { user: User }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [user.id, user.avatarVersion]);
  return (
    <span className="user-avatar" aria-hidden="true">
      {user.avatar && !failed ? (
        <img
          src={`/api/v1/users/${encodeURIComponent(user.id)}/avatar?v=${user.avatarVersion}`}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        user.displayName.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
