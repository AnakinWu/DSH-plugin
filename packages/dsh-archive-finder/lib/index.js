const name = "archive-finder";
// workspaceRegistry：restore 走 registry.enqueueOperation + setState（与官方 archiveSession 同构，
// 该服务没有公开 unarchiveSession）。改的是 global.archivedSessionIds，不动 workspaces 表，
// 因此不触碰 dsh-workspace 的实体缓存不变量；apiproxy 监听 domain/changed 会自动向客户端广播
// host/archived-sessions-changed，侧边栏即时恢复显示。
// 自动归档：周期性 sweep sessionPersistence.list()，把「3 天未发言（官方 updatedAt 口径：
// max(createdAt, 最后一条 user 源 user/message 的 time)）、非 live、非 subagent、非 blank
// （日志含 turn/start 事件）、不在找回宽限期」的会话调官方 registry.archiveSession 归档
// （幂等、持久化，同样触发上述广播，侧边栏即时隐藏）。发言判定扫不清（uncertain）一律保守跳过。
const inject = ["webServer", "workspaceRegistry"];

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { zstdDecompressSync } from "node:zlib";

const MAX_LOG_BYTES = 64 * 1024 * 1024; // 超过则跳过模型提取（防内存爆）
const SCAN_TIME_BUDGET_MS = 5000; // 单次 models 请求的总提取预算
const BODY_LIMIT = 4096;

// ---------- 自动归档常量 ----------
// 阈值默认 3 天（用户口径 v1.3.0 由 4 改 3）。env 旋钮便于测试/调优：
//   DSH_ARCHIVE_FINDER_AUTO=off            整体关闭自动归档（默认开）
//   DSH_ARCHIVE_FINDER_AGE_DAYS            无活动天数阈值（默认 3）
//   DSH_ARCHIVE_FINDER_INTERVAL_HOURS      sweep 间隔（默认 6）
//   DSH_ARCHIVE_FINDER_FIRST_DELAY_S       插件加载后首跑延迟（默认 30，避开启动 I/O 高峰）
function envPositiveNumber(envName, fallback) {
	const raw = Number(process.env[envName]);
	return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
const AUTO_ARCHIVE_AGE_MS = envPositiveNumber("DSH_ARCHIVE_FINDER_AGE_DAYS", 3) * 864e5;
const AUTO_ARCHIVE_INTERVAL_MS = envPositiveNumber("DSH_ARCHIVE_FINDER_INTERVAL_HOURS", 6) * 36e5;
const AUTO_ARCHIVE_FIRST_DELAY_MS = envPositiveNumber("DSH_ARCHIVE_FINDER_FIRST_DELAY_S", 30) * 1e3;
const AUTO_ARCHIVE_DISABLED = process.env.DSH_ARCHIVE_FINDER_AUTO === "off";
// 手动找回宽限：找回 ≠ 已打开使用，24h 内不被自动复归档（防「找回一堆没来得及开又被收走」的乒乓）。
// 内存级：重启后宽限清零，重启后首跑把仍超期的找回会话重新归档——符合「老会话就该归档」的本意。
const RESTORE_GRACE_MS = 24 * 36e5;
// blank 守卫的扫描预算。官方 blank 定义 = 无任何 turn/start 事件；非 blank 会话的第一个
// turn/start 必在日志头部几 KB（实测：frame 6、解压 ~2.5KB 即命中），1MB 预算极为宽裕。
const TURN_SCAN_BUDGET_BYTES = 1024 * 1024;
const HEAD_READ_BYTES = 4 * 1024 * 1024; // zstd 压缩态头部读取上限（解压覆盖量远大于扫描预算）
// 「最后人类发言」反向扫描的解压预算：尾部命中即停（近期会话几帧即中）；干净扫满 8MB 仍无
// ⇒ 发言必然极久远 ⇒ 调用方回退 createdAt 安全（老到扫不到 = 该归档）。
const PROMPT_SCAN_BUDGET_BYTES = 8 * 1024 * 1024;

const errText = (e) => (e && e.message ? String(e.message) : String(e));

// ---------- zstd 帧遍历（2026-08-18 对真实会话日志实测：297 帧全消费、反向扫描命中模型）----------
// 背景：node:zlib 的 zstdDecompressSync 只解第一个 frame，而 DSH 会话日志是多帧追加写入，
// 必须逐帧定位边界后分别解压。帧头位布局：FHD 字节 bit7-6=FCS_flag, bit5=Single_Segment,
// bit2=Content_Checksum, bit1-0=Dictionary_ID（bit 位次曾踩坑写反，以此为准）。
function frameEnd(b, start) {
	const magic = b.readUInt32LE(start);
	if ((magic & 0xfffffff0) === 0x184d2a50) return start + 8 + b.readUInt32LE(start + 4); // skippable frame
	const fhd = b[start + 4];
	const fcsFlag = fhd >> 6;
	const single = (fhd >> 5) & 1;
	const checksum = (fhd >> 2) & 1;
	const dict = fhd & 3;
	let o = start + 5;
	if (!single) o += 1; // window descriptor
	o += dict === 0 ? 0 : dict === 3 ? 4 : dict;
	o += fcsFlag === 0 ? (single ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8;
	for (;;) {
		const bh = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
		const last = bh & 1;
		const type = (bh >> 1) & 3;
		const size = bh >>> 3;
		o += 3;
		if (type === 3) throw new Error("reserved zstd block type");
		o += type === 1 ? 1 : size; // RLE 块恒 1 字节；raw/compressed 为 size
		if (last) break;
	}
	if (checksum) o += 4;
	return o;
}

// 在一段 JSONL 文本里找最后一个可解析的 request/header 事件的模型配置。
// request/header 是每次 LLM 请求前落盘的事件，最后一个 = 该会话最后实际使用的模型
//（GUI 切模型后下一次请求才写新 header，语义上正是「用过的模型」）。
function scanTextForModel(text) {
	let idx = text.lastIndexOf('"type":"request/header"');
	while (idx >= 0) {
		const ls = text.lastIndexOf("\n", idx) + 1;
		let le = text.indexOf("\n", idx);
		if (le < 0) le = text.length;
		try {
			const cfg = JSON.parse(text.slice(ls, le))?.data?.header?.config;
			if (cfg && typeof cfg.provider === "string" && typeof cfg.model === "string") {
				return {
					provider: cfg.provider,
					model: cfg.model,
					...(typeof cfg.reasoningEffort === "string" ? { reasoningEffort: cfg.reasoningEffort } : {})
				};
			}
		} catch {
			// 行跨帧被截断或损坏：继续往前找上一个 request/header
		}
		idx = text.lastIndexOf('"type":"request/header"', idx - 1);
	}
	return null;
}

// 在一段 JSONL 文本里找最后一个可解析的 session/title 事件。
// 重命名 = 写 source.kind='user' 的 title 事件（pin 语义，latest-wins），所以最后一个
// title 事件 = 当前真值标题；不筛 kind（自动生成/回退/用户命名一律以最后为准），
// user 仅作客户端 ✎ 标记。逐行 JSON.parse（不用子串）防伪阳性。
// → {title, user, time} | null
function scanTextForTitle(text) {
	let idx = text.lastIndexOf('"type":"session/title"');
	while (idx >= 0) {
		const ls = text.lastIndexOf("\n", idx) + 1;
		let le = text.indexOf("\n", idx);
		if (le < 0) le = text.length;
		try {
			const ev = JSON.parse(text.slice(ls, le));
			const data = ev?.data;
			if (data && typeof data.title === "string" && data.title !== "") {
				return {
					title: data.title,
					user: data.source?.kind === "user",
					time: typeof ev.time === "number" ? ev.time : 0
				};
			}
		} catch {
			// 行跨帧被截断或损坏：继续往前找上一个 session/title
		}
		idx = text.lastIndexOf('"type":"session/title"', idx - 1);
	}
	return null;
}

// 从一份会话日志提取「事实包」{model, title}：zstd 逐帧反向扫描；明文 .jsonl 直接全文扫。
// model = 最后一个 request/header 的模型配置；title = 最后一个 session/title（标题真值，
// 抗投影缓存重启失真）。⚠️ 停止条件（DeepSeek 架构红线）：两种事实各自独立判定，反向迭代中
// 每种首次命中即该类型终值，必须「双目标齐命中」才停——严禁沿用旧版命中即 return 的结构
// （会把后一种事实漏在更早的帧里）。任何单维失败该维降级 null，不阻塞列表。
function extractLogFacts(filePath) {
	const st = statSync(filePath);
	if (st.size > MAX_LOG_BYTES) return { model: null, title: null };
	const buf = readFileSync(filePath);
	if (filePath.endsWith(".jsonl")) {
		const text = buf.toString("utf8");
		return { model: scanTextForModel(text), title: scanTextForTitle(text) };
	}
	const spans = [];
	let o = 0;
	while (o + 4 <= buf.length) {
		const m = buf.readUInt32LE(o);
		if (m !== 0xfd2fb528 && (m & 0xfffffff0) !== 0x184d2a50) break;
		const end = frameEnd(buf, o);
		if (end <= o) break;
		spans.push([o, end]);
		o = end;
	}
	let model = null;
	let title = null;
	let carry = ""; // 后一帧文本的首个不完整行头，拼回本帧尾部以还原跨帧行
	for (let i = spans.length - 1; i >= 0; i--) {
		if (model !== null && title !== null) break; // 双目标齐命中才停
		let text;
		try {
			text = zstdDecompressSync(buf.subarray(spans[i][0], spans[i][1])).toString("utf8");
		} catch {
			carry = "";
			continue;
		}
		const combined = carry === "" ? text : text + carry;
		if (model === null) model = scanTextForModel(combined);
		if (title === null) title = scanTextForTitle(combined);
		const nl = text.indexOf("\n");
		carry = nl < 0 ? text.slice(0, 512) : text.slice(0, Math.min(nl, 512));
	}
	return { model, title };
}

// ---------- 最后人类发言（官方 updatedAt 口径：type='user/message' 且 data.source.kind='user'） ----------
// 在一段 JSONL 文本里反向找最后一条人类发言的 event.time。显式 ev.type 二次确认
// （DeepSeek 必修）：防 session/title 等同样带 source.kind='user' 的事件经嵌套字符串带入锚点。
// 逐行 JSON.parse（不用子串）防伪阳性。→ epoch ms | null
function scanTextForLastPrompt(text) {
	let idx = text.lastIndexOf('"type":"user/message"');
	while (idx >= 0) {
		const ls = text.lastIndexOf("\n", idx) + 1;
		let le = text.indexOf("\n", idx);
		if (le < 0) le = text.length;
		try {
			const ev = JSON.parse(text.slice(ls, le));
			if (ev?.type === "user/message" && ev?.data?.source?.kind === "user" && typeof ev.time === "number") {
				return ev.time;
			}
		} catch {
			// 跨帧截断/损坏行：继续往前找上一条 user/message
		}
		idx = text.lastIndexOf('"type":"user/message"', idx - 1);
	}
	return null;
}

// 反向扫描日志取「最后人类发言时间」，三态返回（DeepSeek 必修：「没看清」与「真没有」分流）：
//   { t: number }       命中
//   { t: null }         全部帧干净扫完（或干净扫满预算）仍无 ⇒ 真没有/太久远 ⇒ 调用方可安全回退 createdAt
//   { uncertain: true } 帧解压失败或文件超 MAX_LOG_BYTES ⇒ 没看清 ⇒ 调用方必须保守跳过（不误归档）
// 跨帧行 carry 上限 64KB（DeepSeek 建议，防长 prompt 跨帧行被 512B 截断后永久丢失）。
function extractLastPromptAt(filePath) {
	const st = statSync(filePath);
	if (st.size > MAX_LOG_BYTES) return { uncertain: true };
	if (filePath.endsWith(".jsonl")) {
		const t = scanTextForLastPrompt(readFileSync(filePath).toString("utf8"));
		return t === null ? { t: null } : { t };
	}
	const buf = readFileSync(filePath);
	const spans = [];
	let o = 0;
	while (o + 4 <= buf.length) {
		const m = buf.readUInt32LE(o);
		if (m !== 0xfd2fb528 && (m & 0xfffffff0) !== 0x184d2a50) break;
		const end = frameEnd(buf, o);
		if (end <= o) break;
		spans.push([o, end]);
		o = end;
	}
	let carry = ""; // 后一帧文本的首个不完整行头，拼回本帧尾部以还原跨帧行
	let scanned = 0;
	for (let i = spans.length - 1; i >= 0; i--) {
		let text;
		try {
			text = zstdDecompressSync(buf.subarray(spans[i][0], spans[i][1])).toString("utf8");
		} catch {
			return { uncertain: true }; // dirty 帧：没看清，保守
		}
		const combined = carry === "" ? text : text + carry;
		const t = scanTextForLastPrompt(combined);
		if (t !== null) return { t };
		scanned += text.length;
		if (scanned > PROMPT_SCAN_BUDGET_BYTES) return { t: null }; // 干净扫满预算：太久远
		const nl = text.indexOf("\n");
		carry = nl < 0 ? text.slice(0, 65536) : text.slice(0, Math.min(nl, 65536));
	}
	return { t: null };
}

// ---------- blank 守卫：日志是否已开 turn（官方口径：无 turn/start 事件 = blank，list 隐藏） ----------
// 逐行 JSON.parse 判定，而非子串匹配：prompt/工具结果里可能含 '"type":"turn/start"' 字面值
// （例如讨论 DSH 事件格式本身的会话），子串扫描会把 blank 会话误判为非 blank 从而误归档。
// 跨帧的不完整行由 carry 拼回（按「整条行」而非固定字节数——帧边界可落在行的任意位置）。
function makeTurnStartScanner() {
	let carry = ""; // 上一块尾部的不完整行，拼到下一块头部
	let found = false;
	return {
		// 喂入一块文本；返回是否已命中（命中后调用方停止喂入）
		push(text) {
			if (found) return true;
			const lines = (carry + text).split("\n");
			carry = lines.pop(); // split 末尾必是不完整行（或空串），留给下一块
			for (const line of lines) {
				if (line === "") continue;
				try {
					if (JSON.parse(line)?.type === "turn/start") {
						found = true;
						return true;
					}
				} catch {
					// 非 JSON 行（健康日志不存在，跳过即可）
				}
			}
			return false;
		},
		// 流结束时冲刷最后一条无换行结尾的行（仅在已读到真实文件尾时才可调用）
		flush() {
			if (!found && carry !== "") {
				try {
					if (JSON.parse(carry)?.type === "turn/start") found = true;
				} catch {
					/* 尾行损坏：维持未命中 */
				}
				carry = "";
			}
			return found;
		}
	};
}

// 读文件头部最多 n 字节（避免为头部扫描把整个大日志读进内存）
function readHead(filePath, n) {
	const fd = openSync(filePath, "r");
	try {
		const buf = Buffer.alloc(n);
		const bytesRead = readSync(fd, buf, 0, n, 0);
		return buf.subarray(0, bytesRead);
	} finally {
		closeSync(fd);
	}
}

// 判断会话日志是否已含 turn/start（即非 blank）。从头扫描、命中即停；
// 预算内未命中（含帧损坏/解压失败/被预算截断）一律返回 false —— 判不了就保守视为 blank，
// 自动归档跳过该会话（宁可不归档，不可误归档不可见会话去污染找回面板）。
function logHasTurnStart(filePath) {
	const scanner = makeTurnStartScanner();
	if (filePath.endsWith(".jsonl")) {
		const st = statSync(filePath);
		const head = readHead(filePath, Math.min(st.size, TURN_SCAN_BUDGET_BYTES + 4096));
		if (scanner.push(head.toString("utf8"))) return true;
		// 只有完整读到文件尾才能冲刷尾行；被预算截断时尾行不完整，保守 false
		return st.size <= head.length ? scanner.flush() : false;
	}
	const head = readHead(filePath, HEAD_READ_BYTES);
	let o = 0;
	let scanned = 0;
	while (o + 4 <= head.length) {
		const m = head.readUInt32LE(o);
		if (m !== 0xfd2fb528 && (m & 0xfffffff0) !== 0x184d2a50) break;
		let end;
		try {
			end = frameEnd(head, o);
		} catch {
			break; // 帧头越界/损坏：后续连续性不可信，停扫
		}
		if (end <= o || end > head.length) break; // 头部切片边界上的不完整帧：停扫
		let text;
		try {
			text = zstdDecompressSync(head.subarray(o, end)).toString("utf8");
		} catch {
			break;
		}
		o = end;
		scanned += text.length;
		if (scanner.push(text)) return true;
		if (scanned > TURN_SCAN_BUDGET_BYTES) return false;
	}
	return scanner.flush();
}

function safeReaddir(dir) {
	try {
		return readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

function apply(ctx) {
	const webServer = ctx.webServer;
	const registry = ctx.workspaceRegistry;
	// 可选服务捕获：persistence 提供 list()/locate()/root（自动归档的枚举与定位来源），
	// sessions 提供 live 检测（get(id) !== undefined = 附着中）。两者缺一则自动归档整体禁用
	// —— 分不清「没有 live 会话」和「无法检测 live」时，绝不冒误归档打开中会话的险。
	const persistence = ctx.get("sessionPersistence");
	const liveSessions = ctx.get("sessions");
	// 会话日志根目录：优先用运行中的持久层服务暴露的 root（跟随实际配置），
	// 兜底 DSH_HOME / ~/.dsh/sessions。
	const persistenceRoot = persistence?.root;
	const sessionsRoot =
		typeof persistenceRoot === "string" && persistenceRoot !== ""
			? persistenceRoot
			: path.join(process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"), "sessions");

	// 日志事实缓存：filePath -> {mtimeMs, size, value:{model,title}}（mtime+size 双键，
	// 归档会话日志不再写入，基本恒命中）
	const factsCache = new Map();

	function findLogFile(sessionId) {
		for (const proj of safeReaddir(sessionsRoot)) {
			if (!proj.isDirectory()) continue;
			const dir = path.join(sessionsRoot, proj.name, sessionId);
			for (const f of ["session.jsonl.zstd", "session.jsonl"]) {
				const p = path.join(dir, f);
				if (existsSync(p)) return p;
			}
		}
		return null;
	}

	// 手持完整 header 时的日志定位（自动归档 sweep 用）：优先后端 locate() 精确路径
	// （零 readdir、项目段经 encodeSegment 正确转义）；locate 不可用/目标未物化时回退
	// findLogFile 暴力遍历（防御压缩配置与存量文件后缀不一致等）。找不到返回 null。
	function locateLogForHeader(header) {
		try {
			const loc = persistence?.locate?.(header);
			if (loc !== undefined && typeof loc.path === "string" && existsSync(loc.path)) return loc.path;
		} catch {
			// locate 是可选能力（如 sqlite 后端返回 undefined），异常一律走回退
		}
		return findLogFile(header.id);
	}

	// Browser-trust fence：loopback Host + sec-fetch-site 限制（与 termtabs/better-sidebar 同款，
	// DNS-rebinding 防护而非鉴权），GET/POST 一视同仁。
	const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
	function fence(req) {
		const host = String(req.headers.host || "");
		const hostname = host.replace(/^\[|\]$/g, "").split(":")[0].toLowerCase();
		if (!loopback.has(hostname)) return false;
		const secFetchSite = String(req.headers["sec-fetch-site"] || "");
		if (secFetchSite !== "" && secFetchSite !== "same-origin" && secFetchSite !== "none") return false;
		return true;
	}

	function json(res, status, value) {
		res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(value));
	}

	function readBody(req) {
		return new Promise((resolve, reject) => {
			const chunks = [];
			let size = 0;
			req.on("data", (c) => {
				size += c.length;
				if (size > BODY_LIMIT) {
					reject(new Error("body too large"));
					req.destroy();
					return;
				}
				chunks.push(c);
			});
			req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			req.on("error", reject);
		});
	}

	// GET /api/dsh-archive-finder/models
	// → { ok:true, archivedSessionIds:[...], models:{ <sessionId>: {provider,model,reasoningEffort} | null },
	//     titles:{ <sessionId>: {title,user,time} | null }, ageDays, generatedAt }
	// 列表数据（标题/时间/工作区归属）客户端从 useSessions/useWorkspaces store 自取（归档会话在 store 里，
	// 只是被 UI 层过滤），本接口补两类 store 里靠不住的字段：「模型」（store 本就没有）与「标题真值」
	// （store 的冷会话标题来自投影缓存，重命名不触发缓存落盘，重启后即失真；日志里最后一个
	// session/title 事件才是 latest-wins 真值，客户端据此覆盖显示标题）。
	// ageDays = 自动归档当前生效阈值（一键归档按钮文案据此显示真实口径，防 env 改参后 UI 说谎）。
	function handleModels(req, res) {
		if (!fence(req)) return json(res, 403, { ok: false, error: "forbidden" });
		const archived = [...registry.archivedSessionIds];
		const deadline = Date.now() + SCAN_TIME_BUDGET_MS;
		const models = {};
		const titles = {};
		for (const id of archived) {
			models[id] = null;
			titles[id] = null;
			if (Date.now() > deadline) continue;
			try {
				const p = findLogFile(id);
				if (p === null) continue;
				const st = statSync(p);
				const hit = factsCache.get(p);
				if (hit !== undefined && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
					models[id] = hit.value.model;
					titles[id] = hit.value.title;
					continue;
				}
				const value = extractLogFacts(p);
				factsCache.set(p, { mtimeMs: st.mtimeMs, size: st.size, value });
				models[id] = value.model;
				titles[id] = value.title;
			} catch (e) {
				ctx.logger?.warn?.(`archive-finder: log facts scan failed for ${id}: ${errText(e)}`);
			}
		}
		json(res, 200, {
			ok: true,
			archivedSessionIds: archived,
			models,
			titles,
			ageDays: AUTO_ARCHIVE_AGE_MS / 864e5,
			generatedAt: Date.now()
		});
	}

	// POST /api/dsh-archive-finder/restore  {sessionId}
	// → { ok:true, archivedSessionIds:[...] }；未归档的 id → 404 not-archived（幂等，客户端据此刷新）
	async function handleRestore(req, res) {
		if (!fence(req)) return json(res, 403, { ok: false, error: "forbidden" });
		let sessionId;
		try {
			const parsed = JSON.parse(await readBody(req));
			sessionId = typeof parsed?.sessionId === "string" ? parsed.sessionId : null;
		} catch {
			return json(res, 400, { ok: false, error: "bad-request" });
		}
		if (sessionId === null || sessionId === "") return json(res, 400, { ok: false, error: "bad-request" });
		if (!registry.archivedSessionIds.includes(sessionId)) return json(res, 404, { ok: false, error: "not-archived" });
		try {
			await registry.enqueueOperation(async () => {
				const state = registry.requireState();
				if (!state.archivedSessionIds.includes(sessionId)) return;
				await registry.setState({
					...state,
					archivedSessionIds: state.archivedSessionIds.filter((x) => x !== sessionId)
				});
			});
		} catch (e) {
			ctx.logger?.warn?.(`archive-finder: restore failed for ${sessionId}: ${errText(e)}`);
			return json(res, 500, { ok: false, error: "restore-failed" });
		}
		restoredGrace.set(sessionId, Date.now()); // 24h 内不被自动复归档（找回≠已打开使用）
		json(res, 200, { ok: true, archivedSessionIds: [...registry.archivedSessionIds] });
	}

	// ---------- 自动归档 sweep ----------
	// 找回宽限表：sessionId -> 找回时刻（epoch ms）。sweep 时顺手清理过期项，规模受找回频率约束。
	const restoredGrace = new Map();
	// in-flight 复用：定时触发与手动端点共享同一次 sweep（手动 await 到同一份 stats），
	// 避免并发两轮对 registry/archiveSession 的重复压力。
	let autoArchiveInFlight = null;

	// 单次 sweep：把「超龄未发言」的可见冷会话归档。逐条 try/catch，任何单会话失败不中断整轮。
	// 会抛的错误只剩 persistence.list() 整表失败（由调用方兜底记日志/500）。
	async function autoArchiveSweep() {
		const now = Date.now();
		const cutoff = now - AUTO_ARCHIVE_AGE_MS;
		const stats = {
			scanned: 0, archived: 0,
			skippedArchived: 0, skippedSubagent: 0, skippedLive: 0, skippedGrace: 0,
			skippedRecent: 0, skippedNoLog: 0, skippedBlank: 0, skippedUncertain: 0,
			skippedUnknown: 0, failed: 0
		};
		const headers = await persistence.list(); // 快照数组；归档推进不改变本次枚举
		const archived = new Set(registry.archivedSessionIds);
		for (const h of headers) {
			stats.scanned++;
			const id = h.id;
			if (archived.has(id)) { stats.skippedArchived++; continue; }
			// 子代理会话：找回面板本就不展示（origin=subagent 被客户端过滤），归档只污染计数徽标
			if (h.origin === "subagent") { stats.skippedSubagent++; continue; }
			// live = 附着中（某个标签页打开着）：属于「在用」，不动
			if (liveSessions.get(id) !== undefined) { stats.skippedLive++; continue; }
			const graceAt = restoredGrace.get(id);
			if (graceAt !== undefined) {
				if (now - graceAt < RESTORE_GRACE_MS) { stats.skippedGrace++; continue; }
				restoredGrace.delete(id); // 宽限过期，清掉防泄漏
			}
			// createdAt 短路（DeepSeek 必修）：lastActivity = max(createdAt, lastPromptAt)，
			// createdAt 本身还在窗口内则恒 recent，无需扫日志——扫描集只剩「创建即超龄」的候选
			const createdAt = typeof h.createdAt === "number" ? h.createdAt : 0;
			if (createdAt > cutoff) { stats.skippedRecent++; continue; }
			let p = null;
			try {
				p = locateLogForHeader(h);
			} catch {
				p = null;
			}
			if (p === null) { stats.skippedNoLog++; continue; } // 懒物化的空壳会话本就不可见，不动
			// 年龄口径 = 官方 updatedAt：max(createdAt, 最后一次人类发言)。发言扫描找不到（干净）
			// 回退 createdAt（老到扫不到 = 该归档）；没看清（uncertain）保守跳过。
			let promptAt = null;
			try {
				const r = extractLastPromptAt(p);
				if (r.uncertain === true) { stats.skippedUncertain++; continue; }
				promptAt = r.t;
			} catch (e) {
				ctx.logger?.warn?.(`archive-finder: prompt-scan failed for ${id}: ${errText(e)}`);
				stats.skippedNoLog++;
				continue;
			}
			const lastActivity = Math.max(createdAt, promptAt ?? 0);
			if (lastActivity > cutoff) { stats.skippedRecent++; continue; }
			let hasTurn = false;
			try {
				hasTurn = logHasTurnStart(p);
			} catch (e) {
				ctx.logger?.warn?.(`archive-finder: turn-scan failed for ${id}: ${errText(e)}`);
			}
			// blank（含判不出来）：list 里本来就不可见，归档只会给找回面板刷「未命名会话」
			if (!hasTurn) { stats.skippedBlank++; continue; }
			// TOCTOU 二次确认：扫描耗时段内被打开的会话不抢归档
			if (liveSessions.get(id) !== undefined) { stats.skippedLive++; continue; }
			try {
				await registry.archiveSession(id); // 官方 API：幂等、持久化、触发广播
				stats.archived++;
				ctx.logger?.info?.(
					`archive-finder: auto-archived ${id} (last activity ${new Date(lastActivity).toISOString()})`
				);
			} catch (e) {
				// 枚举快照与归档之间的删除竞态：计跳过而非失败
				if (e && e.name === "WorkspaceUnknownSessionError") stats.skippedUnknown++;
				else {
					stats.failed++;
					ctx.logger?.warn?.(`archive-finder: auto-archive ${id} failed: ${errText(e)}`);
				}
			}
		}
		return stats;
	}

	function runAutoArchiveSweep() {
		if (autoArchiveInFlight !== null) return autoArchiveInFlight;
		autoArchiveInFlight = autoArchiveSweep()
			.then((stats) => {
				ctx.logger?.info?.(`archive-finder: auto-archive sweep: ${JSON.stringify(stats)}`);
				return stats;
			})
			.finally(() => {
				autoArchiveInFlight = null;
			});
		return autoArchiveInFlight;
	}

	// POST /api/dsh-archive-finder/auto-archive/run
	// → { ok:true, stats, ageDays, intervalHours, generatedAt }；手动触发（测试/立即执行），
	// 与定时 sweep 复用 in-flight；list() 整表失败 → 500。
	async function handleAutoArchiveRun(req, res) {
		if (!fence(req)) return json(res, 403, { ok: false, error: "forbidden" });
		if (AUTO_ARCHIVE_DISABLED) return json(res, 403, { ok: false, error: "auto-archive-disabled" });
		if (persistence === undefined || typeof persistence?.list !== "function" || liveSessions === undefined) {
			return json(res, 403, { ok: false, error: "auto-archive-unavailable" });
		}
		try {
			const stats = await runAutoArchiveSweep();
			json(res, 200, {
				ok: true,
				stats,
				ageDays: AUTO_ARCHIVE_AGE_MS / 864e5,
				intervalHours: AUTO_ARCHIVE_INTERVAL_MS / 36e5,
				generatedAt: Date.now()
			});
		} catch (e) {
			json(res, 500, { ok: false, error: errText(e) });
		}
	}

	ctx.effect(() => {
		const disposers = [];
		disposers.push(
			webServer.register({ kind: "exact", path: "/api/dsh-archive-finder/models", handler: (req, res) => handleModels(req, res) })
		);
		disposers.push(
			webServer.register({
				kind: "exact",
				path: "/api/dsh-archive-finder/restore",
				handler: (req, res) => {
					handleRestore(req, res).catch((e) => json(res, 500, { ok: false, error: errText(e) }));
				}
			})
		);
		disposers.push(
			webServer.register({
				kind: "exact",
				path: "/api/dsh-archive-finder/auto-archive/run",
				handler: (req, res) => {
					handleAutoArchiveRun(req, res).catch((e) => json(res, 500, { ok: false, error: errText(e) }));
				}
			})
		);
		return () => {
			for (const d of disposers) d();
		};
	}, "dsh-archive-finder: routes");

	// 自动归档调度：首跑延迟 AUTO_ARCHIVE_FIRST_DELAY_MS（避开启动 I/O 高峰），之后固定间隔。
	// persistence/sessions 任一缺失或 env 关闭时整体不启用（记一行 info 说明原因）。
	ctx.effect(() => {
		if (AUTO_ARCHIVE_DISABLED) {
			ctx.logger?.info?.("archive-finder: auto-archive disabled (DSH_ARCHIVE_FINDER_AUTO=off)");
			return () => {};
		}
		if (persistence === undefined || typeof persistence?.list !== "function" || liveSessions === undefined) {
			ctx.logger?.info?.("archive-finder: auto-archive disabled (sessionPersistence/sessions service unavailable)");
			return () => {};
		}
		ctx.logger?.info?.(
			`archive-finder: auto-archive enabled (age ${AUTO_ARCHIVE_AGE_MS / 864e5}d, ` +
				`every ${AUTO_ARCHIVE_INTERVAL_MS / 36e5}h, first run in ${AUTO_ARCHIVE_FIRST_DELAY_MS / 1e3}s)`
		);
		const onTick = () => {
			runAutoArchiveSweep().catch((e) =>
				ctx.logger?.warn?.(`archive-finder: auto-archive sweep failed: ${errText(e)}`)
			);
		};
		const first = setTimeout(onTick, AUTO_ARCHIVE_FIRST_DELAY_MS);
		const interval = setInterval(onTick, AUTO_ARCHIVE_INTERVAL_MS);
		return () => {
			clearTimeout(first);
			clearInterval(interval);
		};
	}, "dsh-archive-finder: auto-archive");
}

export { apply, inject, name };
