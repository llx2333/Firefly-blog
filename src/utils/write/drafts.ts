/**
 * 云端草稿分支（write-drafts）：「暂存草稿」与「发布」分离的存储侧实现。
 *
 * - 暂存草稿：文章 md 写到 write-drafts 分支同路径，commit message 带
 *   [CI Skip]（Cloudflare Pages 对含该标记的提交跳过构建，preview 同样跳过，
 *   官方：developers.cloudflare.com/pages/configuration/git-integration），
 *   master 不动 → 线上零影响、零构建。
 * - 插图随文保存：插入/粘贴只存浏览器内存（见 images.ts），暂存时把待上传图
 *   传到草稿分支本文子目录、发布时传到 master（先图后文）。旧平铺路径在保存时
 *   自动迁入文章子目录；发布收尾只清本文子目录（被引用搬 master、未引用删除）。
 * - 分支缺失时惰性自建（以 master HEAD 为起点）。GitHub「Create a reference」
 *   的 fine-grained token 权限 = Contents(write)（docs.github.com/en/rest/git/refs），
 *   与提交文章同权限，现有 token 天然够用。
 */

import { parsePostFile } from "./frontmatter";
import {
	apiContentsPath,
	type ContentsEntry,
	decodeBase64,
	describeGitHubError,
	encodeBase64,
	GitHubError,
	ghFetch,
	IMAGE_PUBLIC_PREFIX,
	IMAGES_DIR,
	listPostFiles,
	POSTS_DIR,
	putFile,
	putRawFile,
	WRITE_REPO,
} from "./github";
import {
	articleSlugDir,
	type ImagePlan,
	type ImageUpload,
	imagePublicDirFor,
	imageUrlToRepoPath,
	type PendingImage,
	pairRenamedUploads,
	postImageRefs,
	reconcileRefs,
	rewriteImageRefs,
	safeDecode,
} from "./images";

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
	return putRawFile(token, path, base64, `${message} ${CI_SKIP}`, {
		branch: DRAFT_BRANCH,
		...(existing ? { sha: existing.sha } : {}),
	});
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

// ---------- 插图随文保存（裁决纯逻辑见 images.ts） ----------

export interface PreparedImages {
	/** 迁移/归一化改写后的正文（上传目标 URL 已写进引用） */
	body: string;
	plan: ImagePlan;
	/** 非阻塞提示（迁移失败 / 发布校验图片不在线上），由调用方并进 toast */
	warnings: string[];
	/**
	 * 改名搬运失败时须保全的草稿分支文件（repo path）：旧名可能是唯一副本，
	 * 后续清扫（暂存收尾/发布收尾）绝不碰它们。
	 */
	protectedDraftPaths: string[];
}

/** 基线快照（上次保存的完整文件文本）→ 正文部分；解析失败按无基线处理 */
function baselineBodyOf(snapshot: string): string {
	if (!snapshot) return "";
	try {
		return parsePostFile(snapshot).body;
	} catch {
		return "";
	}
}

/**
 * 保存前的插图裁决与编排（暂存/发布共用）：
 * ① 旧平铺路径迁移：正文里的 /assets/images/posts/名字.png（无子目录）若在
 *    草稿分支旧路径找得到 → 搬进本文子目录并改写引用；找不到则原样保留
 *    （Sveltia 传到 master 的图原生可见，不动）；
 * ② reconcile 裁决（重命名 / 目录归一化 / 删图）并改写正文；
 * ②-b 已上传图的手改路径 = 改名搬运：baselineText（上次保存正文）里消失的
 *    引用 ↔ 当前新增的未知引用，数量相等且同目录同扩展名才两两配对；旧名字节
 *    从草稿分支（优先）或 master 取，新名 PUT 到目标分支，旧名删除（master 只
 *    在发布目标删，暂存绝不碰 master）。新路径已在线上则不配对（那是有效引用，
 *    不是改名）。失败不阻塞 md 提交，旧名进 protectedDraftPaths；
 * ③ 发布目标额外校验未知引用：master 与草稿分支都没有 → 警告「路径可能有误」；
 *    草稿分支有的由发布收尾搬运，不算缺失。任何失败都不阻塞 md 提交。
 *
 * 已知取舍：改名搬运先于 md 提交执行；md 提交失败时文件已搬走，下次保存会
 * 重新校验并把提示给出来（预览侧旧引用裂图属可恢复状态，git 历史可回溯）。
 */
export async function prepareImageSaves(
	token: string,
	fileName: string,
	body: string,
	pending: ReadonlyMap<string, PendingImage>,
	target: "draft" | "master",
	baselineText?: string,
): Promise<PreparedImages> {
	const warnings: string[] = [];
	const protectedDraftPaths: string[] = [];
	const articleDirUrl = imagePublicDirFor(fileName);
	const rewrites = new Map<string, string>();

	// ① 旧平铺路径迁移（只动草稿分支，master 从不自动删）
	for (const ref of postImageRefs(body)) {
		const decoded = safeDecode(ref.url);
		const repoPath = imageUrlToRepoPath(decoded);
		if (!repoPath) continue;
		const rest = decoded.slice(IMAGE_PUBLIC_PREFIX.length + 1);
		if (rest.includes("/") || pending.has(decoded)) continue;
		const name = repoPath.split("/").pop() ?? repoPath;
		try {
			const file = await fetchDraftFile(token, repoPath);
			if (!file) continue;
			const newPath = `${IMAGES_DIR}/${articleSlugDir(fileName)}/${name}`;
			await putRawFile(
				token,
				newPath,
				file.base64,
				`write(draft): 迁移插图 ${name}`,
				{ branch: DRAFT_BRANCH },
			);
			await deleteDraftFile(token, repoPath);
			rewrites.set(decoded, `${articleDirUrl}/${name}`);
		} catch (error) {
			warnings.push(`旧插图 ${name} 迁移失败：${describeGitHubError(error)}`);
		}
	}

	// ② reconcile 裁决 + 正文改写（重命名/目录归一化落进正文，预览即时跟随）
	const plan = reconcileRefs(postImageRefs(body), pending, articleDirUrl);
	for (const upload of plan.uploads) {
		if (upload.refUrl !== upload.url) rewrites.set(upload.refUrl, upload.url);
	}
	for (const rename of plan.renames) {
		rewrites.set(rename.fromUrl, rename.toUrl);
	}
	const nextBody =
		rewrites.size > 0
			? rewriteImageRefs(body, (decoded) => rewrites.get(decoded) ?? null)
			: body;

	// ②-b 已上传图的手改路径 = 改名搬运（真实字节跟着引用走，仓库文件同步改名）
	const baselineUrls = postImageRefs(baselineBodyOf(baselineText ?? "")).map(
		(ref) => safeDecode(ref.url),
	);
	const currentUrls = postImageRefs(body).map((ref) => safeDecode(ref.url));
	const uploadTargets = new Set(plan.uploads.map((u) => u.url));
	for (const { fromUrl, toUrl } of pairRenamedUploads(
		baselineUrls,
		currentUrls,
		articleDirUrl,
	)) {
		// 新路径正是某张待上传图的目标 → 是新图不是改名，交还给上传流程
		if (uploadTargets.has(toUrl)) continue;
		const fromRepo = imageUrlToRepoPath(fromUrl);
		const toRepo = imageUrlToRepoPath(toUrl);
		if (!fromRepo || !toRepo) continue;
		const fromName = fromUrl.split("/").pop() ?? fromUrl;
		const toName = toUrl.split("/").pop() ?? toUrl;
		try {
			// 新路径已在线上（master 或草稿分支）→ 有效引用，不是改名，按原样校验
			const toOnline =
				(await fetchMasterFileSha(token, toRepo)) !== undefined ||
				(await fetchDraftFile(token, toRepo)) !== null;
			if (toOnline) continue;
			// 旧名字节：草稿分支优先（最新的工作态），master 兜底
			const source =
				(await fetchDraftFile(token, fromRepo)) ??
				(await fetchMasterFile(token, fromRepo));
			if (!source) {
				warnings.push(
					`图片改名 ${fromName} → ${toName} 失败：找不到原文件 ${fromName}`,
				);
				protectedDraftPaths.push(fromRepo);
				continue;
			}
			if (target === "draft") {
				await putRawFile(
					token,
					toRepo,
					source.base64,
					`write(draft): 插图改名 ${fromName} → ${toName}`,
					{ branch: DRAFT_BRANCH },
				);
			} else {
				const toSha = await fetchMasterFileSha(token, toRepo);
				await putRawFile(
					token,
					toRepo,
					source.base64,
					`write: 插图改名 ${fromName} → ${toName}`,
					{ ...(toSha ? { sha: toSha } : {}) },
				);
			}
			// 旧名清理：草稿分支一定删；master 只在发布目标删（暂存绝不碰 master）
			const masterOldSha = await fetchMasterFileSha(token, fromRepo);
			await deleteDraftFile(token, fromRepo);
			if (target === "master" && masterOldSha !== undefined) {
				await ghFetch(
					token,
					`${repoRoot}/contents/${apiContentsPath(fromRepo)}`,
					{
						method: "DELETE",
						body: JSON.stringify({
							message: `write: 插图改名清理 ${fromName}`,
							sha: masterOldSha,
							branch: WRITE_REPO.branch,
						}),
					},
				);
			}
			// 编辑器据此重映射已上传 URL 集与草稿预览缓存（旧键 → 新键）
			plan.renames.push({ fromUrl, toUrl });
		} catch (error) {
			warnings.push(
				`图片改名 ${fromName} → ${toName} 失败：${describeGitHubError(error)}`,
			);
			protectedDraftPaths.push(fromRepo);
		}
	}

	// ③ 发布目标：未知引用在线校验（非阻塞，失败项进 warnings）
	if (target === "master") {
		for (const url of plan.unknownUrls) {
			const repoPath = imageUrlToRepoPath(url);
			if (!repoPath) continue;
			const name = repoPath.split("/").pop() ?? repoPath;
			try {
				if ((await fetchMasterFileSha(token, repoPath)) !== undefined) continue;
				if ((await fetchDraftFile(token, repoPath)) !== null) continue;
				warnings.push(
					`图片 ${name} 不在线上（路径可能有误），发布后该图会无法显示`,
				);
			} catch {
				/* 校验失败不阻塞发布 */
			}
		}
	}

	return { body: nextBody, plan, warnings, protectedDraftPaths };
}

export interface UploadOutcome {
	/** 上传成功的公开 URL（正文引用即此地址） */
	uploadedUrls: string[];
	/** 失败项（不阻塞 md 提交；待上传表保留，下次保存自动重试） */
	failed: Array<{ url: string; reason: string }>;
}

/**
 * 待上传图逐张上传：draft → write-drafts 本文子目录（[CI Skip]）；
 * master → 先取现值 sha 再覆盖写。重命名项成功后顺手清理草稿分支旧名文件
 * （master 侧从不自动删）。alreadyUploaded 里的 URL 跳过（暂存后重复保存免重传）。
 */
export async function uploadPendingImages(
	token: string,
	uploads: ImageUpload[],
	target: "draft" | "master",
	alreadyUploaded?: ReadonlySet<string>,
	onProgress?: (done: number, total: number) => void,
): Promise<UploadOutcome> {
	const todo = uploads.filter((u) => !alreadyUploaded?.has(u.url));
	const uploadedUrls: string[] = [];
	const failed: Array<{ url: string; reason: string }> = [];
	if (todo.length > 0 && target === "draft") {
		await ensureDraftsBranch(token);
	}
	let done = 0;
	for (const upload of todo) {
		const repoPath = imageUrlToRepoPath(upload.url);
		const name = upload.url.split("/").pop() ?? upload.url;
		if (!repoPath) {
			failed.push({ url: upload.url, reason: "URL 不属于本站插图目录" });
			done++;
			onProgress?.(done, todo.length);
			continue;
		}
		try {
			if (target === "draft") {
				await putRawFile(
					token,
					repoPath,
					upload.base64,
					`write(draft): 上传插图 ${name}`,
					{ branch: DRAFT_BRANCH },
				);
			} else {
				const sha = await fetchMasterFileSha(token, repoPath);
				await putRawFile(
					token,
					repoPath,
					upload.base64,
					`write: 上传插图 ${name}`,
					{
						...(sha ? { sha } : {}),
					},
				);
			}
			// 重命名成功 → 草稿分支旧名文件清理（不存在则 no-op）
			if (upload.renamedFromUrl) {
				const oldPath = imageUrlToRepoPath(upload.renamedFromUrl);
				if (oldPath && oldPath !== repoPath) {
					await deleteDraftFile(token, oldPath).catch(() => {
						/* 尽力清理 */
					});
				}
			}
			uploadedUrls.push(upload.url);
		} catch (error) {
			failed.push({ url: upload.url, reason: describeGitHubError(error) });
		}
		done++;
		onProgress?.(done, todo.length);
	}
	return { uploadedUrls, failed };
}

/** 删文时清理草稿分支本文插图子目录（尽力而为，失败静默） */
export async function removeArticleDraftImages(
	token: string,
	fileName: string,
): Promise<void> {
	const dir = `${IMAGES_DIR}/${articleSlugDir(fileName)}`;
	const entries = await listDraftDir(token, dir);
	for (const entry of entries) {
		try {
			await deleteDraftFile(token, entry.path);
		} catch {
			/* 尽力清理 */
		}
	}
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

export interface SweepOutcome {
	/** 清掉的未引用插图数 */
	deleted: number;
	/** 清理失败的文件名（不阻塞保存，留给下次保存或手动处理） */
	failed: string[];
}

/**
 * 暂存收尾：清掉草稿分支本文子目录里不再被正文引用的插图（删引用行 = 删图，
 * 暂存即生效；发布收尾 publishPostFile 内含同类清扫）。
 * keepPaths：改名搬运失败等场景要保全的 repo path——旧名可能是唯一副本，绝不扫掉。
 * 只动本文子目录；目录读取失败抛给调用方（不得阻塞暂存结果）。
 */
export async function sweepDraftImages(
	token: string,
	fileName: string,
	body: string,
	keepPaths: ReadonlySet<string> = new Set(),
): Promise<SweepOutcome> {
	const articleDir = articleSlugDir(fileName);
	const images = await listDraftDir(token, `${IMAGES_DIR}/${articleDir}`);
	const referenced = new Set(
		postImageRefs(body).map((ref) => safeDecode(ref.url)),
	);
	let deleted = 0;
	const failed: string[] = [];
	for (const img of images) {
		if (keepPaths.has(img.path)) continue;
		const publicUrl = `${IMAGE_PUBLIC_PREFIX}/${articleDir}/${img.name}`;
		if (referenced.has(publicUrl)) continue;
		try {
			await deleteDraftFile(token, img.path);
			deleted++;
		} catch {
			failed.push(img.name);
		}
	}
	return { deleted, failed };
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

/** 读 master 分支文件（插图改名搬运时取旧名字节的兜底源）；不存在返回 null */
async function fetchMasterFile(
	token: string,
	path: string,
): Promise<DraftFile | null> {
	try {
		const res = await ghFetch(
			token,
			`${repoRoot}/contents/${apiContentsPath(path)}?ref=${WRITE_REPO.branch}&t=${Date.now()}`,
		);
		const file = (await res.json()) as {
			sha: string;
			content: string;
			encoding: string;
		};
		if (file.encoding !== "base64" || typeof file.content !== "string") {
			throw new GitHubError("server", 0, "文件不是 base64 编码，无法读取");
		}
		return { sha: file.sha, base64: file.content };
	} catch (error) {
		if (error instanceof GitHubError && error.kind === "not-found") return null;
		throw error;
	}
}

/**
 * 发布 = ① 收尾草稿插图（先图后文）→ ② 提交 master 正文 → ③ 清理草稿 md。
 * ① 只处理本文插图子目录：被最终正文引用的搬 master（先取现值 sha 覆盖写），
 * 未被引用的从草稿删除（= 用户删掉的图随发布自动清理）；其他文章的子目录与
 * 旧平铺文件一律不动，master 上的文件从不自动删。
 * keepDraftPaths：改名搬运失败时须保全的 repo path（旧名可能是唯一副本），
 * 收尾清扫跳过它们。
 */
export async function publishPostFile(
	token: string,
	path: string,
	text: string,
	title: string,
	masterSha?: string,
	keepDraftPaths: ReadonlySet<string> = new Set(),
): Promise<PublishOutcome> {
	const warnings: string[] = [];
	const articleDir = articleSlugDir(path.slice(POSTS_DIR.length + 1));
	const draftImageDir = `${IMAGES_DIR}/${articleDir}`;
	try {
		const images = await listDraftDir(token, draftImageDir);
		const referenced = new Set(
			postImageRefs(text).map((ref) => safeDecode(ref.url)),
		);
		for (const img of images) {
			if (keepDraftPaths.has(img.path)) continue;
			const publicUrl = `${IMAGE_PUBLIC_PREFIX}/${articleDir}/${img.name}`;
			try {
				if (referenced.has(publicUrl)) {
					const file = await fetchDraftFile(token, img.path);
					if (!file) continue;
					// master 已有同名插图 → 必须带 sha 覆盖（缺 sha 的更新请求 422）
					const masterFileSha = await fetchMasterFileSha(token, img.path);
					await putRawFile(
						token,
						img.path,
						file.base64,
						`write: 发布插图 ${img.name}`,
						{ ...(masterFileSha ? { sha: masterFileSha } : {}) },
					);
					await deleteDraftFile(token, img.path);
				} else {
					await deleteDraftFile(token, img.path);
				}
			} catch (error) {
				warnings.push(
					`插图 ${img.name} 收尾失败：${describeGitHubError(error)}`,
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

// ---------- 分类条「未发布」入口（登录态伪分类） ----------

/**
 * 「未发布」计数缓存（sessionStorage）：分类条出现在首页/归档/文章页等所有
 * 主网格页面，TTL 内跨页面导航零请求。暂存/丢弃/发布成功后由编辑器失效，
 * 下次导航重算。
 */
const DRAFT_COUNT_CACHE_KEY = "write-editor-draft-count";
const DRAFT_COUNT_TTL_MS = 5 * 60 * 1000;

export interface DraftCountCache {
	at: number;
	count: number;
}

export function readDraftCountCache(): DraftCountCache | null {
	try {
		const raw = sessionStorage.getItem(DRAFT_COUNT_CACHE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<DraftCountCache>;
		if (
			typeof parsed.at !== "number" ||
			typeof parsed.count !== "number" ||
			Date.now() - parsed.at >= DRAFT_COUNT_TTL_MS
		) {
			return null;
		}
		return { at: parsed.at, count: parsed.count };
	} catch {
		return null;
	}
}

export function writeDraftCountCache(count: number): void {
	try {
		sessionStorage.setItem(
			DRAFT_COUNT_CACHE_KEY,
			JSON.stringify({ at: Date.now(), count }),
		);
	} catch {
		/* 隐私模式等：缓存不可用只是每次导航多两次请求 */
	}
}

/** 草稿增删后调用（暂存/丢弃/发布/删文成功）：分类条计数立即失效 */
export function invalidateDraftCountCache(): void {
	try {
		sessionStorage.removeItem(DRAFT_COUNT_CACHE_KEY);
	} catch {
		/* 忽略 */
	}
}

/**
 * 仅存于草稿分支的文章数（分类条「未发布」计数）＝ 草稿分支顶层目录 − master
 * 顶层目录。两边都取顶层即可：草稿只能由编辑器创建且文件名禁 `/`（子目录文章
 * 的暂存 master 上必有同路径，属「发布过的暂存」，不算「仅存」）。
 */
export async function countDraftOnlyPosts(token: string): Promise<number> {
	const [master, drafts] = await Promise.all([
		listPostFiles(token),
		listDraftDir(token, POSTS_DIR),
	]);
	const masterPaths = new Set(master.map((entry) => entry.path));
	return drafts.filter(
		(entry) => /\.(md|mdx)$/i.test(entry.name) && !masterPaths.has(entry.path),
	).length;
}
