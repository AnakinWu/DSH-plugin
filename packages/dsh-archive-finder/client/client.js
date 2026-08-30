window.__ModuleLoader__.load({
  id: "dsh-archive-finder",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../profiles/web/node_modules/dsh-archive-finder/client/src/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = __toESM(require("react"), 1);
var import_react_dom = require("react-dom");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var inject = ["slots"];
var API_MODELS = "/api/dsh-archive-finder/models";
var API_RESTORE = "/api/dsh-archive-finder/restore";
var API_AUTO_ARCHIVE_RUN = "/api/dsh-archive-finder/auto-archive/run";
var EMPTY_IDS = [];
function apply(ctx) {
  const slots = ctx.slots;
  if (slots === void 0) return;
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-archive-finder";
    style.textContent = APP_CSS;
    document.head.append(style);
    return () => style.remove();
  }, "dsh-archive-finder: styles");
  slots.inject(
    "sidebar.footer.action",
    () => slots.register(
      {
        name: "sidebar.footer.action",
        id: "archive-finder",
        order: 100,
        label: () => "\u5F52\u6863\u627E\u56DE"
      },
      ArchiveFinderEntry
    )
  );
}
function useArchivedEntries(useSessions, useWorkspaces) {
  const workspacesState = useWorkspaces((s) => s);
  const sessionsState = useSessions((s) => s);
  const archivedIds = workspacesState.archivedSessionIds ?? [];
  const byId = sessionsState.byId ?? {};
  return import_react.default.useMemo(() => {
    const workspaceBySession = /* @__PURE__ */ new Map();
    for (const w of workspacesState.items ?? []) {
      for (const sid of w.sessionIds ?? []) {
        if (!workspaceBySession.has(sid)) workspaceBySession.set(sid, w);
      }
    }
    const entries = [];
    for (const id of archivedIds) {
      const rec = byId[id];
      if (rec !== void 0 && rec.origin === "subagent") continue;
      const ws = workspaceBySession.get(id);
      const cwd = rec?.cwd ?? ws?.path ?? "";
      entries.push({
        sessionId: id,
        title: typeof rec?.title === "string" && rec.title !== "" ? rec.title : "\u672A\u547D\u540D\u4F1A\u8BDD",
        updatedAt: typeof rec?.updatedAt === "number" ? rec.updatedAt : 0,
        cwd,
        blank: rec?.blank === true,
        workspaceId: ws?.workspaceId ?? null,
        workspaceTitle: ws?.title ?? null,
        groupKey: ws !== void 0 ? "ws:" + ws.workspaceId : cwd !== "" ? "cwd:" + cwd : "other",
        groupTitle: ws?.title ?? (cwd !== "" ? baseName(cwd) + "\uFF08\u6309\u76EE\u5F55\uFF09" : "\u5176\u4ED6")
      });
    }
    return entries;
  }, [archivedIds, byId, workspacesState.items]);
}
function baseName(p) {
  const parts = String(p).replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
function groupAndSort(entries, models, sortMode) {
  const groups = /* @__PURE__ */ new Map();
  for (const e of entries) {
    let g = groups.get(e.groupKey);
    if (g === void 0) {
      g = { key: e.groupKey, title: e.groupTitle, entries: [] };
      groups.set(e.groupKey, g);
    }
    g.entries.push(e);
  }
  const modelLabel = (id) => {
    const m = models?.[id];
    return m ? `${m.provider}/${m.model}` : null;
  };
  const cmp = sortMode === "model" ? (a, b) => {
    const ma = modelLabel(a.sessionId);
    const mb = modelLabel(b.sessionId);
    if (ma === null && mb === null) return b.updatedAt - a.updatedAt;
    if (ma === null) return 1;
    if (mb === null) return -1;
    const c = ma.localeCompare(mb, "en");
    return c !== 0 ? c : b.updatedAt - a.updatedAt;
  } : (a, b) => b.updatedAt - a.updatedAt;
  const list = [...groups.values()];
  for (const g of list) g.entries.sort(cmp);
  list.sort((a, b) => Math.max(...b.entries.map((e) => e.updatedAt)) - Math.max(...a.entries.map((e) => e.updatedAt)));
  return list;
}
function entryMatchesQuery(e, models, q) {
  if (e.title.toLowerCase().includes(q)) return true;
  if (e.cwd && e.cwd.toLowerCase().includes(q)) return true;
  if (e.workspaceTitle !== null && e.workspaceTitle.toLowerCase().includes(q)) return true;
  if (models) {
    const m = models[e.sessionId];
    if (m) {
      const base = `${m.provider}/${m.model}`;
      if (base.toLowerCase().includes(q)) return true;
      if (m.reasoningEffort && `${base}\xB7${m.reasoningEffort}`.toLowerCase().includes(q)) return true;
    }
  }
  return false;
}
function modelBadgeText(m) {
  if (m === void 0) return "\u2026";
  if (m === null) return "\u672A\u77E5\u6A21\u578B";
  return m.reasoningEffort ? `${m.provider}/${m.model}\xB7${m.reasoningEffort}` : `${m.provider}/${m.model}`;
}
function relativeTime(ts) {
  if (!ts) return "\u65F6\u95F4\u672A\u77E5";
  const diff = Date.now() - ts;
  const minute = 6e4, hour = 36e5, day = 864e5;
  if (diff < minute) return "\u521A\u521A";
  if (diff < hour) return `${Math.floor(diff / minute)} \u5206\u949F\u524D`;
  if (diff < day) return `${Math.floor(diff / hour)} \u5C0F\u65F6\u524D`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} \u5929\u524D`;
  return new Date(ts).toLocaleDateString("zh-CN");
}
function ArchiveFinderEntry(props) {
  const { wide, useSessions, useWorkspaces } = props;
  const [open, setOpen] = import_react.default.useState(false);
  const archivedIds = useWorkspaces((s) => s?.archivedSessionIds ?? EMPTY_IDS);
  const count = archivedIds.length;
  const handleOpen = import_react.default.useCallback(() => setOpen(true), []);
  const handleClose = import_react.default.useCallback(() => setOpen(false), []);
  let trigger;
  if (wide) {
    trigger = import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "af-btn af-entry af-entry--wide",
        onClick: handleOpen,
        "aria-label": "\u5F52\u6863\u627E\u56DE"
      },
      import_react.default.createElement(import_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16, className: "af-entry__icon" }),
      import_react.default.createElement("span", { className: "af-entry__label" }, "\u5F52\u6863\u627E\u56DE"),
      import_react.default.createElement(
        "span",
        { className: "af-count", "aria-label": "\u5DF2\u5F52\u6863 " + count + " \u6761" },
        String(count)
      )
    );
  } else {
    const iconBtn = import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "af-btn af-entry af-entry--rail",
        onClick: handleOpen,
        "aria-label": "\u5F52\u6863\u627E\u56DE"
      },
      import_react.default.createElement(import_dsh_client_ui_primitives.IconArchiveOutline20, { size: 18, className: "af-entry__icon" })
    );
    trigger = import_react.default.createElement(
      import_dsh_client_ui_primitives.Tooltip,
      { label: "\u5F52\u6863\u627E\u56DE", delayMs: 500 },
      iconBtn
    );
  }
  return import_react.default.createElement(
    import_react.default.Fragment,
    null,
    trigger,
    open ? import_react.default.createElement(ArchiveModal, {
      onClose: handleClose,
      useSessions,
      useWorkspaces
    }) : null
  );
}
function ArchiveModal({ onClose, useSessions, useWorkspaces }) {
  const archivedIds = useWorkspaces((s) => s?.archivedSessionIds ?? EMPTY_IDS);
  const [models, setModels] = import_react.default.useState(null);
  const [modelsError, setModelsError] = import_react.default.useState(false);
  const [logTitles, setLogTitles] = import_react.default.useState(null);
  const [sortMode, setSortMode] = import_react.default.useState("time");
  const [collapsedGroups, setCollapsedGroups] = import_react.default.useState(() => /* @__PURE__ */ new Set());
  const [restoringIds, setRestoringIds] = import_react.default.useState(() => /* @__PURE__ */ new Set());
  const [restoreError, setRestoreError] = import_react.default.useState(false);
  const [query, setQuery] = import_react.default.useState("");
  const [ageDays, setAgeDays] = import_react.default.useState(null);
  const [archiveStep, setArchiveStep] = import_react.default.useState("idle");
  const [archiveResult, setArchiveResult] = import_react.default.useState(null);
  const [archiveError, setArchiveError] = import_react.default.useState(false);
  const queryRef = import_react.default.useRef("");
  import_react.default.useEffect(() => {
    queryRef.current = query;
  }, [query]);
  import_react.default.useEffect(() => {
    if (archiveStep !== "confirm") return;
    const t = setTimeout(() => setArchiveStep("idle"), 4e3);
    return () => clearTimeout(t);
  }, [archiveStep]);
  import_react.default.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation?.();
        if (queryRef.current !== "") {
          setQuery("");
          return;
        }
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const cancelRef = import_react.default.useRef(null);
  const loadModels = import_react.default.useCallback(() => {
    if (cancelRef.current) cancelRef.current();
    let cancelled = false;
    cancelRef.current = () => {
      cancelled = true;
    };
    fetch(API_MODELS, { method: "GET", headers: { accept: "application/json" } }).then((r) => {
      if (!r.ok) throw new Error("status " + r.status);
      return r.json();
    }).then((data) => {
      if (cancelled) return;
      if (data && data.ok === true && data.models && typeof data.models === "object") {
        setModels(data.models);
        setLogTitles(data.titles && typeof data.titles === "object" ? data.titles : {});
        setModelsError(false);
        if (typeof data.ageDays === "number" && data.ageDays > 0) setAgeDays(data.ageDays);
      } else {
        setModels({});
        setLogTitles({});
        setModelsError(true);
      }
    }).catch(() => {
      if (cancelled) return;
      setModels({});
      setLogTitles({});
      setModelsError(true);
    });
  }, []);
  import_react.default.useEffect(() => {
    loadModels();
  }, []);
  import_react.default.useEffect(() => {
    if (models === null) return;
    let hasNew = false;
    for (let i = 0; i < archivedIds.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(models, archivedIds[i])) {
        hasNew = true;
        break;
      }
    }
    if (hasNew) loadModels();
  }, [archivedIds, models, loadModels]);
  const entries = useArchivedEntries(useSessions, useWorkspaces);
  const displayEntries = import_react.default.useMemo(
    () => logTitles === null ? entries : entries.map((e) => {
      const t = logTitles[e.sessionId];
      return t && typeof t.title === "string" && t.title !== "" ? { ...e, title: t.title, userRenamed: t.user === true } : e;
    }),
    [entries, logTitles]
  );
  const queryTrim = query.trim().toLowerCase();
  const filteredEntries = import_react.default.useMemo(
    () => queryTrim === "" ? displayEntries : displayEntries.filter((e) => entryMatchesQuery(e, models, queryTrim)),
    [displayEntries, models, queryTrim]
  );
  const groups = import_react.default.useMemo(
    () => groupAndSort(filteredEntries, models, sortMode),
    [filteredEntries, models, sortMode]
  );
  const toggleGroup = import_react.default.useCallback((key) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const restoreOne = import_react.default.useCallback((sessionId) => {
    setRestoringIds((prev) => {
      if (prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.add(sessionId);
      return next;
    });
    setRestoreError(false);
    let cancelled = false;
    fetch(API_RESTORE, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sessionId })
    }).then(async (r) => {
      let data = {};
      try {
        data = await r.json();
      } catch {
      }
      return { status: r.status, ok: data && data.ok === true };
    }).then(({ status, ok }) => {
      if (cancelled) return;
      setRestoringIds((prev) => {
        if (!prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
      if (status === 200 && ok) {
      } else if (status === 404) {
      } else {
        setRestoreError(true);
      }
    }).catch(() => {
      if (cancelled) return;
      setRestoringIds((prev) => {
        if (!prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
      setRestoreError(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const runAutoArchive = import_react.default.useCallback(() => {
    setArchiveStep("running");
    setArchiveError(false);
    setArchiveResult(null);
    fetch(API_AUTO_ARCHIVE_RUN, {
      method: "POST",
      headers: { accept: "application/json" }
    }).then(async (r) => {
      let data = {};
      try {
        data = await r.json();
      } catch {
      }
      return { status: r.status, ok: data && data.ok === true, stats: data && data.stats };
    }).then(({ status, ok, stats }) => {
      if (status === 200 && ok) {
        setArchiveResult(stats ?? {});
      } else {
        setArchiveError(true);
      }
      setArchiveStep("idle");
    }).catch(() => {
      setArchiveError(true);
      setArchiveStep("idle");
    });
  }, []);
  const head = import_react.default.createElement(
    "div",
    { className: "af-modal-head" },
    import_react.default.createElement("span", { className: "af-modal-title" }, "\u5F52\u6863\u4F1A\u8BDD\u627E\u56DE"),
    import_react.default.createElement(
      "span",
      { className: "af-modal-sub" },
      queryTrim === "" ? "\u5171 " + displayEntries.length + " \u6761" : "\u5339\u914D " + filteredEntries.length + " / \u5171 " + displayEntries.length + " \u6761"
    ),
    import_react.default.createElement("span", { className: "af-spacer" }),
    import_react.default.createElement(
      "div",
      { className: "af-segmented", role: "tablist" },
      import_react.default.createElement(
        "button",
        {
          type: "button",
          className: "af-btn af-segmented-btn" + (sortMode === "time" ? " af-segmented-btn--active" : ""),
          onClick: () => setSortMode("time")
        },
        "\u6309\u65F6\u95F4"
      ),
      import_react.default.createElement(
        "button",
        {
          type: "button",
          className: "af-btn af-segmented-btn" + (sortMode === "model" ? " af-segmented-btn--active" : ""),
          onClick: () => setSortMode("model")
        },
        "\u6309\u6A21\u578B"
      )
    ),
    import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "af-btn af-autorun-btn" + (archiveStep === "confirm" ? " af-autorun-btn--confirm" : ""),
        disabled: archiveStep === "running",
        onClick: () => {
          if (archiveStep === "running") return;
          if (archiveStep === "confirm") {
            runAutoArchive();
          } else {
            setArchiveStep("confirm");
          }
        },
        title: "\u5F52\u6863 " + (ageDays ?? 3) + " \u5929\u672A\u53D1\u8A00\u7684\u4F1A\u8BDD\uFF08\u8DF3\u8FC7\uFF1A\u6253\u5F00\u4E2D/\u7A7A\u767D/\u5B50\u4EE3\u7406/\u627E\u56DE 24h \u5BBD\u9650\uFF09",
        "aria-label": "\u5F52\u6863 " + (ageDays ?? 3) + " \u5929\u524D\u4F1A\u8BDD"
      },
      archiveStep === "running" ? "\u5F52\u6863\u4E2D\u2026" : archiveStep === "confirm" ? "\u786E\u8BA4\u5F52\u6863\uFF1F" : "\u5F52\u6863 " + (ageDays ?? 3) + " \u5929\u524D\u4F1A\u8BDD"
    ),
    import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "af-btn af-icon-btn",
        onClick: loadModels,
        title: "\u5237\u65B0\u6A21\u578B\u4FE1\u606F",
        "aria-label": "\u5237\u65B0\u6A21\u578B\u4FE1\u606F"
      },
      import_react.default.createElement(import_dsh_client_ui_primitives.IconRefreshOutline16, { size: 16 })
    ),
    import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "af-btn af-icon-btn",
        onClick: onClose,
        title: "\u5173\u95ED",
        "aria-label": "\u5173\u95ED"
      },
      import_react.default.createElement(import_dsh_client_ui_primitives.IconCloseOutline16, { size: 16 })
    )
  );
  const searchBar = import_react.default.createElement(
    "div",
    { className: "af-search" },
    import_react.default.createElement(import_dsh_client_ui_primitives.IconSearchOutline16, { size: 16, className: "af-search__icon" }),
    import_react.default.createElement("input", {
      type: "text",
      className: "af-search__input",
      value: query,
      onChange: (e) => setQuery(e.target.value),
      placeholder: "\u641C\u7D22\u6807\u9898 / \u76EE\u5F55 / \u5DE5\u4F5C\u533A / \u6A21\u578B\u2026",
      "aria-label": "\u641C\u7D22\u5F52\u6863\u4F1A\u8BDD",
      autoFocus: true,
      spellCheck: false,
      autoComplete: "off"
    }),
    query !== "" ? import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "af-btn af-icon-btn af-search__clear",
        onClick: () => setQuery(""),
        title: "\u6E05\u9664\u641C\u7D22",
        "aria-label": "\u6E05\u9664\u641C\u7D22"
      },
      import_react.default.createElement(import_dsh_client_ui_primitives.IconCloseOutline16, { size: 14 })
    ) : null
  );
  const errorBanners = [];
  if (restoreError) {
    errorBanners.push(
      import_react.default.createElement(
        "div",
        { key: "restore-error", className: "af-modal-error", role: "alert" },
        import_react.default.createElement("span", { className: "af-modal-error__text" }, "\u627E\u56DE\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5"),
        import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "af-btn af-icon-btn af-modal-error__close",
            onClick: () => setRestoreError(false),
            "aria-label": "\u5173\u95ED\u9519\u8BEF\u63D0\u793A",
            title: "\u5173\u95ED"
          },
          import_react.default.createElement(import_dsh_client_ui_primitives.IconCloseOutline16, { size: 14 })
        )
      )
    );
  }
  if (modelsError) {
    errorBanners.push(
      import_react.default.createElement(
        "div",
        { key: "models-error", className: "af-modal-error", role: "alert" },
        import_react.default.createElement("span", { className: "af-modal-error__text" }, "\u6A21\u578B\u4FE1\u606F\u52A0\u8F7D\u5931\u8D25"),
        import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "af-btn af-icon-btn af-modal-error__close",
            onClick: () => setModelsError(false),
            "aria-label": "\u5173\u95ED\u9519\u8BEF\u63D0\u793A",
            title: "\u5173\u95ED"
          },
          import_react.default.createElement(import_dsh_client_ui_primitives.IconCloseOutline16, { size: 14 })
        )
      )
    );
  }
  if (archiveResult !== null) {
    const stats = archiveResult;
    const scanned = Number(stats.scanned) || 0;
    const archived = Number(stats.archived) || 0;
    const failed = Number(stats.failed) || 0;
    const skipRecent = Number(stats.skippedRecent) || 0;
    const skipLive = Number(stats.skippedLive) || 0;
    const skipBlank = Number(stats.skippedBlank) || 0;
    const skipGrace = Number(stats.skippedGrace) || 0;
    const skipParts = [];
    if (skipRecent > 0) skipParts.push("\u8FD1\u671F " + skipRecent);
    if (skipLive > 0) skipParts.push("\u6253\u5F00\u4E2D " + skipLive);
    if (skipBlank > 0) skipParts.push("\u7A7A\u767D " + skipBlank);
    if (skipGrace > 0) skipParts.push("\u5BBD\u9650 " + skipGrace);
    const skipSuffix = skipParts.length > 0 ? "\uFF08\u8DF3\u8FC7\uFF1A" + skipParts.join(" / ") + "\uFF09" : "";
    const failSuffix = failed > 0 ? "\uFF1B\u5931\u8D25 " + failed + " \u6761" : "";
    const mainText = archived > 0 ? "\u5DF2\u5F52\u6863 " + archived + " \u6761 \xB7 \u5171\u626B\u63CF " + scanned + " \u6761" + skipSuffix : "\u6CA1\u6709\u9700\u8981\u5F52\u6863\u7684\u4F1A\u8BDD \xB7 \u5171\u626B\u63CF " + scanned + " \u6761" + skipSuffix;
    errorBanners.push(
      import_react.default.createElement(
        "div",
        { key: "archive-info", className: "af-modal-info", role: "status" },
        import_react.default.createElement("span", { className: "af-modal-info__text" }, mainText + failSuffix),
        import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "af-btn af-icon-btn af-modal-info__close",
            onClick: () => setArchiveResult(null),
            "aria-label": "\u5173\u95ED\u63D0\u793A",
            title: "\u5173\u95ED"
          },
          import_react.default.createElement(import_dsh_client_ui_primitives.IconCloseOutline16, { size: 14 })
        )
      )
    );
  }
  if (archiveError) {
    errorBanners.push(
      import_react.default.createElement(
        "div",
        { key: "archive-error", className: "af-modal-error", role: "alert" },
        import_react.default.createElement("span", { className: "af-modal-error__text" }, "\u81EA\u52A8\u5F52\u6863\u5931\u8D25\u6216\u5DF2\u7981\u7528\uFF0C\u8BF7\u91CD\u8BD5"),
        import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "af-btn af-icon-btn af-modal-error__close",
            onClick: () => setArchiveError(false),
            "aria-label": "\u5173\u95ED\u9519\u8BEF\u63D0\u793A",
            title: "\u5173\u95ED"
          },
          import_react.default.createElement(import_dsh_client_ui_primitives.IconCloseOutline16, { size: 14 })
        )
      )
    );
  }
  let body;
  if (displayEntries.length === 0) {
    body = import_react.default.createElement(
      "div",
      { className: "af-empty" },
      "\u6CA1\u6709\u5DF2\u5F52\u6863\u7684\u4F1A\u8BDD"
    );
  } else if (filteredEntries.length === 0) {
    body = import_react.default.createElement(
      "div",
      { className: "af-empty" },
      "\u6CA1\u6709\u5339\u914D\u300C" + query.trim() + "\u300D\u7684\u5F52\u6863\u4F1A\u8BDD"
    );
  } else {
    const groupNodes = groups.map((g) => {
      const collapsed = queryTrim === "" && collapsedGroups.has(g.key);
      const headRow = import_react.default.createElement(
        "div",
        {
          key: g.key + "-head",
          className: "af-group-head",
          onClick: () => toggleGroup(g.key),
          role: "button",
          "aria-expanded": collapsed ? "false" : "true"
        },
        collapsed ? import_react.default.createElement(import_dsh_client_ui_primitives.IconChevronRightOutline14, { size: 14 }) : import_react.default.createElement(import_dsh_client_ui_primitives.IconChevronDownOutline14, { size: 14 }),
        import_react.default.createElement("span", { className: "af-group-title" }, g.title),
        import_react.default.createElement("span", { className: "af-group-count" }, " \xB7 " + g.entries.length)
      );
      if (collapsed) {
        return import_react.default.createElement(
          "div",
          { key: g.key, className: "af-group" },
          headRow
        );
      }
      const rows = g.entries.map((e) => {
        const inFlight = restoringIds.has(e.sessionId);
        const badgeModel = models === null ? void 0 : models[e.sessionId] ?? null;
        const metaTime = relativeTime(e.updatedAt);
        const metaBase = e.cwd ? baseName(e.cwd) : "";
        const absoluteTs = e.updatedAt ? new Date(e.updatedAt).toLocaleString("zh-CN") : "\u65F6\u95F4\u672A\u77E5";
        return import_react.default.createElement(
          "div",
          { key: e.sessionId, className: "af-row" },
          import_react.default.createElement(
            "div",
            { className: "af-row-main" },
            import_react.default.createElement(
              "div",
              {
                className: "af-row-title",
                title: e.title + " \xB7 " + absoluteTs
              },
              e.title,
              e.userRenamed === true ? import_react.default.createElement(
                "span",
                { className: "af-renamed", title: "\u4F60\u5DF2\u91CD\u547D\u540D\uFF08\u6807\u9898\u53D6\u81EA\u4F1A\u8BDD\u65E5\u5FD7\u771F\u503C\uFF09" },
                "\u270E"
              ) : null
            ),
            import_react.default.createElement(
              "div",
              { className: "af-row-meta" },
              import_react.default.createElement("span", null, metaTime),
              import_react.default.createElement("span", { className: "af-badge" }, modelBadgeText(badgeModel)),
              metaBase ? import_react.default.createElement("span", { className: "af-row-cwd" }, metaBase) : null
            )
          ),
          import_react.default.createElement(
            "button",
            {
              type: "button",
              className: "af-btn af-restore-btn",
              disabled: inFlight,
              onClick: () => restoreOne(e.sessionId)
            },
            inFlight ? "\u627E\u56DE\u4E2D\u2026" : "\u627E\u56DE"
          )
        );
      });
      return import_react.default.createElement(
        "div",
        { key: g.key, className: "af-group" },
        headRow,
        import_react.default.createElement(
          "div",
          { key: g.key + "-list", className: "af-group-list" },
          rows
        )
      );
    });
    body = import_react.default.createElement(
      "div",
      { className: "af-modal-body" },
      groupNodes
    );
  }
  return (0, import_react_dom.createPortal)(
    import_react.default.createElement(
      "div",
      {
        className: "af-overlay",
        onClick: onClose,
        role: "presentation"
      },
      import_react.default.createElement(
        "div",
        {
          className: "af-modal",
          onClick: (e) => e.stopPropagation(),
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "\u5F52\u6863\u4F1A\u8BDD\u627E\u56DE"
        },
        head,
        searchBar,
        errorBanners.length > 0 ? errorBanners : null,
        body
      )
    ),
    document.body
  );
}
var APP_CSS = (
  // 按钮基础重置
  ".af-btn{border:none;background:none;font:inherit;color:inherit;padding:0;cursor:pointer}.af-entry{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}.af-entry--wide{flex:1 1 0;min-width:0;justify-content:center;height:32px;margin:0 2px;padding:0 6px;border-radius:8px;font-size:12px;line-height:20px;overflow:hidden}.af-entry--wide:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary)}.af-entry--wide .af-entry__icon{flex:none}.af-entry--wide .af-entry__label{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.af-entry--rail{justify-content:center;width:36px;height:36px;margin:0 2px;border-radius:8px;color:var(--dsw-alias-label-secondary);flex:none}.af-entry--rail:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}.af-entry--rail .af-entry__icon{flex:none}.af-count{display:inline-flex;align-items:center;justify-content:center;min-width:18px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;padding:0 8px;flex:none}.af-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center}.af-modal{display:flex;flex-direction:column;width:min(720px,92vw);max-height:80vh;background:var(--dsw-alias-bg-layer-0,#fff);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.18);overflow:hidden}.af-modal-head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}.af-modal-title{font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary)}.af-modal-sub{font-size:12px;color:var(--dsw-alias-label-secondary)}.af-spacer{flex:1;min-width:0}.af-segmented{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;flex:none}.af-segmented-btn{font-size:12px;line-height:20px;padding:4px 10px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;cursor:pointer}.af-segmented-btn:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}.af-segmented-btn--active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}.af-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;cursor:pointer;flex:none}.af-icon-btn:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}.af-modal-error{display:flex;align-items:center;gap:8px;padding:8px 16px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#e5484d);background:transparent;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}.af-modal-error__text{flex:1;min-width:0}.af-modal-error__close{margin-left:auto}.af-modal-body{flex:1;min-height:0;overflow-y:auto;padding:8px 12px 12px;scrollbar-width:thin}.af-empty{display:flex;align-items:center;justify-content:center;padding:40px 0;color:var(--dsw-alias-label-secondary);font-size:13px}.af-group{margin-bottom:8px}.af-group-head{display:flex;align-items:center;gap:6px;padding:4px 8px;font-size:12px;color:var(--dsw-alias-label-secondary);border-radius:6px;cursor:pointer;user-select:none}.af-group-head:hover{background:var(--dsw-alias-bg-layer-1)}.af-group-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.af-group-count{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.7}.af-group-list{display:flex;flex-direction:column;gap:2px;padding-top:2px}.af-row{display:flex;gap:8px;align-items:center;padding:8px;border-radius:8px}.af-row:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1))}.af-row-main{flex:1;min-width:0}.af-row-title{font-size:13px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.af-row-meta{display:flex;flex-wrap:wrap;gap:6px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary);margin-top:2px;align-items:center}.af-row-cwd{color:var(--dsw-alias-label-secondary)}.af-badge{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 8px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary);background:transparent;flex:none}.af-restore-btn{font-size:12px;padding:4px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);background:transparent;flex:none;line-height:18px}.af-restore-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}.af-restore-btn:disabled{opacity:.5;cursor:not-allowed}.af-search{display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}.af-search__icon{color:var(--dsw-alias-label-secondary);flex:none}.af-search__input{flex:1;min-width:0;font-size:13px;line-height:20px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);outline:none}.af-search__input:focus{border-color:var(--dsw-alias-state-focus,#4c9aff)}.af-search__input::placeholder{color:var(--dsw-alias-label-secondary)}.af-renamed{display:inline-block;margin-left:6px;font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.75;flex:none}.af-autorun-btn{font-size:12px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);background:transparent;flex:none;line-height:18px;white-space:nowrap}.af-autorun-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}.af-autorun-btn:disabled{opacity:.5;cursor:not-allowed}.af-autorun-btn--confirm{border-color:var(--dsw-alias-state-error-primary,#e5484d);color:var(--dsw-alias-state-error-primary,#e5484d)}.af-modal-info{display:flex;align-items:center;gap:8px;padding:8px 16px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);background:transparent;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}.af-modal-info__text{flex:1;min-width:0}.af-modal-info__close{margin-left:auto}"
);

    return module.exports;
  },
});
