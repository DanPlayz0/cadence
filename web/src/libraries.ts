// SPDX-License-Identifier: GPL-2.0-or-later
export type LibrarySummary = { id: string; name: string };
export type MusicLibrary = LibrarySummary & {
  folders: string[];
  everyone: boolean;
  users: string[];
  groups: string[];
};

export function containsFolder(parent: string, child: string) {
  const base = parent.replace(/\/$/, "");
  return child === parent || child.startsWith(`${base}/`);
}

// A warning is conservative: any recipients not explicitly present in the draft
// may receive overlapping music through the other library.
export function broaderOverlaps(draft: MusicLibrary, others: MusicLibrary[]) {
  return others.filter(
    (other) =>
      other.id !== draft.id &&
      draft.folders.some((folder) =>
        other.folders.some(
          (path) =>
            containsFolder(folder, path) || containsFolder(path, folder),
        ),
      ) &&
      !draft.everyone &&
      (other.everyone ||
        other.users.some((id) => !draft.users.includes(id)) ||
        other.groups.some((id) => !draft.groups.includes(id))),
  );
}

export function catalogLibrary(view: string, libraryId?: string) {
  return view === "admin" ||
    view === "find" ||
    view === "likes" ||
    view === "history" ||
    view.startsWith("playlist:")
    ? ""
    : libraryId || "";
}
