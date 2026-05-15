export interface CtxMenuState {
  x: number;
  y: number;
  showUngroup: boolean;
  showGroup: boolean;
  groupCount: number;
  itemName: string | null;
  itemLocked: boolean;
}

interface CanvasContextMenuProps {
  menu: CtxMenuState;
  clipboardEmpty: boolean;
  onClose: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onToggleLock: (name: string) => void;
  onDelete: () => void;
}

export function CanvasContextMenu({
  menu, clipboardEmpty,
  onClose, onCopy, onPaste, onUndo, onRedo,
  onGroup, onUngroup, onToggleLock, onDelete,
}: CanvasContextMenuProps) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 min-w-[200px] bg-[#1e1e1e] border border-gray-700 rounded-lg shadow-2xl py-1 text-sm"
        style={{ left: menu.x, top: menu.y }}
      >
        <button
          onClick={() => { onCopy(); onClose(); }}
          className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-gray-800 transition-colors flex justify-between items-center"
        >
          <span>Kopiuj</span>
          <span className="text-gray-600 text-xs">Ctrl+C</span>
        </button>
        <button
          onClick={() => { onPaste(); onClose(); }}
          disabled={clipboardEmpty}
          className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-gray-800 transition-colors flex justify-between items-center disabled:opacity-40"
        >
          <span>Wklej</span>
          <span className="text-gray-600 text-xs">Ctrl+V</span>
        </button>
        <div className="h-px bg-gray-700 my-1" />
        <button
          onClick={() => { onUndo(); onClose(); }}
          className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-gray-800 transition-colors flex justify-between items-center"
        >
          <span>Cofnij</span>
          <span className="text-gray-600 text-xs">Ctrl+Z</span>
        </button>
        <button
          onClick={() => { onRedo(); onClose(); }}
          className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-gray-800 transition-colors flex justify-between items-center"
        >
          <span>Ponów</span>
          <span className="text-gray-600 text-xs">Ctrl+Shift+Z</span>
        </button>
        <div className="h-px bg-gray-700 my-1" />
        {menu.showUngroup && (
          <button
            onClick={onUngroup}
            className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-gray-800 transition-colors"
          >
            Rozgrupuj
          </button>
        )}
        {menu.showGroup && (
          <button
            onClick={onGroup}
            className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-gray-800 transition-colors"
          >
            Grupuj zaznaczenie ({menu.groupCount})
          </button>
        )}
        {(menu.showUngroup || menu.showGroup) && (
          <div className="h-px bg-gray-700 my-1" />
        )}
        {menu.itemName && (
          <>
            <button
              onClick={() => { onToggleLock(menu.itemName!); onClose(); }}
              className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-gray-800 transition-colors"
            >
              {menu.itemLocked ? "Odblokuj" : "Zablokuj"}
            </button>
            <div className="h-px bg-gray-700 my-1" />
          </>
        )}
        <button
          onClick={onDelete}
          className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-gray-800 transition-colors flex justify-between items-center"
        >
          <span>Usuń</span>
          <span className="text-gray-600 text-xs">Del</span>
        </button>
      </div>
    </>
  );
}
