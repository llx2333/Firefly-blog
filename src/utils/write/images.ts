/**
 * 编辑器插图共享管线（纯逻辑，不触网络；上传/迁移/清理编排见 drafts.ts）。
 *
 * 目录约定（按文章子目录）：仓库 public/assets/images/posts/<文章名去扩展名>/，
 * URL /assets/images/posts/<文章名去扩展名>/；嵌套文章 nvim/1_start.md → nvim/1_start/。
 * md 引用一律写 UTF-8 原文路径（不 encodeURI），可读可手改；GitHub API 侧
 * apiContentsPath 已按段编码，无需在前端转义。
 *
 * 生命周期：插入/粘贴 → 图片存浏览器内存（pendingImages），正文只写最终 URL；
 * 「暂存草稿」把待上传图传 write-drafts，「发布」传 master（先图后文）。
 * 保存时的统一裁决（reconcileRefs）：
 * - 引用命中待上传键 → 按当前文章目录上传（目录不符 = 文章改名/旧引用，归一化）；
 * - 未命中引用 ↔ 未引用键数量恰好相等才两两配对 = 重命名（绝不猜测，宁缺勿错）；
 * - 没配上的待上传键 = 引用被删除（删引用行即删图，本地 blob 同步回收）；
 * - 没配上的引用 = 非待上传图（已上传过 / 手写路径），保存时按目标分支校验提示。
 * 已知取舍：删除一行引用的同时又手改另一处路径（数量不等）不配对——重命名会
 * 退化成「本地丢弃 + 未知引用」，预览立即裂图、发布时给出「不在线上」警告。
 */
import { IMAGE_PUBLIC_PREFIX, IMAGES_DIR } from "./github";

export interface PendingImage {
	/** 图片原始字节（base64，上传用） */
	base64: string;
	/** 本地预览 blob URL（插入时创建，随保存上传成功/删图回收） */
	objectUrl: string;
}

/** 文章文件名（可含路径与扩展名）→ 插图子目录名（去扩展名，保留嵌套层级） */
export function articleSlugDir(fileName: string): string {
	return fileName.replace(/\.(md|mdx)$/i, "");
}

/** 文章插图在仓库里的目录（repo path 前缀） */
export function imageRepoDirFor(fileName: string): string {
	return `${IMAGES_DIR}/${articleSlugDir(fileName)}`;
}

/** 文章插图的公开 URL 目录前缀 */
export function imagePublicDirFor(fileName: string): string {
	return `${IMAGE_PUBLIC_PREFIX}/${articleSlugDir(fileName)}`;
}

/** 站内插图 URL → 仓库路径；非 /assets/images/posts/ 前缀返回 null（外链图不动） */
export function imageUrlToRepoPath(url: string): string | null {
	const decoded = safeDecode(url);
	if (!decoded.startsWith(`${IMAGE_PUBLIC_PREFIX}/`)) return null;
	const rest = decoded.slice(IMAGE_PUBLIC_PREFIX.length + 1);
	if (!rest || rest.endsWith("/")) return null;
	return `${IMAGES_DIR}/${rest}`;
}

// ---------- 命名 ----------

/** 文件名禁用字符：路径分隔与 URL/Markdown 语法保留字符（中文原样保留） */
const IMAGE_NAME_BANNED = /[/\\()[\]{}<>#?%":'`*|]/g;

/**
 * 插图文件名清洗：空白转 -、去禁用字符与控制符、收敛连续 -；
 * 空名兜底「image」。后缀（扩展名）不在这里处理，由调用方固定携带。
 */
export function sanitizeImageName(raw: string): string {
	const cleaned = raw
		.replace(/[\t\n\r\f\v ]+/g, "-")
		// biome-ignore lint/suspicious/noControlCharactersInRegex: 就是要剥离用户文件名里的控制字符
		.replace(/[\x00-\x1f\x7f]/g, "")
		.replace(IMAGE_NAME_BANNED, "")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "");
	return cleaned || "image";
}

/** 命名卡建议名：原文件名去扩展名后清洗（回车直接用） */
export function defaultImageName(originalBaseName: string): string {
	return sanitizeImageName(originalBaseName.replace(/\.[a-z0-9]+$/i, ""));
}

/** 图片扩展名：优先原文件名后缀（保留原样），粘贴无名流再按 MIME 猜，兜底 .png */
export function imageExtFrom(file: { name: string; type?: string }): string {
	const match = /\.([a-z0-9]+)$/i.exec(file.name);
	if (match) return `.${match[1].toLowerCase()}`;
	const byType: Record<string, string> = {
		"image/png": ".png",
		"image/jpeg": ".jpg",
		"image/gif": ".gif",
		"image/webp": ".webp",
		"image/svg+xml": ".svg",
		"image/avif": ".avif",
	};
	return byType[file.type ?? ""] ?? ".png";
}

/**
 * 粘贴事件 → 图片文件列表。两条入口都要扫：
 * - items 里的 image/* 项：截图（Win+Shift+S）、网页「复制图像」；
 * - files：资源管理器里复制的图片文件——Chromium 给它的 item.type 是空串，
 *   只认 image/* 会漏掉，这是「Ctrl+V 粘不了图」的常见根因。
 * items 与 files 可能是同一张图的两个入口，按内容指纹去重防重复插入。
 */
export function imageFilesFromClipboard(dt: DataTransfer | null): File[] {
	if (!dt) return [];
	const seen = new Set<string>();
	const images: File[] = [];
	const accept = (file: File | null) => {
		if (!file) return;
		if (
			!file.type.startsWith("image/") &&
			!/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(file.name)
		) {
			return;
		}
		// 同名同字节数即同一张图：lastModified 对同一数据的两个包装可能差 1ms，不可入键
		const key = `${file.name}|${file.size}`;
		if (seen.has(key)) return;
		seen.add(key);
		images.push(file);
	};
	for (const item of dt.items) {
		if (item.kind === "file") accept(item.getAsFile());
	}
	for (const file of dt.files) accept(file);
	return images;
}

// ---------- 正文引用提取 / 改写 ----------

export interface ImageRef {
	alt: string;
	/** 引用 URL（markdown 原文，可能含百分号编码） */
	url: string;
	title: string | null;
	/** 整段原文（含 ![alt](url)），未命中改写时原样保留 */
	raw: string;
}

/** markdown 图片引用（含可选 title）；URL 不含空白与右括号是 GitHub 侧惯例 */
const IMAGE_REF_RE = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g;

export function extractImageRefs(body: string): ImageRef[] {
	const refs: ImageRef[] = [];
	for (const match of body.matchAll(IMAGE_REF_RE)) {
		refs.push({
			alt: match[1] ?? "",
			url: match[2] ?? "",
			title: match[3] ?? null,
			raw: match[0],
		});
	}
	return refs;
}

/** 正文里的站内插图引用（外链图过滤掉，不参与裁决） */
export function postImageRefs(body: string): ImageRef[] {
	return extractImageRefs(body).filter(
		(ref) => imageUrlToRepoPath(ref.url) !== null,
	);
}

export function renderImageRef(
	alt: string,
	url: string,
	title: string | null,
): string {
	return `![${alt}](${url}${title ? ` "${title}"` : ""})`;
}

/** 插入正文用的一行 markdown（alt 建议用最终文件名，与路径对得上） */
export function buildImageMarkdown(alt: string, url: string): string {
	return renderImageRef(alt, url, null);
}

/**
 * 按裁决结果改写正文里的站内插图引用（保留 alt 与 title）；mapFn 收到
 * decode 后的 URL，返回新 URL 或 null（原样保留）。代码块里的示例引用
 * 也会被改写——与提取口径一致，属于已知简化。
 */
export function rewriteImageRefs(
	body: string,
	mapFn: (decodedUrl: string) => string | null,
): string {
	return body.replace(IMAGE_REF_RE, (raw, alt, url, title) => {
		const next = mapFn(safeDecode(url ?? ""));
		return next ? renderImageRef(alt ?? "", next, title ?? null) : raw;
	});
}

// ---------- 保存时裁决 ----------

export interface ImageUpload {
	/** 正文当前引用（decoded） */
	refUrl: string;
	/** 目标 URL（上传成功后的公开地址；正文改写目标） */
	url: string;
	base64: string;
	/** 对应的待上传键（重命名时为旧键） */
	pendingKey: string;
	/**
	 * 旧键（≠ url 时存在）：可能以旧名存在于草稿分支，上传成功后顺手清理。
	 * master 侧从不自动删文件——旧名文件留在 master 成为孤本，属可接受冗余。
	 */
	renamedFromUrl?: string;
}

export interface ImagePlan {
	uploads: ImageUpload[];
	/** 非待上传的站内引用（已上传过 / 手写路径）；发布时据此校验在线状态 */
	unknownUrls: string[];
	/** 不再被正文引用的待上传键（删引用行 = 删图，blob 回收 + 移出待上传表） */
	droppedUrls: string[];
	/** 待上传表重键指令（手改路径后保持预览与上传目标一致） */
	renames: Array<{ fromUrl: string; toUrl: string }>;
}

/** 引用归一化：不在本文子目录 → 保留文件名、搬进本文目录（文章改名/旧引用统一） */
function normalizeImageUrl(url: string, articleDirUrl: string): string {
	const name = url.slice(url.lastIndexOf("/") + 1);
	const expected = `${articleDirUrl}/${name}`;
	return url === expected ? url : expected;
}

/**
 * 保存/预览共用的纯裁决函数。规则见文件头注释；重命名只在
 * 「未命中引用数 === 未引用待上传键数」时按出现顺序两两配对，绝不猜测。
 */
export function reconcileRefs(
	refs: ImageRef[],
	pending: ReadonlyMap<string, PendingImage>,
	articleDirUrl: string,
): ImagePlan {
	const uploads: ImageUpload[] = [];
	const renames: ImagePlan["renames"] = [];
	const rewrites = new Map<string, string>();
	const matchedKeys = new Set<string>();
	const pairedRefs = new Set<string>();

	// ① 精确命中：引用 URL 就是待上传键
	const unmatchedRefs: ImageRef[] = [];
	for (const ref of refs) {
		const decoded = safeDecode(ref.url);
		const entry = pending.get(decoded);
		if (!entry) {
			unmatchedRefs.push(ref);
			continue;
		}
		matchedKeys.add(decoded);
		const target = normalizeImageUrl(decoded, articleDirUrl);
		if (target !== decoded) {
			rewrites.set(decoded, target);
			pairedRefs.add(decoded);
			uploads.push({
				refUrl: decoded,
				url: target,
				base64: entry.base64,
				pendingKey: decoded,
				renamedFromUrl: decoded,
			});
			renames.push({ fromUrl: decoded, toUrl: target });
		} else {
			uploads.push({
				refUrl: decoded,
				url: target,
				base64: entry.base64,
				pendingKey: decoded,
			});
		}
	}

	// ② 未命中配对：数量恰好相等才两两配对（= 重命名）
	const unmatchedKeys = [...pending.keys()].filter((k) => !matchedKeys.has(k));
	if (
		unmatchedRefs.length > 0 &&
		unmatchedRefs.length === unmatchedKeys.length
	) {
		for (let i = 0; i < unmatchedRefs.length; i++) {
			const ref = unmatchedRefs[i];
			const fromKey = unmatchedKeys[i];
			const entry = pending.get(fromKey);
			if (!entry) continue;
			const decodedRef = safeDecode(ref.url);
			const target = normalizeImageUrl(decodedRef, articleDirUrl);
			if (target === fromKey) {
				// 待上传键已是该引用的最终地址（仅目录写法差异）：按命中处理，不重键。
				// 走重键会 delete+set 同一个键，SvelteMap 每次都发信号 → 派生 plan
				// 无限重算 → effect_update_depth_exceeded，整组件响应图冻死。
				pairedRefs.add(decodedRef);
				if (target !== decodedRef) rewrites.set(decodedRef, target);
				uploads.push({
					refUrl: decodedRef,
					url: target,
					base64: entry.base64,
					pendingKey: fromKey,
					renamedFromUrl: decodedRef, // 旧写法若曾在草稿分支，上传后顺手清理
				});
				continue;
			}
			if (target !== decodedRef) rewrites.set(decodedRef, target);
			pairedRefs.add(decodedRef);
			uploads.push({
				refUrl: decodedRef,
				url: target,
				base64: entry.base64,
				pendingKey: fromKey,
				renamedFromUrl: fromKey,
			});
			renames.push({ fromUrl: fromKey, toUrl: target });
		}
	}

	// ③ 没配上的待上传键 = 引用已被删除（删引用行即删图）
	const pairedKeys = new Set(uploads.map((u) => u.pendingKey));
	const droppedUrls = unmatchedKeys.filter((k) => !pairedKeys.has(k));

	// ④ 剩余未命中引用 = 非待上传图（已上传过 / 手写路径）
	const unknownUrls = unmatchedRefs
		.map((ref) => safeDecode(ref.url))
		.filter((decoded) => !pairedRefs.has(decoded));

	return { uploads, unknownUrls, droppedUrls, renames };
}

// ---------- 已上传图的改名配对 ----------

/**
 * 已上传图（不在待上传表）的手改路径配对：基准（上次保存的正文）引用 vs 当前
 * 引用，数量恰好相等才按出现顺序两两配对。同文章子目录 + 同扩展名才认——
 * 跨目录/换扩展多半是新图或外链，绝不猜测（宁缺勿错）。配不上的原样返回，
 * 由调用方按未知引用走校验提示。toUrl 重复或 fromUrl 重复的候选一律跳过：
 * 一份字节改名两次去向不明，宁可让用户手动处理。
 */
export function pairRenamedUploads(
	baselineUrls: readonly string[],
	currentUrls: readonly string[],
	articleDirUrl: string,
): Array<{ fromUrl: string; toUrl: string }> {
	const currentSet = new Set(currentUrls);
	const baselineSet = new Set(baselineUrls);
	const dropped = baselineUrls.filter((url) => !currentSet.has(url));
	const added = currentUrls.filter((url) => !baselineSet.has(url));
	if (dropped.length === 0 || dropped.length !== added.length) return [];

	const prefix = `${articleDirUrl}/`;
	const extOf = (url: string): string => {
		const name = url.slice(url.lastIndexOf("/") + 1);
		const dot = name.lastIndexOf(".");
		return dot === -1 ? "" : name.slice(dot).toLowerCase();
	};
	const pairs: Array<{ fromUrl: string; toUrl: string }> = [];
	const usedFrom = new Set<string>();
	const usedTo = new Set<string>();
	for (let i = 0; i < dropped.length; i++) {
		const fromUrl = dropped[i];
		const toUrl = added[i];
		if (usedFrom.has(fromUrl) || usedTo.has(toUrl)) continue;
		if (!fromUrl.startsWith(prefix) || !toUrl.startsWith(prefix)) continue;
		const ext = extOf(fromUrl);
		if (ext === "" || ext !== extOf(toUrl)) continue;
		usedFrom.add(fromUrl);
		usedTo.add(toUrl);
		pairs.push({ fromUrl, toUrl });
	}
	return pairs;
}

// ---------- 预览工具 ----------

/** decodeURIComponent 的安全版：畸形编码原样返回 */
export function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/**
 * 预览 HTML 的 img src 本地化：命中 resolver（待上传 blob / 草稿分支 blob）
 * 就替换，否则保留原 URL。必须在 sanitizeHtml 之前调用，且 sanitizeConfig
 * 的 allowedSchemes 要放行 blob:。
 */
export function localizePreviewImages(
	html: string,
	resolve: (decodedUrl: string) => string | null,
): string {
	return html.replace(
		/(<img\b[^>]*?\bsrc=)(["'])([^"']*)\2/gi,
		(raw, head: string, quote: string, src: string) => {
			const next = resolve(safeDecode(src));
			return next ? `${head}${quote}${next}${quote}` : raw;
		},
	);
}

export function mimeFromName(name: string): string {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	const map: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		webp: "image/webp",
		svg: "image/svg+xml",
		avif: "image/avif",
		bmp: "image/bmp",
	};
	return map[ext] ?? "image/png";
}

/** base64 原始字节 → blob URL（草稿分支图预览用） */
export function base64ToObjectUrl(base64: string, mime: string): string {
	const binary = atob(base64.replace(/\s+/g, ""));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return URL.createObjectURL(new Blob([bytes], { type: mime }));
}
