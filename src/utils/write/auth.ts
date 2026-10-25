import { fetchCurrentUser } from "./github";
import { readStoredToken } from "./session";

/**
 * 编辑入口的认证门控（导航栏「写文章」图标 / 文章页「编辑」按钮共用）。
 *
 * token 两个来源：
 * ① /write 登录卡或文章页迷你登录卡写入的 write-editor-token；
 * ② /admin（Sveltia CMS）登录后留下的 sveltia-cms.auth —— Sveltia 的存储封装
 *    就是 localStorage + JSON（bundle 内 GE 类 set/get 全走 globalThis.localStorage），
 *    值为含 token 字段的对象，可直接读取复用。
 *
 * 「确定能用才显示」：GET /user 静默验证，结果按 token 指纹缓存（TTL 内不再打网络）。
 * 无 token 的访客零网络调用、零编辑入口。
 */

const SVELTIA_AUTH_KEY = "sveltia-cms.auth";
const VERIFIED_KEY = "write-editor-verified";
const VERIFIED_TTL_MS = 6 * 60 * 60 * 1000;

/** 读取 /admin（Sveltia CMS）登录态里的 token（结构变化时安全降级为空串） */
export function readSveltiaToken(): string {
	try {
		const raw = localStorage.getItem(SVELTIA_AUTH_KEY);
		if (!raw) return "";
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed === "string") return parsed;
		if (parsed && typeof parsed === "object") {
			const token = (parsed as { token?: unknown }).token;
			return typeof token === "string" ? token : "";
		}
		return "";
	} catch {
		return "";
	}
}

/** 编辑器统一取 token：自身 key 优先，其次复用 /admin 的登录态 */
export function resolveToken(): string {
	return readStoredToken() || readSveltiaToken();
}

/** 指纹只用于检测 token 变化，不落盘 token 本身（token 已在相邻 key 里，不额外扩大暴露面） */
function fingerprint(token: string): string {
	return `${token.length}:${token.slice(0, 8)}:${token.slice(-4)}`;
}

function hasFreshVerification(token: string): boolean {
	try {
		const raw = localStorage.getItem(VERIFIED_KEY);
		if (!raw) return false;
		const parsed = JSON.parse(raw) as { fp?: unknown; at?: unknown };
		return (
			parsed.fp === fingerprint(token) &&
			typeof parsed.at === "number" &&
			Date.now() - parsed.at < VERIFIED_TTL_MS
		);
	} catch {
		return false;
	}
}

/** 验证通过时调用（编辑器登录成功路径），TTL 内入口免验证直接显示 */
export function markVerified(token: string): void {
	try {
		localStorage.setItem(
			VERIFIED_KEY,
			JSON.stringify({ fp: fingerprint(token), at: Date.now() }),
		);
	} catch {
		// 隐私模式 localStorage 不可用：每次页面加载多一次 /user，功能不受影响
	}
}

/** 登出 / 401 被踢时调用，下次页面加载重新验证 */
export function clearVerified(): void {
	try {
		localStorage.removeItem(VERIFIED_KEY);
	} catch {
		// 忽略
	}
}

/** 静默验证：缓存新鲜直接通过；/user 成功则标记；失败（含 401/403/断网）一律不显示入口 */
export async function ensureVerified(token: string): Promise<boolean> {
	if (!token) return false;
	if (hasFreshVerification(token)) return true;
	try {
		await fetchCurrentUser(token);
		markVerified(token);
		return true;
	} catch {
		return false;
	}
}
