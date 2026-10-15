import { useWindowsActions } from "../../hooks/useWindowsActions";
import { BackIcon } from "../common/icons";

export function WindowsActions({ onClose }: { onClose?: () => void }) {
  const { apps, macros, busy, notice, isWindowsActive, refresh, execute } =
    useWindowsActions();
  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-950 text-zinc-100 select-none p-6 rounded-2xl">
      <div className="flex items-center gap-3 mb-4 shrink-0">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Go Back"
            className="p-3 rounded-full bg-zinc-800"
          >
            <BackIcon className="w-6 h-6" />
          </button>
        )}
        <h1 className="text-2xl font-bold flex-1">Apps &amp; Macros</h1>
        <button
          type="button"
          disabled={!isWindowsActive || busy}
          onClick={() => void refresh()}
          className="p-3 rounded-xl bg-zinc-800 disabled:opacity-40"
        >
          Refresh
        </button>
      </div>
      <p role="status" className="mb-3 text-zinc-300 shrink-0">
        {!isWindowsActive
          ? "PC unavailable"
          : busy
            ? "Working..."
            : (notice ?? "Configured on your Windows PC")}
      </p>
      {isWindowsActive && (
        <div className="overflow-y-auto flex-1 space-y-4">
          {(
            [
              ["apps", "Applications", apps],
              ["macros", "Macros", macros],
            ] as const
          ).map(([kind, title, actions]) => (
            <section key={kind} aria-label={title}>
              <h2 className="text-xl font-semibold mb-2">{title}</h2>
              {actions === null ? (
                <p className="text-zinc-400">
                  {busy ? "Loading..." : "Unavailable. Try Refresh."}
                </p>
              ) : actions.length === 0 ? (
                <p className="text-zinc-400">No configured actions</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {actions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void execute(kind, action.id)}
                      className="p-4 min-h-14 rounded-xl bg-zinc-800 text-left break-words disabled:opacity-40"
                    >
                      {action.name}
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
