/**
 * 云端草稿分支（write-drafts）：「暂存草稿」与「发布」分离的存储侧实现。
 *
 * - 暂存草稿：文章 md / 插图写到 write-drafts 分支同路径，commit message 带
 *   [CI Skip]（Cloudflare Pages 对含该标记的提交跳过构建，preview 同样跳过，
 *   官方：developers.cloudflare.com/pages/configuration/git-integration），
 *   master 不动 → 线上零影响、零构建。
 * - 发布（publishPostFile）：① 草稿分支插图目录整体搬回 master（先图后文，
 *   让构建拿到完整资源；顺带清掉历史孤本，自愈多设备场景）→ ② 提交文章 md →
 *   ③ 清理草稿 md。①③ 失败不阻塞发布本体，失败项进 warnings。
 * - 分支缺失时惰性自建（以 master HEAD 为起点）。GitHub「Create a reference」
 *   的 fine-grained token 权限 = Contents(write)（docs.github.com/en/rest/git/refs），
 *   与提交文章同权限，现有 token 天然够用。
 */
import {
	apiContentsPath,
	type ContentsEntry,
	decodeBase64,
	describeGitHubError,
	encodeBase64,
	GitHubError,
	ghFetch,
	IMAGES_DIR,
	putFile,
	WRITE_REPO,
} from "./github";

export const DRAFT_BRANCH = "write-drafts";

/** Cloudflare Pages 跳过构建的提交标记（preview 与 production 均跳过） */
const CI_SKIP = "[CI Skip]";

const repoRoot = `/repos/${WRITE_REPO.owner}/${WRITE_REPO.repo}`;

// 分支自建在页面生命周期内只需成功一次；分支被外部删除时刷新页面即可恢复
let branchReady = false;

/** 确保 write-drafts 分支存在（不存在则以 master HEAD 为起点创建） */
export async function ensureDraftsBranch(token: string): Promise<void> {
	if (branchReady) return;
	try {
		await ghFetch(token, `${repoRoot}/git/ref/heads/${DRAFT_BRANCH}`);
		branchReady = true;
		return;
	} catch (error) {
		if (!(error instanceof GitHubError && error.kind === "not-found")) {
			throw error;
		}
	}
	const master = await ghFetch(
		token,
		`${repoRoot}/git/ref/heads/${WRITE_REPO.branch}`,
	);
	const ref = (await master.json()) as { object: { sha: string } };
	try {
		await ghFetch(token, `${repoRoot}/git/refs`, {
			method: "POST",
			body: JSON.stringify({
				ref: `refs/heads/${DRAFT_BRANCH}`,
				sha: ref.object.sha,
			}),
		});
	} catch (error) {
		// 422 = Reference already exists（重复/并发创建），分支可用即视为成功
		if (!(error instanceof GitHubError && error.status === 422)) throw error;
	}
	branchReady = true;
}

/** 草稿分支文件：base64 原样返回（图片搬运需要原始字节），文本由调用方按需解码 */
export interface DraftFile {
	sha: string;
	base64: string;
}

/** 读草稿分支文件；不存在（分支或文件缺失，404）返回 null */
export async function fetchDraftFile(
	token: string,
	path: string,
): Promise<DraftFile | null> {
	try {
		const res = await ghFetch(
			token,
			`${repoRoot}/contents/${apiContentsPath(path)}?ref=${DRAFT_BRANCH}&t=${Date.now()}`,
		);
		const file = (await res.json()) as {
			sha: string;
			content: string;
			encoding: string;
		};
		if (file.encoding !== "base64" || typeof file.content !== "string") {
			throw new GitHubError("server", 0, "草稿文件不是 base64 编码，无法读取");
		}
		return { sha: file.sha, base64: file.content };
	} catch (error) {
		if (error instanceof GitHubError && error.kind === "not-found") return null;
		throw error;
	}
}

/** 草稿文件转文本（仅对文章 md 这类文本使用；图片是二进制，解码即损坏） */
export function draftFileText(file: DraftFile): string {
	return decodeBase64(file.base64);
}

/** 写草稿分支文件（先读现值 sha 再写，绕开并发暂存的 409；内容传 base64） */
async function writeDraftRaw(
	token: string,
	path: string,
	base64: string,
	message: string,
): Promise<{ sha: string }> {
	const existing = await fetchDraftFile(token, path);
	const res = await ghFetch(
		token,
		`${repoRoot}/contents/${apiContentsPath(path)}`,
		{
			method: "PUT",
			body: JSON.stringify({
				message: `${message} ${CI_SKIP}`,
				content: base64,
				branch: DRAFT_BRANCH,
				...(existing ? { sha: existing.sha } : {}),
			}),
		},
	);
	const data = (await res.json()) as { content?: { sha?: string } };
	if (!data.content?.sha) {
		throw new GitHubError(
			"server",
			0,
			"草稿已保存但未返回版本号，请刷新后再继续编辑",
		);
	}
	return { sha: data.content.sha };
}

/** 暂存文章 md 到草稿分支 */
export function saveDraftPost(
	token: string,
	path: string,
	text: string,
	title: string,
): Promise<{ sha: string }> {
	return writeDraftRaw(
		token,
		path,
		encodeBase64(text),
		`write(draft): 暂存 ${title}`,
	);
}

/** 插图上传到草稿分支（base64 原始字节，发布时统一搬回 master） */
export function saveDraftImage(
	token: string,
	fileName: string,
	base64: string,
): Promise<{ sha: string }> {
	return writeDraftRaw(
		token,
		`${IMAGES_DIR}/${fileName}`,
		base64,
		`write(draft): 上传插图 ${fileName}`,
	);
}

/** 删除草稿分支文件（不存在则视为已清理，直接返回） */
export async function deleteDraftFile(
	token: string,
	path: string,
): Promise<void> {
	const existing = await fetchDraftFile(token, path);
	if (!existing) return;
	await ghFetch(token, `${repoRoot}/contents/${apiContentsPath(path)}`, {
		method: "DELETE",
		body: JSON.stringify({
			message: `write(draft): 清理 ${path.split("/").pop()} ${CI_SKIP}`,
			sha: existing.sha,
			branch: DRAFT_BRANCH,
		}),
	});
}

/** 列草稿分支目录；分支/目录不存在都按空处理（浏览列表不得触发建分支） */
export async function listDraftDir(
	token: string,
	dir: string,
): Promise<ContentsEntry[]> {
	try {
		const res = await ghFetch(
			token,
			`${repoRoot}/contents/${apiContentsPath(dir)}?ref=${DRAFT_BRANCH}&t=${Date.now()}`,
		);
		const entries = (await res.json()) as ContentsEntry[];
		return Array.isArray(entries)
			? entries.filter((entry) => entry.type === "file")
			: [];
	} catch (error) {
		if (error instanceof GitHubError && error.kind === "not-found") return [];
		throw error;
	}
}

/** 某分支某路径最近一次提交时间（ISO8601）；查不到返回 null（时间仅用于新旧提示） */
export async function fetchBranchCommitDate(
	token: string,
	path: string,
	branch: string,
): Promise<string | null> {
	try {
		const res = await ghFetch(
			token,
			`${repoRoot}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&per_page=1`,
		);
		const commits = (await res.json()) as Array<{
			commit: { author: { date?: string } };
		}>;
		return commits[0]?.commit.author.date ?? null;
	} catch {
		return null;
	}
}

export interface DraftProbe {
	/** 草稿分支文件版本号（暂存/丢弃都要用） */
	sha: string;
	/** 非空 = 有与已发布版本不同的未发布草稿，值为保存时间文案；空串 = 草稿与已发布一致，静默 */
	banner: string;
}

/**
 * 打开文章时的草稿探测：草稿不存在 / 与 master 内容一致 / 比 master 旧（发布清理
 * 失败的残留）→ 不打扰；草稿更新且内容不同 → 返回横幅信息。任何失败静默降级。
 */
export async function probeDraftAgainstMaster(
	token: string,
	path: string,
	masterText: string | null,
): Promise<DraftProbe | null> {
	try {
		const file = await fetchDraftFile(token, path);
		if (!file) return null;
		if (masterText !== null && draftFileText(file) === masterText) {
			return { sha: file.sha, banner: "" };
		}
		const [draftDate, masterDate] = await Promise.all([
			fetchBranchCommitDate(token, path, DRAFT_BRANCH),
			fetchBranchCommitDate(token, path, WRITE_REPO.branch),
		]);
		// 草稿比 master 旧 = 已发布内容反而更新，属发布清理残留，不打扰
		if (draftDate && masterDate && draftDate <= masterDate) {
			return { sha: file.sha, banner: "" };
		}
		return {
			sha: file.sha,
			banner: draftDate ? formatCommitDate(draftDate) : "",
		};
	} catch {
		return null;
	}
}

/** ISO8601 → 本地 YYYY-MM-DD HH:mm */
export function formatCommitDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface PublishOutcome {
	sha: string;
	warnings: string[];
}

/**
 * master 上同名文件的 sha（不存在/查询失败都返回 undefined，按新建处理）。
 * Contents API 更新已有文件必须带 sha，否则 422 —— 发布搬运插图常覆盖历史孤本。
 */
async function fetchMasterFileSha(
	token: string,
	path: string,
): Promise<string | undefined> {
	try {
		const res = await ghFetch(
			token,
			`${repoRoot}/contents/${apiContentsPath(path)}?ref=${WRITE_REPO.branch}`,
		);
		const data = (await res.json()) as { sha?: string };
		return typeof data.sha === "string" ? data.sha : undefined;
	} catch {
		return undefined;
	}
}

/**
 * 发布 = 提交 master + 草稿收尾。顺序固定先图后文：插图先落 master，
 * 文章 md 最后提交，让构建拿到的最终状态图文齐全。
 */
export async function publishPostFile(
	token: string,
	path: string,
	text: string,
	title: string,
	masterSha?: string,
): Promise<PublishOutcome> {
	const warnings: string[] = [];
	try {
		const images = await listDraftDir(token, IMAGES_DIR);
		for (const img of images) {
			try {
				const file = await fetchDraftFile(token, img.path);
				if (!file) continue;
				// master 已有同名插图 → 必须带 sha 覆盖（缺 sha 的更新请求 422）
				const masterSha = await fetchMasterFileSha(token, img.path);
				await ghFetch(
					token,
					`${repoRoot}/contents/${apiContentsPath(img.path)}`,
					{
						method: "PUT",
						body: JSON.stringify({
							message: `write: 搬运插图 ${img.name}`,
							content: file.base64,
							branch: WRITE_REPO.branch,
							...(masterSha ? { sha: masterSha } : {}),
						}),
					},
				);
				await deleteDraftFile(token, img.path);
			} catch (error) {
				warnings.push(
					`插图 ${img.name} 搬运失败：${describeGitHubError(error)}`,
				);
			}
		}
	} catch {
		warnings.push("草稿插图目录读取失败（不影响正文发布）");
	}
	const { sha } = await putFile(
		token,
		path,
		text,
		`write: ${title}`,
		masterSha,
	);
	try {
		await deleteDraftFile(token, path);
	} catch {
		warnings.push("云端草稿清理失败，可稍后在草稿列表手动丢弃");
	}
	return { sha, warnings };
}
