import { TOKEN_STORAGE_KEY } from "./github";

/** 读取持久化的 GitHub token（localStorage 不可用时返回空串） */
export function readStoredToken(): string {
	try {
		return localStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
	} catch {
		return "";
	}
}

/** 持久化 token；传空串即清除 */
export function persistToken(value: string): void {
	try {
		if (value) localStorage.setItem(TOKEN_STORAGE_KEY, value);
		else localStorage.removeItem(TOKEN_STORAGE_KEY);
	} catch {
		// 隐私模式下 localStorage 不可用：仅本次会话内保持登录
	}
}
