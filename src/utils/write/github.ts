/**
 * GitHub Contents API 客户端（纯浏览器端，无后端，CORS 由 GitHub API 官方支持，
 * 与 Sveltia CMS 同款直连模式）。契约与 public/admin/config.yml 对齐。
 */

export const WRITE_REPO = {
	owner: "llx2333",
	repo: "Firefly-blog",
	branch: "master",
} as const;

export const POSTS_DIR = "src/content/posts";
export const IMAGES_DIR = "public/assets/images/posts";
export const IMAGE_PUBLIC_PREFIX = "/assets/images/posts";

export const TOKEN_STORAGE_KEY = "write-editor-token";

const API_ROOT = "https://api.github.com";

export type GitHubErrorKind =
	| "unauthorized" // 401：token 失效
	| "forbidden" // 403：权限不足（PAT 需要 Contents 读写）
	| "rate-limit" // 403 且 X-RateLimit-Remaining=0
	| "not-found" // 404
	| "conflict" // 409：远端已变
	| "network" // fetch 抛错（断网 / DNS）
	| "server"; // 其余非 2xx

export class GitHubError extends Error {
	kind: GitHubErrorKind;
	status: number; // 网络错误为 0

	constructor(kind: GitHubErrorKind, status: number, message: string) {
		super(message);
		this.name = "GitHubError";
		this.kind = kind;
		this.status = status;
	}
}

/** 错误 → 用户可读文案（不含 token / 请求头等敏感信息） */
export function describeGitHubError(error: unknown): string {
	if (error instanceof GitHubError) {
		switch (error.kind) {
			case "unauthorized":
				return "登录已失效（401），请重新输入 token";
			case "forbidden":
				return "权限不足（403）：token 需要 Contents 读写权限（repo 范围）";
			case "rate-limit":
				return "GitHub API 限流（403，配额耗尽），请稍后重试";
			case "not-found":
				return "文件或接口不存在（404）";
			case "conflict":
				return "远端文件已被修改（409），请「重载远端」后再保存";
			case "network":
				return "网络错误：无法连接 GitHub API，请检查网络后重试";
			case "server":
				return `GitHub API 错误（HTTP ${error.status}）：${error.message}`;
		}
	}
	return error instanceof Error ? error.message : String(error);
}

function classify(
	status: number,
	message: string,
	rateLimitRemaining: string | null,
): GitHubError {
	if (status === 401) return new GitHubError("unauthorized", status, message);
	if (status === 403) {
		if (rateLimitRemaining === "0") {
			return new GitHubError("rate-limit", status, message);
		}
		return new GitHubError("forbidden", status, message);
	}
	if (status === 404) return new GitHubError("not-found", status, message);
	if (status === 409) return new GitHubError("conflict", status, message);
	return new GitHubError("server", status, message);
}

async function ghFetch(
	token: string,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		...(init.headers as Record<string, string> | undefined),
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	if (init.body != null && !headers["Content-Type"]) {
		headers["Content-Type"] = "application/json";
	}

	let response: Response;
	try {
		response = await fetch(`${API_ROOT}${path}`, { ...init, headers });
	} catch {
		// fetch 网络层失败（断网 / DNS / 中断）；不携带任何请求细节，避免泄露 token
		throw new GitHubError("network", 0, "网络请求失败");
	}

	if (!response.ok) {
		let message = `HTTP ${response.status}`;
		try {
			const data = (await response.json()) as { message?: string };
			if (data?.message) message = data.message;
		} catch {
			// 非 JSON 错误体，保留 HTTP 状态码文案
		}
		throw classify(
			response.status,
			message,
			response.headers.get("X-RateLimit-Remaining"),
		);
	}
	return response;
}

// ---------- base64（UTF-8 安全） ----------

export function encodeBase64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

export function decodeBase64(base64: string): string {
	const binary = atob(base64.replace(/\s+/g, ""));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return new TextDecoder().decode(bytes);
}

// ---------- API 类型 ----------

export interface ContentsEntry {
	name: string;
	path: string;
	sha: string;
	type: string;
	size: number;
}

export interface ContentsFile extends ContentsEntry {
	content: string; // base64
	encoding: "base64";
}

// ---------- API 封装 ----------

/** 验证 token：GET /user */
export async function fetchCurrentUser(
	token: string,
): Promise<{ login: string }> {
	const res = await ghFetch(token, "/user");
	return (await res.json()) as { login: string };
}

/** 文章目录列表（公开仓库匿名可读） */
export async function listPostFiles(token: string): Promise<ContentsEntry[]> {
	// GitHub 对「目录不存在」与「目录为空」都返回 404（git 树里没有空目录），
	// 仓库 0 篇时的真实形态就是 404，按空列表处理（2026-10-25 实测）。
	try {
		const res = await ghFetch(
			token,
			`/repos/${WRITE_REPO.owner}/${WRITE_REPO.repo}/contents/${POSTS_DIR}?ref=${WRITE_REPO.branch}&t=${Date.now()}`,
		);
		const entries = (await res.json()) as ContentsEntry[];
		if (!Array.isArray(entries)) return [];
		return entries.filter(
			(entry) => entry.type === "file" && /\.(md|mdx)$/i.test(entry.name),
		);
	} catch (error) {
		if (error instanceof GitHubError && error.kind === "not-found") {
			return [];
		}
		throw error;
	}
}

/** 拉取单个文件内容（文本） */
export async function fetchFile(
	token: string,
	path: string,
): Promise<{ text: string; sha: string }> {
	const res = await ghFetch(
		token,
		`/repos/${WRITE_REPO.owner}/${WRITE_REPO.repo}/contents/${encodeURI(path)}?ref=${WRITE_REPO.branch}`,
	);
	const file = (await res.json()) as ContentsFile;
	if (file.encoding !== "base64" || typeof file.content !== "string") {
		throw new GitHubError("server", 0, "文件内容不是 base64 编码，无法读取");
	}
	return { text: decodeBase64(file.content), sha: file.sha };
}

/** 创建 / 更新文件；新建不带 sha，更新必须带 sha */
export async function putFile(
	token: string,
	path: string,
	text: string,
	message: string,
	sha?: string,
): Promise<{ sha: string }> {
	const res = await ghFetch(
		token,
		`/repos/${WRITE_REPO.owner}/${WRITE_REPO.repo}/contents/${encodeURI(path)}`,
		{
			method: "PUT",
			body: JSON.stringify({
				message,
				content: encodeBase64(text),
				branch: WRITE_REPO.branch,
				...(sha ? { sha } : {}),
			}),
		},
	);
	const data = (await res.json()) as { content?: { sha?: string } };
	if (!data.content?.sha) {
		throw new GitHubError(
			"server",
			0,
			"保存成功但未返回新版本号，请刷新后再编辑",
		);
	}
	return { sha: data.content.sha };
}

/** 删除文件（必须带 sha） */
export async function deleteFile(
	token: string,
	path: string,
	message: string,
	sha: string,
): Promise<void> {
	await ghFetch(
		token,
		`/repos/${WRITE_REPO.owner}/${WRITE_REPO.repo}/contents/${encodeURI(path)}`,
		{
			method: "DELETE",
			body: JSON.stringify({
				message,
				sha,
				branch: WRITE_REPO.branch,
			}),
		},
	);
}

/** 上传图片（base64 原始字节，浏览器 FileReader 提供） */
export async function putImageBase64(
	token: string,
	fileName: string,
	base64: string,
	message: string,
): Promise<{ sha: string }> {
	const res = await ghFetch(
		token,
		`/repos/${WRITE_REPO.owner}/${WRITE_REPO.repo}/contents/${encodeURI(`${IMAGES_DIR}/${fileName}`)}`,
		{
			method: "PUT",
			body: JSON.stringify({
				message,
				content: base64,
				branch: WRITE_REPO.branch,
			}),
		},
	);
	const data = (await res.json()) as { content?: { sha?: string } };
	if (!data.content?.sha) {
		throw new GitHubError("server", 0, "上传成功但未返回版本号");
	}
	return { sha: data.content.sha };
}
