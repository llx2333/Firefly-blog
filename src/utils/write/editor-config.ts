/**
 * 批31 lua 配置系统（自包含，模块级可验证；组件接线归集成阶段）。
 *
 * 数据流：
 *   GitHub write-drafts 分支 lua/ 目录（init.lua 入口系统自带不可删）
 *   → fetchLuaConfig 拉取全部 .lua 文本（listDraftTree 递归列举）
 *   → runLuaConfig：wasmoon 动态 import（onMount 后才执行，SSR 安全、不进主 chunk），
 *     全部文件挂载进 Lua VM 虚拟文件系统（mountFile），跑 init.lua，
 *     require("lua.自建模块") 走标准 package.path 解析挂载文件；
 *   → ff 表在 init.lua 执行前注入（真 Lua 表）：ff.opt 留给用户赋值（跑完白名单
 *     回读），ff.map(mode, lhs, rhs) 转发进 JS 记录键位；
 *   → applyLuaConfig：白名单字段应用到 CM 编辑器（handle.applyLua），vim/layout
 *     写偏好并热切换；未列出的 ff 字段一律忽略（宁缺勿错）。
 *
 * 兜底：init.lua 缺失/语法错误/网络失败 → console.warn + 状态徽标（subscribeLuaStatus），
 * 编辑器恢复默认形态照常可用，绝不阻塞写作。
 *
 * SSR 纪律：wasmoon 与 wasm 资产全部走动态 import 且只在函数体内执行；模块顶层
 * 只有常量与类型，客户端岛屿在 SSR/构建期执行本模块顶层不会触碰 Lua VM。
 */

import {
	type CmEditorHandle,
	type EditorLayout,
	writeLayoutPref,
	writeVimPref,
} from "./cm-editor";
import {
	draftFileText,
	ensureDraftsBranch,
	fetchDraftFile,
	listDraftTree,
	saveDraftFile,
} from "./drafts";
import { describeGitHubError } from "./github";

// ---------- 常量 ----------

/** 配置文件树根目录（write-drafts 分支内） */
export const LUA_DIR = "lua";
/** 配置入口文件（系统自带不可删） */
export const INIT_LUA_PATH = "lua/init.lua";

/**
 * init.lua 默认内容：纯注释示例（ff.opt / ff.map / require 各一），去掉行首
 * `-- ` 即启用。首次打开配置弹层时 ensure 存在。
 */
export const DEFAULT_INIT_LUA = `-- Firefly 编辑器配置入口（系统自带，不可删除；lua/ 下其他文件可自由增删）。
-- 保存后点「重载配置」立即生效；语法错误会被忽略并提示，编辑器照常可用。
-- 以下示例默认全部注释，去掉行首 -- 即启用。

-- ff.opt 选项（未列出的字段一律忽略；缺省 = 站点默认值）
-- ff.opt.tab_size = 2          -- 缩进宽度：Tab 实得 2 个空格
-- ff.opt.wrap = false          -- 自动换行（缺省开启）
-- ff.opt.vim = true            -- 初始进入 vim 模式（之后仍可手动切换）
-- ff.opt.indent_guides = false -- 缩进竖线（缺省开启）
-- ff.opt.layout = "edit"       -- 编辑器布局："edit" | "split" | "preview"

-- ff.map 键位映射（mode 限 "normal" / "insert"）
-- ff.map("insert", "jj", "<Esc>")      -- 右侧为按键记法：转发该按键（此处退出插入模式）
-- ff.map("normal", "<C-s>", "save")    -- 右侧为命令名：save = 保存当前文章
-- ff.map("normal", "gq", function()    -- 右侧也可以是 lua 函数
--   print("hello from firefly lua")
-- end)

-- 模块引用示例：新建 lua/mymodule.lua 后即可 require
-- local mymodule = require("lua.mymodule")
-- mymodule.hello()
`;

// ---------- 类型 ----------

export type LuaMapMode = "normal" | "insert";

/** 解析后的单键（CM6 键名 + 合成事件参数） */
export interface ParsedKey {
	/** CM6 keymap 键名（"Escape" / "Ctrl-s" / "j" / " "） */
	cmKey: string;
	/** 可打印单字符（多键序列缓冲回放用）；带修饰键或非打印键为 null */
	char: string | null;
	/** 合成 KeyboardEvent 参数（rhs 为按键记法时转发用） */
	eventInit: {
		key: string;
		ctrlKey: boolean;
		shiftKey: boolean;
		altKey: boolean;
	};
}

export type LuaMappingRhs =
	| { kind: "command"; name: string }
	| { kind: "key"; key: ParsedKey }
	| { kind: "lua"; fn: unknown };

export interface LuaMapping {
	mode: LuaMapMode;
	/** 用户原始 lhs 记法（vim 开启时 normal 映射原样交给 @replit/codemirror-vim） */
	notion: string;
	/** 单键解析结果；纯序列时为 null */
	key: ParsedKey | null;
	/** 多键序列原文（如 "jj"）；null = 单键 */
	sequence: string | null;
	rhs: LuaMappingRhs;
}

/** 一轮 lua 配置的解析结果（白名单字段 + 键位；其余 ff 字段已丢弃） */
export interface LuaEditorSpec {
	tabSize?: number;
	wrap?: boolean;
	vim?: boolean;
	indentGuides?: boolean;
	layout?: EditorLayout;
	mappings: LuaMapping[];
	/** init.lua 缺失或执行报错时的提示（配置仍按默认兜底应用） */
	initError: string | null;
}

export interface LuaConfigBundle {
	/** path → 文件全文 */
	files: Map<string, string>;
	/** 文件路径列表（树遍历顺序） */
	order: string[];
}

export type LuaStatusState = "idle" | "loading" | "ok" | "error";

export interface LuaStatus {
	state: LuaStatusState;
	message: string;
	at: number;
}

// ---------- 键位记法解析 ----------

const NAMED_KEYS: Record<string, string> = {
	esc: "Escape",
	escape: "Escape",
	cr: "Enter",
	enter: "Enter",
	return: "Enter",
	tab: "Tab",
	space: " ",
	bs: "Backspace",
	backspace: "Backspace",
	del: "Delete",
	delete: "Delete",
	ins: "Insert",
	insert: "Insert",
	up: "ArrowUp",
	down: "ArrowDown",
	left: "ArrowLeft",
	right: "ArrowRight",
	home: "Home",
	end: "End",
	pageup: "PageUp",
	pagedown: "PageDown",
};

/** CM6 键名 → KeyboardEvent.key（合成事件转发用） */
const EVENT_KEYS: Record<string, string> = {
	Escape: "Escape",
	Enter: "Enter",
	Tab: "Tab",
	" ": " ",
	Backspace: "Backspace",
	Delete: "Delete",
	Insert: "Insert",
	ArrowUp: "ArrowUp",
	ArrowDown: "ArrowDown",
	ArrowLeft: "ArrowLeft",
	ArrowRight: "ArrowRight",
	Home: "Home",
	End: "End",
	PageUp: "PageUp",
	PageDown: "PageDown",
};

function isPrintableAscii(ch: string): boolean {
	return ch.length === 1 && ch >= "!" && ch <= "~";
}

/** 解析按键记法（'<Esc>' / '<C-s>' / 单字符）；非法返回 null */
export function parseKeyNotion(notion: string): ParsedKey | null {
	const raw = notion.trim();
	if (!raw) return null;
	if (raw.startsWith("<") && raw.endsWith(">") && raw.length >= 3) {
		let ctrl = false;
		let shift = false;
		let alt = false;
		let rest = raw.slice(1, -1);
		for (;;) {
			const m = /^([CSMA])-(.*)$/.exec(rest);
			if (!m) break;
			const flag = m[1].toUpperCase();
			if (flag === "C") ctrl = true;
			else if (flag === "S") shift = true;
			else if (flag === "A" || flag === "M") alt = true;
			rest = m[2];
		}
		if (!rest) return null;
		let base = NAMED_KEYS[rest.toLowerCase()];
		if (!base) {
			if (/^f([1-9]|1[0-2])$/i.test(rest)) base = rest.toUpperCase();
			else if (isPrintableAscii(rest)) base = rest;
			else return null;
		}
		const char = base.length === 1 && !ctrl && !alt && !shift ? base : null;
		return {
			cmKey: `${ctrl ? "Ctrl-" : ""}${alt ? "Alt-" : ""}${shift ? "Shift-" : ""}${base}`,
			char,
			eventInit: {
				key: EVENT_KEYS[base] ?? base,
				ctrlKey: ctrl,
				shiftKey: shift,
				altKey: alt,
			},
		};
	}
	// 非 <> 包裹：单字符键或多键序列（序列只收可打印 ASCII，宁缺勿错）
	if (raw.length === 1 && isPrintableAscii(raw)) {
		return {
			cmKey: raw,
			char: raw,
			eventInit: { key: raw, ctrlKey: false, shiftKey: false, altKey: false },
		};
	}
	return null;
}

/** lhs 整体解析：单键或纯可打印序列；非法返回 null */
export function parseMappingLhs(
	notion: string,
): { key: ParsedKey | null; sequence: string | null } | null {
	const raw = notion.trim();
	if (!raw) return null;
	if (raw.length === 1 || (raw.startsWith("<") && raw.endsWith(">"))) {
		const key = parseKeyNotion(raw);
		return key ? { key, sequence: null } : null;
	}
	// 多键序列：每个字符都必须是可打印单键（j j / g d 等）
	for (const ch of raw) {
		if (!isPrintableAscii(ch)) return null;
	}
	return { key: null, sequence: raw };
}

// ---------- 编辑器命令注册（'save' 等由组件在接线时注册） ----------

const editorCommands = new Map<string, () => void>();

/** 注册编辑器命令（rhs 为命令字符串时查找；重名覆盖） */
export function registerEditorCommand(name: string, fn: () => void): void {
	editorCommands.set(name, fn);
}

/** 取命令（未注册返回 null——宁缺勿错，按键时仅 console.warn） */
export function getEditorCommand(name: string): (() => void) | null {
	return editorCommands.get(name) ?? null;
}

// ---------- 状态徽标（弹层 / 顶栏共用） ----------

let luaStatus: LuaStatus = { state: "idle", message: "", at: 0 };
const statusListeners = new Set<(status: LuaStatus) => void>();

function setStatus(state: LuaStatusState, message: string): void {
	luaStatus = { state, message, at: Date.now() };
	for (const cb of statusListeners) {
		try {
			cb(luaStatus);
		} catch {
			/* 监听者报错不影响状态分发 */
		}
	}
}

/** 订阅配置状态变化（错误徽标）；返回取消函数 */
export function subscribeLuaStatus(
	cb: (status: LuaStatus) => void,
): () => void {
	statusListeners.add(cb);
	cb(luaStatus);
	return () => statusListeners.delete(cb);
}

export function getLuaStatus(): LuaStatus {
	return luaStatus;
}

// ---------- layout 联动（lua 设置 layout 时通知组件切换） ----------

const layoutListeners = new Set<(layout: EditorLayout) => void>();

/** 订阅 lua 配置解析出的布局（组件用它切 reactive 状态）；返回取消函数 */
export function onLuaLayout(cb: (layout: EditorLayout) => void): () => void {
	layoutListeners.add(cb);
	return () => layoutListeners.delete(cb);
}

// ---------- 拉取（GitHub contents API，mock 拦截友好：全部走 window.fetch） ----------

/** 拉取 lua/ 目录下全部 .lua（递归）；目录不存在 = 空配置（不触发建分支） */
export async function fetchLuaConfig(token: string): Promise<LuaConfigBundle> {
	const entries = await listDraftTree(token, LUA_DIR);
	const luaEntries = entries.filter((entry) => /\.lua$/i.test(entry.name));
	const loaded = await Promise.all(
		luaEntries.map(async (entry) => {
			const file = await fetchDraftFile(token, entry.path);
			return file ? { path: entry.path, text: draftFileText(file) } : null;
		}),
	);
	const files = new Map<string, string>();
	const order: string[] = [];
	for (const item of loaded) {
		if (!item) continue;
		files.set(item.path, item.text);
		order.push(item.path);
	}
	return { files, order };
}

/** 首次打开弹层时确保 init.lua 存在；返回 true = 本次新建 */
export async function ensureInitLua(token: string): Promise<boolean> {
	await ensureDraftsBranch(token);
	const existing = await fetchDraftFile(token, INIT_LUA_PATH);
	if (existing) return false;
	await saveDraftFile(
		token,
		INIT_LUA_PATH,
		DEFAULT_INIT_LUA,
		"write(draft): 初始化 lua 配置入口",
	);
	return true;
}

// ---------- 执行（wasmoon） ----------

/** 默认兜底配置：清空键位、恢复站点默认选项 */
export const DEFAULT_LUA_SPEC: LuaEditorSpec = {
	mappings: [],
	initError: null,
};

type LuaEngine = import("wasmoon").LuaEngine;

let activeEngine: LuaEngine | null = null;
let runSeq = 0;

function closeEngine(engine: LuaEngine | null): void {
	if (!engine) return;
	try {
		engine.global.close();
	} catch {
		/* 引擎可能已随上下文销毁 */
	}
}

/** init.lua 里的键位映射记录入口（Lua → JS 转发） */
function recordMapping(
	out: LuaMapping[],
	mode: unknown,
	lhs: unknown,
	rhs: unknown,
): void {
	const where = "ff.map";
	if (mode !== "normal" && mode !== "insert") {
		console.warn(
			`[ff.lua] ${where} mode 只接受 'normal' | 'insert'，已忽略：${String(mode)}`,
		);
		return;
	}
	if (typeof lhs !== "string" || !lhs.trim()) {
		console.warn(`[ff.lua] ${where} lhs 非法，已忽略`);
		return;
	}
	const parsed = parseMappingLhs(lhs);
	if (!parsed) {
		console.warn(`[ff.lua] ${where} 无法解析键位，已忽略：${lhs}`);
		return;
	}
	let parsedRhs: LuaMappingRhs;
	if (typeof rhs === "function") {
		parsedRhs = { kind: "lua", fn: rhs };
	} else if (typeof rhs === "string" && rhs.trim()) {
		const text = rhs.trim();
		const asKey = text.startsWith("<") ? parseKeyNotion(text) : null;
		parsedRhs = asKey
			? { kind: "key", key: asKey }
			: { kind: "command", name: text };
	} else {
		console.warn(
			`[ff.lua] ${where} rhs 非法（须为命令字符串或 lua 函数），已忽略`,
		);
		return;
	}
	out.push({
		mode,
		notion: lhs.trim(),
		key: parsed.key,
		sequence: parsed.sequence,
		rhs: parsedRhs,
	});
}

/** 白名单回读 ff.opt 单字段（ff 被整体重定义等情况安全返回 undefined） */
async function readLuaOption(
	engine: LuaEngine,
	field: string,
): Promise<unknown> {
	const script = `if type(ff) == 'table' and type(ff.opt) == 'table' then return ff.opt.${field} end`;
	try {
		return await engine.doString(script);
	} catch {
		return undefined;
	}
}

function warnIgnored(field: string, value: unknown, expect: string): void {
	console.warn(
		`[ff.lua] ff.opt.${field} = ${String(value)} 不是${expect}，已忽略（宁缺勿错）`,
	);
}

const TAB_SIZE_MIN = 1;
const TAB_SIZE_MAX = 12;

/**
 * 挂载并执行 lua 配置 → 白名单解析。
 * 并发保护：新一轮开始后，上一轮返回 null（调用方放弃应用）。
 */
export async function runLuaConfig(
	bundle: LuaConfigBundle,
): Promise<LuaEditorSpec | null> {
	const run = ++runSeq;
	const { LuaFactory } = await import("wasmoon");
	// wasm 取本包资产（构建进站点，不走 wasmoon 默认的 unpkg CDN 兜底）
	const { default: wasmUri } = await import("wasmoon/dist/glue.wasm?url");
	const factory = new LuaFactory(wasmUri);
	if (run !== runSeq) return null;
	const engine = await factory.createEngine();
	if (run !== runSeq) {
		closeEngine(engine);
		return null;
	}
	closeEngine(activeEngine);
	activeEngine = engine;

	const mappings: LuaMapping[] = [];
	// ff 表先于 init.lua 注入（真 Lua 表：用户可 ff.opt.x = v；map 转发进 JS）
	engine.global.set(
		"__ff_map_js",
		(mode: unknown, lhs: unknown, rhs: unknown) => {
			recordMapping(mappings, mode, lhs, rhs);
		},
	);
	await engine.doString(
		"ff = { opt = {}, map = function(mode, lhs, rhs) __ff_map_js(mode, lhs, rhs) end }",
	);
	// require 自建模块：确保 package.path 覆盖 CWD 相对形式（挂载文件在 MEMFS 根下）
	await engine.doString(
		"package.path = package.path .. ';./?.lua;./?/init.lua'",
	);
	// 挂载全部 .lua（路径即 require 模块路径：lua/mymodule.lua ↔ require('lua.mymodule')）
	for (const [path, text] of bundle.files) {
		await factory.mountFile(path, text);
	}
	if (run !== runSeq) return null;

	const spec: LuaEditorSpec = { mappings, initError: null };
	const initText = bundle.files.get(INIT_LUA_PATH);
	if (initText === undefined) {
		// 空目录（lua/ 未初始化）不算错误：走「目录为空」ok 口径；
		// 有其他 .lua 却缺入口才算异常（罕见，人工删除入口）。
		if (bundle.files.size > 0) {
			spec.initError = "lua/init.lua 不存在（将使用默认配置）";
		}
	} else {
		try {
			await engine.doString(initText);
		} catch (error) {
			spec.initError = error instanceof Error ? error.message : String(error);
			console.warn(
				"[ff.lua] init.lua 执行失败（编辑器照常可用，兜底默认配置）：",
				spec.initError,
			);
		}
	}
	if (run !== runSeq) return null;

	// ---- 白名单回读 ff.opt（其余字段一律忽略） ----
	const tabRaw = await readLuaOption(engine, "tab_size");
	if (
		typeof tabRaw === "number" &&
		Number.isInteger(tabRaw) &&
		tabRaw >= TAB_SIZE_MIN &&
		tabRaw <= TAB_SIZE_MAX
	) {
		spec.tabSize = tabRaw;
	} else if (tabRaw !== undefined && tabRaw !== null) {
		warnIgnored("tab_size", tabRaw, "1-12 的整数");
	}

	const wrapRaw = await readLuaOption(engine, "wrap");
	if (typeof wrapRaw === "boolean") spec.wrap = wrapRaw;
	else if (wrapRaw !== undefined && wrapRaw !== null)
		warnIgnored("wrap", wrapRaw, "布尔值");

	const vimRaw = await readLuaOption(engine, "vim");
	if (typeof vimRaw === "boolean") spec.vim = vimRaw;
	else if (vimRaw !== undefined && vimRaw !== null)
		warnIgnored("vim", vimRaw, "布尔值");

	const guidesRaw = await readLuaOption(engine, "indent_guides");
	if (typeof guidesRaw === "boolean") spec.indentGuides = guidesRaw;
	else if (guidesRaw !== undefined && guidesRaw !== null)
		warnIgnored("indent_guides", guidesRaw, "布尔值");

	const layoutRaw = await readLuaOption(engine, "layout");
	if (
		layoutRaw === "edit" ||
		layoutRaw === "split" ||
		layoutRaw === "preview"
	) {
		spec.layout = layoutRaw;
	} else if (layoutRaw !== undefined && layoutRaw !== null) {
		warnIgnored("layout", layoutRaw, "'edit' | 'split' | 'preview'");
	}

	return spec;
}

// ---------- 应用 ----------

/**
 * 把解析后的配置应用到编辑器：CM 侧（缩进/换行/竖线/键位）走 handle.applyLua，
 * vim 走 handle.setVim + 偏好持久化，layout 写偏好并广播给组件。
 */
export async function applyLuaConfig(
	handle: CmEditorHandle,
	spec: LuaEditorSpec,
): Promise<void> {
	if (typeof handle.applyLua === "function") {
		await handle.applyLua({
			tabSize: spec.tabSize,
			wrap: spec.wrap,
			indentGuides: spec.indentGuides,
			mappings: spec.mappings,
		});
	}
	if (spec.vim !== undefined) {
		writeVimPref(spec.vim);
		await handle.setVim(spec.vim);
	}
	if (spec.layout !== undefined) {
		writeLayoutPref(spec.layout);
		for (const cb of layoutListeners) {
			try {
				cb(spec.layout);
			} catch {
				/* 组件回调报错不影响其余应用 */
			}
		}
	}
}

/**
 * 编辑器初始化与「重载配置」的统一入口：拉取 → 执行 → 应用 → 状态徽标。
 * 任何失败都兜底：console.warn + error 状态 + 编辑器恢复默认形态，返回 null。
 */
export async function reloadLuaConfig(
	token: string,
	handle: CmEditorHandle | null,
): Promise<LuaEditorSpec | null> {
	setStatus("loading", "正在加载 lua 配置……");
	try {
		const bundle = await fetchLuaConfig(token);
		const spec = await runLuaConfig(bundle);
		if (!spec) return null; // 已被更新的加载取代
		if (handle) await applyLuaConfig(handle, spec);
		if (spec.initError) {
			setStatus("error", `lua 配置执行失败：${spec.initError}`);
		} else if (bundle.files.size === 0) {
			setStatus("ok", "lua 配置目录为空，使用默认配置");
		} else {
			setStatus(
				"ok",
				`lua 配置已生效（${bundle.files.size} 个文件，${spec.mappings.length} 条键位）`,
			);
		}
		return spec;
	} catch (error) {
		console.warn("[ff.lua] lua 配置加载失败（编辑器照常可用）：", error);
		setStatus("error", describeGitHubError(error));
		if (handle) {
			try {
				await applyLuaConfig(handle, DEFAULT_LUA_SPEC);
			} catch {
				/* 兜底应用失败不阻塞编辑器 */
			}
		}
		return null;
	}
}
