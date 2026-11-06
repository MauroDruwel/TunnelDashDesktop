import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "./icons";

const protocols = ["ssh", "http", "tcp", "rdp", "smb"] as const;

export function ProtocolFilter({ counts, total, selected, toggle, reset }: {
  counts: Record<(typeof protocols)[number], number>;
  total: number;
  selected: string[];
  toggle: (protocol: string) => void;
  reset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  const options = protocols.filter((protocol) => (
    (protocol !== "rdp" && protocol !== "smb") || counts[protocol] > 0 || selected.includes(protocol)
  ));
  const current = protocols.find((protocol) => selected.length === 1 && selected[0] === protocol);
  const summary = current ? `${current.toUpperCase()} (${counts[current]})`
    : selected.length ? `Routes: ${selected.map((p) => p.toUpperCase()).join(", ")}`
    : `All Routes (${total})`;
  return (
    <div ref={wrapper} className="cf-filter-dropdown-wrapper" onKeyDown={(event) => {
      if (open && event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }}>
      <button ref={trigger} type="button" aria-expanded={open}
        className={`cf-filter-dropdown-btn ${selected.length ? "active" : ""}`}
        onClick={() => setOpen(!open)} title="Filter routes by protocol">
        <span>{summary}</span>
        <ChevronDownIcon size={12} style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </button>
      {open && (
        <div className="cf-filter-dropdown-menu" role="group" aria-label="Filter routes">
          <div className="cf-filter-dropdown-header">Filter Routes</div>
          <label className="cf-filter-dropdown-item">
            <span><input type="checkbox" checked={!selected.length} onChange={reset} /> All Protocols</span>
            <span className="cf-filter-dropdown-count" aria-hidden="true">{total}</span>
          </label>
          {options.map((protocol) => (
            <label key={protocol} className="cf-filter-dropdown-item">
              <span>
                <input type="checkbox" checked={selected.includes(protocol)} onChange={() => toggle(protocol)} />
                {" "}<span className={`cf-proto-tag ${protocol}`}>{protocol.toUpperCase()}</span>
              </span>
              <span className="cf-filter-dropdown-count" aria-hidden="true">{counts[protocol]}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
