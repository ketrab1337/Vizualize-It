import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Eye, EyeOff, Lock, Unlock, Layers2, FolderOpen, Square, ChevronRight, ChevronDown } from "lucide-react";

export type LayerItemType = "path" | "compound" | "group" | "shape" | "other";

export interface LayerItem {
  id: string;
  name: string;
  type: LayerItemType;
  locked: boolean;
  visible: boolean;
  children?: LayerItem[];
}

interface Props {
  items: LayerItem[];
  selectedIds: string[];
  onSelect: (id: string, multi: boolean) => void;
  onRename: (id: string, newName: string) => void;
  onToggleLock: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
  getThumbnail: (id: string) => string | null;
  onContextMenu?: (id: string, x: number, y: number) => void;
}

function TypeIcon({ type }: { type: LayerItemType }) {
  if (type === "compound") return <Layers2    className="w-3 h-3 text-purple-500" />;
  if (type === "group")    return <FolderOpen className="w-3 h-3 text-yellow-600" />;
  if (type === "shape")    return <Square     className="w-3 h-3 text-blue-500" />;
  return null;
}

function computePreview(
  items: LayerItem[],
  dragId: string | null,
  dropTargetId: string | null,
): LayerItem[] {
  if (!dragId) return items;
  const dragged = items.find((i) => i.id === dragId);
  if (!dragged) return items;
  if (dropTargetId === dragId) return items;
  const rest = items.filter((i) => i.id !== dragId);
  if (dropTargetId === null) return [...rest, dragged];
  const at = rest.findIndex((i) => i.id === dropTargetId);
  if (at === -1) return [...rest, dragged];
  return [...rest.slice(0, at), dragged, ...rest.slice(at)];
}

function collectAllItems(items: LayerItem[]): LayerItem[] {
  const result: LayerItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.children) result.push(...collectAllItems(item.children));
  }
  return result;
}

// Kolor tła edytora — musi być zgodny z BG_COLOR w Canvas.tsx
const PANEL_BG = "#e8e9ed";
const HEADER_BG = "#d8d9de";
const BORDER_COLOR = "#c4c5ce";

const DRAG_THRESHOLD = 5;

export function LayersPanel({
  items, selectedIds, onSelect, onRename, onToggleLock, onToggleVisible, onReorder, getThumbnail, onContextMenu,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs  = useRef(new Map<string, HTMLDivElement>());

  const itemsRef     = useRef(items);
  const onReorderRef = useRef(onReorder);
  itemsRef.current     = items;
  onReorderRef.current = onReorder;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Mapa miniaturek — obejmuje też dzieci grup
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({});
  useEffect(() => {
    const map: Record<string, string> = {};
    collectAllItems(items).forEach((item) => {
      const url = getThumbnail(item.id);
      if (url) map[item.id] = url;
    });
    setThumbMap(map);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // Powiększony popup przy hover (prawo od panelu)
  const [preview, setPreview] = useState<{ url: string; x: number; y: number } | null>(null);

  // Drag state
  const [dragId,       setDragId]       = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [ghostPos,     setGhostPos]     = useState<{ x: number; y: number } | null>(null);
  const dragIdRef       = useRef<string | null>(null);
  const dropTargetIdRef = useRef<string | null>(null);
  const pendingDragRef  = useRef<string | null>(null);

  const displayItems = useMemo(
    () => computePreview(items, dragId, dropTargetId),
    [items, dragId, dropTargetId],
  );

  // ── Edycja nazwy ────────────────────────────────────────────────────────────

  const startEdit = (item: LayerItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(item.id);
    setEditValue(item.name);
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0);
  };

  const commitEdit = useCallback(() => {
    if (editingId) { onRename(editingId, editValue.trim() || editingId); setEditingId(null); }
  }, [editingId, editValue, onRename]);

  // ── Popup przy hover — pozycja przycinana do ekranu ─────────────────────────

  const POPUP_H = 144; // h-36 = 144px
  const POPUP_GAP = 8;

  const handleRowEnter = (id: string, el: HTMLElement) => {
    if (dragId) return;
    const url = thumbMap[id];
    if (!url) { setPreview(null); return; }
    const rr = el.getBoundingClientRect();
    const pr = panelRef.current?.getBoundingClientRect();
    const x  = (pr?.right ?? rr.right) + POPUP_GAP;
    const rowCenterY = rr.top + rr.height / 2;
    const rawY = rowCenterY - POPUP_H / 2;
    const y    = Math.max(POPUP_GAP, Math.min(rawY, window.innerHeight - POPUP_H - POPUP_GAP));
    setPreview({ url, x, y });
  };

  // ── Mouse drag z progiem ruchu (bez efektu "wgniatania" przy zwykłym kliknięciu) ──

  const handleRowMouseDown = (e: React.MouseEvent, id: string) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    if (e.button !== 0) return;
    e.preventDefault();

    pendingDragRef.current = id;
    setPreview(null);
    document.body.style.userSelect = "none";

    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (me: MouseEvent) => {
      if (!dragIdRef.current) {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;

        const pending = pendingDragRef.current;
        if (!pending) return;
        dragIdRef.current       = pending;
        dropTargetIdRef.current = pending;
        setDragId(pending);
        setDropTargetId(pending);
        setGhostPos({ x: me.clientX, y: me.clientY });
        document.body.style.cursor = "grabbing";
      }

      setGhostPos({ x: me.clientX, y: me.clientY });
      const current = itemsRef.current;
      let target: string | null = null;
      for (const item of current) {
        if (item.id === dragIdRef.current) continue;
        const el   = rowRefs.current.get(item.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (me.clientY < rect.top + rect.height / 2) { target = item.id; break; }
      }
      if (target !== dropTargetIdRef.current) {
        dropTargetIdRef.current = target;
        setDropTargetId(target);
      }
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
      pendingDragRef.current = null;

      const did = dragIdRef.current;
      const dtd = dropTargetIdRef.current;
      const cur = itemsRef.current;

      setDragId(null); setDropTargetId(null); setGhostPos(null);
      dragIdRef.current = null; dropTargetIdRef.current = null;

      if (!did) return;
      const fromIdx   = cur.findIndex((i) => i.id === did);
      if (fromIdx < 0) return;
      const finalOrder = computePreview(cur, did, dtd);
      const toIdx      = finalOrder.findIndex((i) => i.id === did);
      if (toIdx >= 0 && fromIdx !== toIdx) onReorderRef.current(fromIdx, toIdx);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  };

  useEffect(() => () => {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  // ── Render jednego wiersza (rekurencyjnie dla dzieci) ───────────────────────

  const renderItem = (item: LayerItem, level: number): React.ReactNode => {
    const sel            = selectedIds.includes(item.id);
    const isTopLevel     = level === 0;
    const isBeingDragged = isTopLevel && item.id === dragId;
    const thumb          = thumbMap[item.id];
    const hasChildren    = Boolean(item.children && item.children.length > 0);
    const isExpanded     = expandedIds.has(item.id);

    return (
      <div key={item.id}>
        <div
          ref={isTopLevel ? (el) => { if (el) rowRefs.current.set(item.id, el); else rowRefs.current.delete(item.id); } : undefined}
          onMouseDown={isTopLevel ? (e) => handleRowMouseDown(e, item.id) : undefined}
          onMouseEnter={(e) => handleRowEnter(item.id, e.currentTarget)}
          onMouseLeave={() => setPreview(null)}
          onClick={(e) => { if (!dragId && editingId !== item.id) onSelect(item.id, e.shiftKey); }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(item.id, e.clientX, e.clientY); }}
          className={[
            "group flex items-center gap-1.5 pr-2 py-1.5 select-none border-l-2 transition-colors",
            isBeingDragged
              ? "opacity-40 border-l-blue-400"
              : sel
                ? "border-l-blue-500"
                : "border-l-transparent",
            !item.visible && !isBeingDragged ? "opacity-40" : "",
            isTopLevel ? "cursor-grab" : "cursor-pointer",
          ].join(" ")}
          style={{
            paddingLeft: level > 0 ? level * 16 + 8 : 8,
            background: isBeingDragged
              ? "rgba(59,130,246,0.08)"
              : sel
                ? "rgba(59,130,246,0.12)"
                : undefined,
          }}
          onMouseOver={(e) => {
            if (!sel && !isBeingDragged)
              (e.currentTarget as HTMLDivElement).style.background = "rgba(0,0,0,0.05)";
          }}
          onMouseOut={(e) => {
            if (!sel && !isBeingDragged)
              (e.currentTarget as HTMLDivElement).style.background = "";
          }}
        >
          {/* Chevron dla grup z dziećmi, spacer dla reszty */}
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpand(item.id); }}
              className="shrink-0 p-0.5 rounded transition-colors hover:bg-black/10"
              title={isExpanded ? "Zwiń grupę" : "Rozwiń grupę"}
            >
              {isExpanded
                ? <ChevronDown  className="w-3 h-3 text-gray-500" />
                : <ChevronRight className="w-3 h-3 text-gray-500" />}
            </button>
          ) : (
            <div className="w-4 shrink-0" />
          )}

          {/* Miniaturka */}
          <div
            className="shrink-0 rounded overflow-hidden flex items-center justify-center bg-white"
            style={{ width: 32, height: 24, border: `1px solid ${BORDER_COLOR}` }}
          >
            {thumb ? (
              <img src={thumb} alt="" className="max-w-full max-h-full object-contain" />
            ) : (
              <TypeIcon type={item.type} />
            )}
          </div>

          {/* Nazwa */}
          {editingId === item.id ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                else if (e.key === "Escape") setEditingId(null);
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 rounded px-1.5 py-0.5 text-xs text-gray-800 outline-none cursor-text"
              style={{ background: "white", border: `1px solid #3b82f6` }}
            />
          ) : (
            <span
              className="flex-1 min-w-0 truncate text-xs text-gray-800"
              title={item.name}
              onDoubleClick={(e) => startEdit(item, e)}
            >
              {item.name}
            </span>
          )}

          {/* Lock / Visibility */}
          <div className={[
            "flex items-center gap-0.5 shrink-0 transition-opacity",
            (item.locked || !item.visible) ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          ].join(" ")}>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleLock(item.id); }}
              className="p-0.5 rounded transition-colors hover:bg-black/10"
              title={item.locked ? "Odblokuj" : "Zablokuj"}
            >
              {item.locked
                ? <Lock   className="w-3 h-3 text-orange-500" />
                : <Unlock className="w-3 h-3 text-gray-500" />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleVisible(item.id); }}
              className="p-0.5 rounded transition-colors hover:bg-black/10"
              title={item.visible ? "Ukryj" : "Pokaż"}
            >
              {item.visible
                ? <Eye    className="w-3 h-3 text-gray-500" />
                : <EyeOff className="w-3 h-3 text-gray-600" />}
            </button>
          </div>
        </div>

        {/* Dzieci grupy — renderowane gdy rozwinięta */}
        {hasChildren && isExpanded && item.children!.map((child) => renderItem(child, level + 1))}
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      ref={panelRef}
      className="absolute bottom-14 left-3 z-20 w-64 rounded-xl shadow-2xl flex flex-col overflow-hidden"
      style={{ maxHeight: "58vh", background: PANEL_BG, border: `1px solid ${BORDER_COLOR}` }}
    >
      {/* Nagłówek */}
      <div
        className="px-3 py-2 shrink-0"
        style={{ background: HEADER_BG, borderBottom: `1px solid ${BORDER_COLOR}` }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          Obiekty ({items.length})
        </span>
      </div>

      {/* Lista */}
      <div
        className="overflow-y-auto flex-1 min-h-0 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[#e8e9ed] [&::-webkit-scrollbar-thumb]:bg-[#b4b5be] [&::-webkit-scrollbar-thumb]:rounded-full"
        style={{ scrollbarWidth: "thin", scrollbarColor: `#b4b5be ${PANEL_BG}` }}
      >
        {items.length === 0 ? (
          <div className="py-8 text-center text-gray-400 text-xs">Brak obiektów</div>
        ) : (
          displayItems.map((item) => renderItem(item, 0))
        )}
      </div>

      {/* Ghost drag */}
      {dragId && ghostPos && (() => {
        const g = items.find((i) => i.id === dragId);
        const gThumb = g ? thumbMap[g.id] : null;
        return g ? (
          <div
            className="fixed z-[200] pointer-events-none select-none flex items-center gap-2 px-2 py-1.5 rounded-lg shadow-2xl text-xs text-gray-800"
            style={{
              left: ghostPos.x + 14,
              top:  ghostPos.y - 12,
              background: PANEL_BG,
              border: `1px solid #3b82f6`,
              maxWidth: 220,
            }}
          >
            <div
              className="shrink-0 rounded overflow-hidden flex items-center justify-center bg-white"
              style={{ width: 32, height: 24, border: `1px solid ${BORDER_COLOR}` }}
            >
              {gThumb
                ? <img src={gThumb} alt="" className="max-w-full max-h-full object-contain" />
                : <TypeIcon type={g.type} />}
            </div>
            <span className="truncate">{g.name}</span>
          </div>
        ) : null;
      })()}

      {/* Powiększony popup przy hover */}
      {preview && (
        <div
          className="fixed z-[100] w-44 h-36 rounded-xl shadow-2xl overflow-hidden pointer-events-none"
          style={{
            left: preview.x,
            top:  preview.y,
            background: "white",
            border: `1px solid ${BORDER_COLOR}`,
          }}
        >
          <div className="w-full h-full flex items-center justify-center p-2">
            <img src={preview.url} alt="" className="max-w-full max-h-full object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}
