// dsh-archive-finder 客户端：在侧边栏 footer（设置上方，sidebar.footer.action 槽）注册
// 「归档找回」入口，点击弹出归档会话面板：按工作区分组、默认按时间排序、可切换按模型排序、
// 逐条找回。数据流：标题/时间/工作区归属全部来自 props 的 useSessions/useWorkspaces store
// （host 的 session.list 不过滤归档会话，过滤发生在 UI 层，所以 store 里全有）；模型字段 store
// 没有，由插件服务端 GET /api/dsh-archive-finder/models 补（扫会话日志最后一个 request/header）。
// 找回 = POST /api/dsh-archive-finder/restore；服务端改 registry 后 apiproxy 自动广播
// host/archived-sessions-changed → workspaces store 更新 → 本列表与主侧边栏同时自动刷新。
// 面板支持按标题/目录/工作区/模型子串搜索，搜索时忽略折叠态；Esc 优先清空搜索再关面板。
// 面板标题以服务端从会话日志提取的最后一个 session/title 事件为准（修复投影缓存重启失真），用户重命名的会话带 ✎ 标记。
// 面板可一键归档 N 天前会话（两段式确认，N=服务端当前阈值，结果含跳过明细）。
import React from "react";
import { createPortal } from "react-dom";
import {
	IconArchiveOutline20,
	IconCloseOutline16,
	IconRefreshOutline16,
	IconChevronDownOutline14,
	IconChevronRightOutline14,
	IconSearchOutline16,
	Tooltip
} from "@deepseek-ai/dsh-client-ui-primitives";

export const inject = ["slots"];

const API_MODELS = "/api/dsh-archive-finder/models";
const API_RESTORE = "/api/dsh-archive-finder/restore";
const API_AUTO_ARCHIVE_RUN = "/api/dsh-archive-finder/auto-archive/run";
// 选择器兜底常量：useSyncExternalStore 的选择器必须返回引用稳定的值，
// 内联 ?? [] 会每次产新数组导致「getSnapshot should be cached」抖动。
const EMPTY_IDS = [];

export function apply(ctx) {
	const slots = ctx.slots;
	if (slots === undefined) return;

	ctx.effect(() => {
		const style = document.createElement("style");
		style.dataset.plugin = "dsh-archive-finder";
		style.textContent = APP_CSS;
		document.head.append(style);
		return () => style.remove();
	}, "dsh-archive-finder: styles");

	slots.inject("sidebar.footer.action", () =>
		slots.register(
			{
				name: "sidebar.footer.action",
				id: "archive-finder",
				order: 100,
				label: () => "归档找回"
			},
			ArchiveFinderEntry
		)
	);
}

// ---------- 数据派生（主脑 owning 的关键逻辑，勿改语义） ----------

// 归档会话条目：store 记录 + 归档 id。origin === "subagent" 的排除——子代理会话找回后
// 也不进主侧边栏列表（它有父会话归属），列出来只会误导。
function useArchivedEntries(useSessions, useWorkspaces) {
	const workspacesState = useWorkspaces((s) => s);
	const sessionsState = useSessions((s) => s);
	const archivedIds = workspacesState.archivedSessionIds ?? [];
	const byId = sessionsState.byId ?? {};
	return React.useMemo(() => {
		// sessionId → workspace 归属反查（workspace.sessionIds 保留归档会话槽位）
		const workspaceBySession = new Map();
		for (const w of workspacesState.items ?? []) {
			for (const sid of w.sessionIds ?? []) {
				if (!workspaceBySession.has(sid)) workspaceBySession.set(sid, w);
			}
		}
		const entries = [];
		for (const id of archivedIds) {
			const rec = byId[id];
			if (rec !== undefined && rec.origin === "subagent") continue;
			const ws = workspaceBySession.get(id);
			const cwd = rec?.cwd ?? ws?.path ?? "";
			entries.push({
				sessionId: id,
				title: typeof rec?.title === "string" && rec.title !== "" ? rec.title : "未命名会话",
				updatedAt: typeof rec?.updatedAt === "number" ? rec.updatedAt : 0,
				cwd,
				blank: rec?.blank === true,
				workspaceId: ws?.workspaceId ?? null,
				workspaceTitle: ws?.title ?? null,
				groupKey: ws !== undefined ? "ws:" + ws.workspaceId : cwd !== "" ? "cwd:" + cwd : "other",
				groupTitle: ws?.title ?? (cwd !== "" ? baseName(cwd) + "（按目录）" : "其他")
			});
		}
		return entries;
	}, [archivedIds, byId, workspacesState.items]);
}

function baseName(p) {
	const parts = String(p).replace(/[\\/]+$/, "").split(/[\\/]/);
	return parts[parts.length - 1] || p;
}

// 分组（工作区恒定为分组维度）+ 组内排序（排序键只影响组内顺序）。
// sortMode: "time" = updatedAt 倒序；"model" = 模型名（provider/model）升序、未知模型垫底、同模型内按时间倒序。
// 组顺序恒按组内最大 updatedAt 倒序。
function groupAndSort(entries, models, sortMode) {
	const groups = new Map();
	for (const e of entries) {
		let g = groups.get(e.groupKey);
		if (g === undefined) {
			g = { key: e.groupKey, title: e.groupTitle, entries: [] };
			groups.set(e.groupKey, g);
		}
		g.entries.push(e);
	}
	const modelLabel = (id) => {
		const m = models?.[id];
		return m ? `${m.provider}/${m.model}` : null;
	};
	const cmp =
		sortMode === "model"
			? (a, b) => {
					const ma = modelLabel(a.sessionId);
					const mb = modelLabel(b.sessionId);
					if (ma === null && mb === null) return b.updatedAt - a.updatedAt;
					if (ma === null) return 1;
					if (mb === null) return -1;
					const c = ma.localeCompare(mb, "en");
					return c !== 0 ? c : b.updatedAt - a.updatedAt;
				}
			: (a, b) => b.updatedAt - a.updatedAt;
	const list = [...groups.values()];
	for (const g of list) g.entries.sort(cmp);
	list.sort((a, b) => Math.max(...b.entries.map((e) => e.updatedAt)) - Math.max(...a.entries.map((e) => e.updatedAt)));
	return list;
}

// 搜索命中判定：q 已 trim+小写且非空（调用方保证）；命中任一字段即 true。
// cwd 用全路径包含匹配，basename 自然会被命中；workspaceTitle 为 null 时跳过；models 为
// null（未加载完）时模型维度自然不生效，其余维度照常。
function entryMatchesQuery(e, models, q) {
	if (e.title.toLowerCase().includes(q)) return true;
	if (e.cwd && e.cwd.toLowerCase().includes(q)) return true;
	if (e.workspaceTitle !== null && e.workspaceTitle.toLowerCase().includes(q)) return true;
	if (models) {
		const m = models[e.sessionId];
		if (m) {
			const base = `${m.provider}/${m.model}`;
			if (base.toLowerCase().includes(q)) return true;
			if (m.reasoningEffort && `${base}·${m.reasoningEffort}`.toLowerCase().includes(q)) return true;
		}
	}
	return false;
}

function modelBadgeText(m) {
	if (m === undefined) return "…"; // models 尚未加载
	if (m === null) return "未知模型";
	return m.reasoningEffort ? `${m.provider}/${m.model}·${m.reasoningEffort}` : `${m.provider}/${m.model}`;
}

function relativeTime(ts) {
	if (!ts) return "时间未知";
	const diff = Date.now() - ts;
	const minute = 60e3, hour = 36e5, day = 864e5;
	if (diff < minute) return "刚刚";
	if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
	if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
	if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
	return new Date(ts).toLocaleDateString("zh-CN");
}

// ---------- UI 详细实现（组件树 / 样式 / 交互细节） ----------

function ArchiveFinderEntry(props) {
	// props: { wide, useSessions, useWorkspaces }
	const { wide, useSessions, useWorkspaces } = props;
	const [open, setOpen] = React.useState(false);

	// 订阅 store 让 wide 入口的计数徽标和 rail 入口的点击行为都能感知最新归档数
	const archivedIds = useWorkspaces((s) => (s?.archivedSessionIds ?? EMPTY_IDS));
	const count = archivedIds.length;

	const handleOpen = React.useCallback(() => setOpen(true), []);
	const handleClose = React.useCallback(() => setOpen(false), []);

	let trigger;
	if (wide) {
		trigger = React.createElement(
			"button",
			{
				type: "button",
				className: "af-btn af-entry af-entry--wide",
				onClick: handleOpen,
				"aria-label": "归档找回"
			},
			React.createElement(IconArchiveOutline20, { size: 16, className: "af-entry__icon" }),
			React.createElement("span", { className: "af-entry__label" }, "归档找回"),
			React.createElement(
				"span",
				{ className: "af-count", "aria-label": "已归档 " + count + " 条" },
				String(count)
			)
		);
	} else {
		const iconBtn = React.createElement(
			"button",
			{
				type: "button",
				className: "af-btn af-entry af-entry--rail",
				onClick: handleOpen,
				"aria-label": "归档找回"
			},
			React.createElement(IconArchiveOutline20, { size: 18, className: "af-entry__icon" })
		);
		trigger = React.createElement(
			Tooltip,
			{ label: "归档找回", delayMs: 500 },
			iconBtn
		);
	}

	return React.createElement(
		React.Fragment,
		null,
		trigger,
		open
			? React.createElement(ArchiveModal, {
					onClose: handleClose,
					useSessions,
					useWorkspaces
				})
			: null
	);
}

function ArchiveModal({ onClose, useSessions, useWorkspaces }) {
	// 始终从 store 派生列表数据，不维护本地副本（store 广播会自动清理已找回的条目）
	const archivedIds = useWorkspaces((s) => (s?.archivedSessionIds ?? EMPTY_IDS));

	const [models, setModels] = React.useState(null); // null=未加载；{} 或 {[id]:obj|null}=已加载
	const [modelsError, setModelsError] = React.useState(false);
	const [logTitles, setLogTitles] = React.useState(null); // null=未加载；{} 或 {[id]:{title,user,time}|null}=已加载（与 models 同生命周期）
	const [sortMode, setSortMode] = React.useState("time");
	const [collapsedGroups, setCollapsedGroups] = React.useState(() => new Set());
	const [restoringIds, setRestoringIds] = React.useState(() => new Set());
	const [restoreError, setRestoreError] = React.useState(false);
	const [query, setQuery] = React.useState("");
	// 一键归档 state：ageDays=null 表示 models 未加载，按钮文案回退静态 "3"
	const [ageDays, setAgeDays] = React.useState(null);
	const [archiveStep, setArchiveStep] = React.useState("idle"); // "idle" | "confirm" | "running"
	const [archiveResult, setArchiveResult] = React.useState(null); // null | {stats 对象}
	const [archiveError, setArchiveError] = React.useState(false);
	// Esc 处理器读最新 query：ref 同步避免把 query 加进 effect 依赖（防重订阅）
	const queryRef = React.useRef("");
	React.useEffect(() => {
		queryRef.current = query;
	}, [query]);

	// 确认态 4 秒超时回 idle（避免误点后按钮长期停在危险色态）
	React.useEffect(() => {
		if (archiveStep !== "confirm") return;
		const t = setTimeout(() => setArchiveStep("idle"), 4000);
		return () => clearTimeout(t);
	}, [archiveStep]);

	// Esc：先清空搜索再关面板（依赖只挂 onClose，避免 query 变化重订阅 document keydown）
	React.useEffect(() => {
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

	// 加载 models：可被连续调用，后一次取消前一次（避免慢响应覆盖快响应）
	const cancelRef = React.useRef(null);
	const loadModels = React.useCallback(() => {
		if (cancelRef.current) cancelRef.current();
		let cancelled = false;
		cancelRef.current = () => {
			cancelled = true;
		};
		fetch(API_MODELS, { method: "GET", headers: { accept: "application/json" } })
			.then((r) => {
				if (!r.ok) throw new Error("status " + r.status);
				return r.json();
			})
			.then((data) => {
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
			})
			.catch(() => {
				if (cancelled) return;
				setModels({});
				setLogTitles({});
				setModelsError(true);
			});
	}, []);

	// 开面板时拉一次
	React.useEffect(() => {
		loadModels();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// 增量：archivedIds 增加且 models 里缺新 id 时再拉一次（服务端有缓存，重复拉取无害）
	React.useEffect(() => {
		if (models === null) return; // 等待首次加载完成
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
	// 日志真值覆盖：服务端从会话日志提取最后一个 session/title 事件，store 投影缓存可能滞后；
	// logTitles 一旦到位（!== null）就用日志标题+user 标记覆盖 entries.title，未命中则原样保留。
	const displayEntries = React.useMemo(
		() => (logTitles === null ? entries : entries.map((e) => {
			const t = logTitles[e.sessionId];
			return t && typeof t.title === "string" && t.title !== ""
				? { ...e, title: t.title, userRenamed: t.user === true }
				: e;
		})),
		[entries, logTitles]
	);
	const queryTrim = query.trim().toLowerCase();
	const filteredEntries = React.useMemo(
		() => (queryTrim === "" ? displayEntries : displayEntries.filter((e) => entryMatchesQuery(e, models, queryTrim))),
		[displayEntries, models, queryTrim]
	);
	const groups = React.useMemo(
		() => groupAndSort(filteredEntries, models, sortMode),
		[filteredEntries, models, sortMode]
	);

	const toggleGroup = React.useCallback((key) => {
		setCollapsedGroups((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);

	const restoreOne = React.useCallback((sessionId) => {
		setRestoringIds((prev) => {
			if (prev.has(sessionId)) return prev;
			const next = new Set(prev);
			next.add(sessionId);
			return next;
		});
		setRestoreError(false); // 新一次找回动作清掉旧错误条
		let cancelled = false;
		fetch(API_RESTORE, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify({ sessionId })
		})
			.then(async (r) => {
				let data = {};
				try {
					data = await r.json();
				} catch {
					/* ignore */
				}
				return { status: r.status, ok: data && data.ok === true };
			})
			.then(({ status, ok }) => {
				if (cancelled) return;
				setRestoringIds((prev) => {
					if (!prev.has(sessionId)) return prev;
					const next = new Set(prev);
					next.delete(sessionId);
					return next;
				});
				if (status === 200 && ok) {
					// 成功：服务端广播会使 archivedSessionIds 移除本 id，本地列表自然缩短
				} else if (status === 404) {
					// not-archived：等同幂等成功
				} else {
					setRestoreError(true);
				}
			})
			.catch(() => {
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

	// 一键归档：POST /auto-archive/run；服务端 in-flight 复用，与定时 sweep 撞车时客户端
// 也能 await 到同一份 stats。按钮生命周期跟随面板，无需返回清理函数。
	const runAutoArchive = React.useCallback(() => {
		setArchiveStep("running");
		setArchiveError(false);
		setArchiveResult(null);
		fetch(API_AUTO_ARCHIVE_RUN, {
			method: "POST",
			headers: { accept: "application/json" }
		})
			.then(async (r) => {
				let data = {};
				try {
					data = await r.json();
				} catch {
					/* ignore */
				}
				return { status: r.status, ok: data && data.ok === true, stats: data && data.stats };
			})
			.then(({ status, ok, stats }) => {
				if (status === 200 && ok) {
					setArchiveResult(stats ?? {});
				} else {
					setArchiveError(true);
				}
				setArchiveStep("idle");
			})
			.catch(() => {
				setArchiveError(true);
				setArchiveStep("idle");
			});
	}, []);

	// —— 渲染 ——
	const head = React.createElement(
		"div",
		{ className: "af-modal-head" },
		React.createElement("span", { className: "af-modal-title" }, "归档会话找回"),
		React.createElement(
			"span",
			{ className: "af-modal-sub" },
			queryTrim === ""
				? "共 " + displayEntries.length + " 条"
				: "匹配 " + filteredEntries.length + " / 共 " + displayEntries.length + " 条"
		),
		React.createElement("span", { className: "af-spacer" }),
		React.createElement(
			"div",
			{ className: "af-segmented", role: "tablist" },
			React.createElement(
				"button",
				{
					type: "button",
					className: "af-btn af-segmented-btn" + (sortMode === "time" ? " af-segmented-btn--active" : ""),
					onClick: () => setSortMode("time")
				},
				"按时间"
			),
			React.createElement(
				"button",
				{
					type: "button",
					className: "af-btn af-segmented-btn" + (sortMode === "model" ? " af-segmented-btn--active" : ""),
					onClick: () => setSortMode("model")
				},
				"按模型"
			)
		),
		React.createElement(
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
				title: "归档 " + (ageDays ?? 3) + " 天未发言的会话（跳过：打开中/空白/子代理/找回 24h 宽限）",
				"aria-label": "归档 " + (ageDays ?? 3) + " 天前会话"
			},
			archiveStep === "running"
				? "归档中…"
				: archiveStep === "confirm"
					? "确认归档？"
					: "归档 " + (ageDays ?? 3) + " 天前会话"
		),
		React.createElement(
			"button",
			{
				type: "button",
				className: "af-btn af-icon-btn",
				onClick: loadModels,
				title: "刷新模型信息",
				"aria-label": "刷新模型信息"
			},
			React.createElement(IconRefreshOutline16, { size: 16 })
		),
		React.createElement(
			"button",
			{
				type: "button",
				className: "af-btn af-icon-btn",
				onClick: onClose,
				title: "关闭",
				"aria-label": "关闭"
			},
			React.createElement(IconCloseOutline16, { size: 16 })
		)
	);

	const searchBar = React.createElement(
		"div",
		{ className: "af-search" },
		React.createElement(IconSearchOutline16, { size: 16, className: "af-search__icon" }),
		React.createElement("input", {
			type: "text",
			className: "af-search__input",
			value: query,
			onChange: (e) => setQuery(e.target.value),
			placeholder: "搜索标题 / 目录 / 工作区 / 模型…",
			"aria-label": "搜索归档会话",
			autoFocus: true,
			spellCheck: false,
			autoComplete: "off"
		}),
		query !== ""
			? React.createElement(
				"button",
				{
					type: "button",
					className: "af-btn af-icon-btn af-search__clear",
					onClick: () => setQuery(""),
					title: "清除搜索",
					"aria-label": "清除搜索"
				},
				React.createElement(IconCloseOutline16, { size: 14 })
			)
			: null
	);

	const errorBanners = [];
	if (restoreError) {
		errorBanners.push(
			React.createElement(
				"div",
				{ key: "restore-error", className: "af-modal-error", role: "alert" },
				React.createElement("span", { className: "af-modal-error__text" }, "找回失败，请重试"),
				React.createElement(
					"button",
					{
						type: "button",
						className: "af-btn af-icon-btn af-modal-error__close",
						onClick: () => setRestoreError(false),
						"aria-label": "关闭错误提示",
						title: "关闭"
					},
					React.createElement(IconCloseOutline16, { size: 14 })
				)
			)
		);
	}
	if (modelsError) {
		errorBanners.push(
			React.createElement(
				"div",
				{ key: "models-error", className: "af-modal-error", role: "alert" },
				React.createElement("span", { className: "af-modal-error__text" }, "模型信息加载失败"),
				React.createElement(
					"button",
					{
						type: "button",
						className: "af-btn af-icon-btn af-modal-error__close",
						onClick: () => setModelsError(false),
						"aria-label": "关闭错误提示",
						title: "关闭"
					},
					React.createElement(IconCloseOutline16, { size: 14 })
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
		if (skipRecent > 0) skipParts.push("近期 " + skipRecent);
		if (skipLive > 0) skipParts.push("打开中 " + skipLive);
		if (skipBlank > 0) skipParts.push("空白 " + skipBlank);
		if (skipGrace > 0) skipParts.push("宽限 " + skipGrace);
		const skipSuffix = skipParts.length > 0 ? "（跳过：" + skipParts.join(" / ") + "）" : "";
		const failSuffix = failed > 0 ? "；失败 " + failed + " 条" : "";
		const mainText = archived > 0
			? "已归档 " + archived + " 条 · 共扫描 " + scanned + " 条" + skipSuffix
			: "没有需要归档的会话 · 共扫描 " + scanned + " 条" + skipSuffix;
		errorBanners.push(
			React.createElement(
				"div",
				{ key: "archive-info", className: "af-modal-info", role: "status" },
				React.createElement("span", { className: "af-modal-info__text" }, mainText + failSuffix),
				React.createElement(
					"button",
					{
						type: "button",
						className: "af-btn af-icon-btn af-modal-info__close",
						onClick: () => setArchiveResult(null),
						"aria-label": "关闭提示",
						title: "关闭"
					},
					React.createElement(IconCloseOutline16, { size: 14 })
				)
			)
		);
	}
	if (archiveError) {
		errorBanners.push(
			React.createElement(
				"div",
				{ key: "archive-error", className: "af-modal-error", role: "alert" },
				React.createElement("span", { className: "af-modal-error__text" }, "自动归档失败或已禁用，请重试"),
				React.createElement(
					"button",
					{
						type: "button",
						className: "af-btn af-icon-btn af-modal-error__close",
						onClick: () => setArchiveError(false),
						"aria-label": "关闭错误提示",
						title: "关闭"
					},
					React.createElement(IconCloseOutline16, { size: 14 })
				)
			)
		);
	}

	let body;
	if (displayEntries.length === 0) {
		body = React.createElement(
			"div",
			{ className: "af-empty" },
			"没有已归档的会话"
		);
	} else if (filteredEntries.length === 0) {
		body = React.createElement(
			"div",
			{ className: "af-empty" },
			"没有匹配「" + query.trim() + "」的归档会话"
		);
	} else {
		const groupNodes = groups.map((g) => {
			const collapsed = queryTrim === "" && collapsedGroups.has(g.key);
			const headRow = React.createElement(
				"div",
				{
					key: g.key + "-head",
					className: "af-group-head",
					onClick: () => toggleGroup(g.key),
					role: "button",
					"aria-expanded": collapsed ? "false" : "true"
				},
				collapsed
					? React.createElement(IconChevronRightOutline14, { size: 14 })
					: React.createElement(IconChevronDownOutline14, { size: 14 }),
				React.createElement("span", { className: "af-group-title" }, g.title),
				React.createElement("span", { className: "af-group-count" }, " · " + g.entries.length)
			);
			if (collapsed) {
				return React.createElement(
					"div",
					{ key: g.key, className: "af-group" },
					headRow
				);
			}
			const rows = g.entries.map((e) => {
				const inFlight = restoringIds.has(e.sessionId);
				const badgeModel = models === null ? undefined : (models[e.sessionId] ?? null);
				const metaTime = relativeTime(e.updatedAt);
				const metaBase = e.cwd ? baseName(e.cwd) : "";
				const absoluteTs = e.updatedAt
					? new Date(e.updatedAt).toLocaleString("zh-CN")
					: "时间未知";
				return React.createElement(
					"div",
					{ key: e.sessionId, className: "af-row" },
					React.createElement(
						"div",
						{ className: "af-row-main" },
						React.createElement(
							"div",
							{
								className: "af-row-title",
								title: e.title + " · " + absoluteTs
							},
							e.title,
							e.userRenamed === true
								? React.createElement(
									"span",
									{ className: "af-renamed", title: "你已重命名（标题取自会话日志真值）" },
									"✎"
								)
								: null
						),
						React.createElement(
							"div",
							{ className: "af-row-meta" },
							React.createElement("span", null, metaTime),
							React.createElement("span", { className: "af-badge" }, modelBadgeText(badgeModel)),
							metaBase
								? React.createElement("span", { className: "af-row-cwd" }, metaBase)
								: null
						)
					),
					React.createElement(
						"button",
						{
							type: "button",
							className: "af-btn af-restore-btn",
							disabled: inFlight,
							onClick: () => restoreOne(e.sessionId)
						},
						inFlight ? "找回中…" : "找回"
					)
				);
			});
			return React.createElement(
				"div",
				{ key: g.key, className: "af-group" },
				headRow,
				React.createElement(
					"div",
					{ key: g.key + "-list", className: "af-group-list" },
					rows
				)
			);
		});
		body = React.createElement(
			"div",
			{ className: "af-modal-body" },
			groupNodes
		);
	}

	return createPortal(
		React.createElement(
			"div",
			{
				className: "af-overlay",
				onClick: onClose,
				role: "presentation"
			},
			React.createElement(
				"div",
				{
					className: "af-modal",
					onClick: (e) => e.stopPropagation(),
					role: "dialog",
					"aria-modal": "true",
					"aria-label": "归档会话找回"
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

const APP_CSS =
	// 按钮基础重置
	".af-btn{border:none;background:none;font:inherit;color:inherit;padding:0;cursor:pointer}" +
	// 入口（wide / rail）
	".af-entry{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}" +
	".af-entry--wide{flex:1 1 0;min-width:0;justify-content:center;height:32px;margin:0 2px;padding:0 6px;border-radius:8px;font-size:12px;line-height:20px;overflow:hidden}" +
	".af-entry--wide:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary)}" +
	".af-entry--wide .af-entry__icon{flex:none}" +
	".af-entry--wide .af-entry__label{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
	".af-entry--rail{justify-content:center;width:36px;height:36px;margin:0 2px;border-radius:8px;color:var(--dsw-alias-label-secondary);flex:none}" +
	".af-entry--rail:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}" +
	".af-entry--rail .af-entry__icon{flex:none}" +
	// 计数徽标
	".af-count{display:inline-flex;align-items:center;justify-content:center;min-width:18px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;padding:0 8px;flex:none}" +
	// Modal 容器
	".af-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center}" +
	".af-modal{display:flex;flex-direction:column;width:min(720px,92vw);max-height:80vh;background:var(--dsw-alias-bg-layer-0,#fff);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.18);overflow:hidden}" +
	// 头部
	".af-modal-head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}" +
	".af-modal-title{font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary)}" +
	".af-modal-sub{font-size:12px;color:var(--dsw-alias-label-secondary)}" +
	".af-spacer{flex:1;min-width:0}" +
	".af-segmented{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;flex:none}" +
	".af-segmented-btn{font-size:12px;line-height:20px;padding:4px 10px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;cursor:pointer}" +
	".af-segmented-btn:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}" +
	".af-segmented-btn--active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}" +
	".af-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;cursor:pointer;flex:none}" +
	".af-icon-btn:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}" +
	// 错误条（头部下方）
	".af-modal-error{display:flex;align-items:center;gap:8px;padding:8px 16px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#e5484d);background:transparent;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}" +
	".af-modal-error__text{flex:1;min-width:0}" +
	".af-modal-error__close{margin-left:auto}" +
	// 列表区
	".af-modal-body{flex:1;min-height:0;overflow-y:auto;padding:8px 12px 12px;scrollbar-width:thin}" +
	".af-empty{display:flex;align-items:center;justify-content:center;padding:40px 0;color:var(--dsw-alias-label-secondary);font-size:13px}" +
	// 分组
	".af-group{margin-bottom:8px}" +
	".af-group-head{display:flex;align-items:center;gap:6px;padding:4px 8px;font-size:12px;color:var(--dsw-alias-label-secondary);border-radius:6px;cursor:pointer;user-select:none}" +
	".af-group-head:hover{background:var(--dsw-alias-bg-layer-1)}" +
	".af-group-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
	".af-group-count{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.7}" +
	".af-group-list{display:flex;flex-direction:column;gap:2px;padding-top:2px}" +
	// 会话行
	".af-row{display:flex;gap:8px;align-items:center;padding:8px;border-radius:8px}" +
	".af-row:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1))}" +
	".af-row-main{flex:1;min-width:0}" +
	".af-row-title{font-size:13px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
	".af-row-meta{display:flex;flex-wrap:wrap;gap:6px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary);margin-top:2px;align-items:center}" +
	".af-row-cwd{color:var(--dsw-alias-label-secondary)}" +
	".af-badge{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 8px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary);background:transparent;flex:none}" +
	".af-restore-btn{font-size:12px;padding:4px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);background:transparent;flex:none;line-height:18px}" +
	".af-restore-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}" +
	".af-restore-btn:disabled{opacity:.5;cursor:not-allowed}" +
	// 搜索框（head 与 errorBanners 之间）
	".af-search{display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}" +
	".af-search__icon{color:var(--dsw-alias-label-secondary);flex:none}" +
	".af-search__input{flex:1;min-width:0;font-size:13px;line-height:20px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);outline:none}" +
	".af-search__input:focus{border-color:var(--dsw-alias-state-focus,#4c9aff)}" +
	".af-search__input::placeholder{color:var(--dsw-alias-label-secondary)}" +
	// 标题真值覆盖标记：服务端从日志提取的标题是用户重命名后的版本，UI 加 ✎ 标记
	".af-renamed{display:inline-block;margin-left:6px;font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.75;flex:none}" +
	// 一键归档按钮（head 中 segmented 与刷新按钮之间）
	".af-autorun-btn{font-size:12px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);background:transparent;flex:none;line-height:18px;white-space:nowrap}" +
	".af-autorun-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}" +
	".af-autorun-btn:disabled{opacity:.5;cursor:not-allowed}" +
	".af-autorun-btn--confirm{border-color:var(--dsw-alias-state-error-primary,#e5484d);color:var(--dsw-alias-state-error-primary,#e5484d)}" +
	// 归档结果信息条（与 af-modal-error 平级，样式对齐但用次要色）
	".af-modal-info{display:flex;align-items:center;gap:8px;padding:8px 16px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);background:transparent;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}" +
	".af-modal-info__text{flex:1;min-width:0}" +
	".af-modal-info__close{margin-left:auto}";