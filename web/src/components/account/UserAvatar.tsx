// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import type { User } from "../../services/api";

export function UserAvatar({
  user,
  fallback = "initial",
}: {
  user: User;
  fallback?: "initial" | "icon";
}) {
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
      ) : fallback === "icon" ? (
        <UserRound size={64} strokeWidth={1.5} />
      ) : (
        user.displayName.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
