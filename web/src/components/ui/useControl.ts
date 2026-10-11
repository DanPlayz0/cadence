import { useLayoutEffect, useRef, useState } from "react";

// Composite controls must honor disabled fieldsets, including dynamic busy states.
export function useControl<T extends HTMLElement>(disabled = false) {
  const ref = useRef<T>(null);
  const [inherited, setInherited] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setInherited(!!element.closest("fieldset[disabled]"));
    update();
    const observer = new MutationObserver(update);
    const fieldsets: HTMLElement[] = [];
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    )
      if (parent.tagName === "FIELDSET") fieldsets.push(parent);
    fieldsets.forEach((parent) =>
      observer.observe(parent, {
        attributes: true,
        attributeFilter: ["disabled"],
      }),
    );
    return () => observer.disconnect();
  }, []);
  return { ref, disabled: disabled || inherited };
}
