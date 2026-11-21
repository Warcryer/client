import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ApiError, type Info } from "../api";
import type { ControlState, NetSet } from "../control";

export type Tab = "voice" | "roster" | "clan" | "alliance" | "history" | "guides";

export type AppState = {
  info: Info;
  /** Reload who I am, my clan and my pending approvals. */
  refreshInfo: () => void;
  /** Goes up whenever the server says the roster changed. Screens reload on it. */
  tick: number;
  /** Goes up when the alliance's groups change. */
  groupsTick: number;
  set: NetSet | null;
  control: ControlState;
  select: (target: number | "lounge" | "auto") => void;
  tab: Tab;
  /** Switch screen; with an operation id, open that operation's board. */
  go: (tab: Tab, opId?: number) => void;
  boardOp: number | null;
  notice: string;
  /** Clan id -> crest version, for clans that have a crest. */
  crests: ReadonlyMap<number, number>;
};

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext missing");
  return ctx;
}

/** Runs an action against the server and keeps its refusal message for display. */
export function useAct(): { busy: boolean; error: string; run: (fn: () => Promise<unknown>) => Promise<boolean>; clear: () => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clear: () => setError("") };
}

/**
 * Loads data and keeps it fresh: again whenever `deps` change, whenever the
 * server reports a roster change, and on a slow timer as a safety net.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], pollMs = 10_000): { data: T | null; error: string; reload: () => void } {
  const { tick } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  const latest = useRef(load);
  latest.current = load;

  useEffect(() => {
    let live = true;
    latest
      .current()
      .then((d) => {
        if (!live) return;
        setData(d);
        setError("");
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, n]);

  useEffect(() => {
    const t = window.setInterval(() => document.visibilityState === "visible" && setN((x) => x + 1), pollMs);
    return () => window.clearInterval(t);
  }, [pollMs]);

  return { data, error, reload: () => setN((x) => x + 1) };
}

/** A button whose first click arms it and whose second runs it. */
export function ConfirmButton({
  onConfirm,
  children,
  confirm,
  className = "btn btn-quiet text-sm",
  disabled,
}: {
  onConfirm: () => void;
  children: React.ReactNode;
  confirm: string;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirm : children}
    </button>
  );
}
