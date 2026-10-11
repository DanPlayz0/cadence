// SPDX-License-Identifier: GPL-2.0-or-later
import {
  CollapsibleContent,
  Collapsible,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { useState } from "react";
import { Button } from "../ui/button";
import {
  MetadataChooser,
  metadataFields,
  type Suggestion,
} from "./MetadataChooser";
export function SuggestionReview({
  suggestions,
  busy,
  onApplied,
  onDismiss,
}: {
  suggestions: Suggestion[];
  busy: boolean;
  onApplied: () => Promise<void>;
  onDismiss: (id: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const songs = new Map<string, Suggestion[]>();
  for (const s of suggestions)
    songs.set(s.trackId, [...(songs.get(s.trackId) || []), s]);
  return (
    <>
      <div className="song-suggestion-list">
        {[...songs].map(([id, items]) => (
          <article className="song-suggestion-card" key={id}>
            <div className="row">
              <h3>{items[0].title}</h3>
              <Button disabled={busy} onClick={() => setSelected(id)}>
                Choose metadata
              </Button>
            </div>
            <p className="muted">
              {[
                ...new Set(
                  items.map((s) => metadataFields[s.field] || s.field),
                ),
              ].join(" · ")}
            </p>
            <Collapsible>
              <CollapsibleTrigger>
                View loaded suggestions ({items.length})
              </CollapsibleTrigger>
              <CollapsibleContent>
                {items.map((s) => (
                  <div className="suggestion" key={s.id}>
                    <div>
                      <strong>{metadataFields[s.field] || s.field}</strong>
                      {s.field === "artwork" ? (
                        <img
                          className="suggestion-art"
                          src={`/api/v1/admin/suggestions/${s.id}/art`}
                          alt="Proposed artwork"
                          loading="lazy"
                        />
                      ) : (
                        <p>
                          <span className="old-value">
                            {s.current || "(empty)"}
                          </span>{" "}
                          → {s.value || "(empty)"}
                        </p>
                      )}
                      <small>{s.source}</small>
                    </div>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => onDismiss(s.id)}
                    >
                      Dismiss suggestion
                    </Button>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          </article>
        ))}
      </div>
      {selected && (
        <MetadataChooser
          key={selected}
          trackId={selected}
          onClose={() => setSelected("")}
          onApplied={onApplied}
        />
      )}
    </>
  );
}
