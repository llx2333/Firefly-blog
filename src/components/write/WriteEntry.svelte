<script lang="ts">
/**
 * 导航栏「写文章」图标入口：token 验证通过后才渲染（访客看不到任何编辑入口）。
 * 点击弹出新建文章悬浮窗：frontmatter 常用字段先行填写——发布日期智能预填今天，
 * 「更多设置」折叠区提醒 slug / 封面图 / 作者 / 系列 / 置顶 / 草稿等可选字段；
 * 确认后经 sessionStorage 种子交给 /write/?new=1，编辑器内 frontmatter 自动预填，
 * 与本地直接编辑一样所有字段进编辑器后仍可手动修改。
 */
import { tick } from "svelte";
import { ensureVerified, resolveToken } from "@/utils/write/auth";
import { todayDateString } from "@/utils/write/slug";

let authed = $state(false);
let open = $state(false);
let title = $state("");
let published = $state(todayDateString());
let category = $state("");
let tags = $state("");
let description = $state("");
let slug = $state("");
let image = $state("");
let author = $state("");
let series = $state("");
let seriesOrder = $state("");
let pinned = $state(false);
let draft = $state(false);
let showMore = $state(false);
let error = $state("");
let titleInput = $state<HTMLInputElement | null>(null);

const inputClass =
	"w-full px-3 py-2 text-sm bg-transparent border border-black/10 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-(--primary) focus:border-(--primary) hover:border-black/20 dark:hover:border-white/20 text-75 placeholder:opacity-50 transition-colors outline-hidden";

const labelClass = "block text-xs font-medium text-50 mb-1";

$effect(() => {
	void ensureVerified(resolveToken()).then((ok) => {
		authed = ok;
	});
});

$effect(() => {
	if (!open) return;
	void tick().then(() => titleInput?.focus());
	const onKey = (event: KeyboardEvent) => {
		if (event.key === "Escape") close();
	};
	window.addEventListener("keydown", onKey);
	return () => window.removeEventListener("keydown", onKey);
});

function close() {
	open = false;
	error = "";
}

function confirmNew() {
	const trimmed = title.trim();
	if (!trimmed) {
		error = "标题不能为空";
		return;
	}
	const order = Number(seriesOrder);
	const seed = {
		title: trimmed,
		// 非法/留空日期交给编辑器兜底（同样是今天），这里原样传字符串
		published,
		category: category.trim(),
		tags: tags
			.split(/[,，]/)
			.map((tag) => tag.trim())
			.filter(Boolean),
		description: description.trim(),
		slug: slug.trim(),
		image: image.trim(),
		author: author.trim(),
		series: series.trim(),
		seriesOrder:
			seriesOrder.trim() !== "" && Number.isFinite(order) ? order : null,
		pinned,
		draft,
	};
	try {
		sessionStorage.setItem("write-editor-new-seed", JSON.stringify(seed));
	} catch {
		// 隐私模式 sessionStorage 不可用：无种子也能正常新建，只是少预填
	}
	window.location.href = "/write/?new=1";
}
</script>

{#if authed}
	<button
		type="button"
		class="btn-plain scale-animation rounded-lg h-11 w-11 active:scale-90"
		aria-label="New post"
		title="New post"
		onclick={() => {
			title = "";
			published = todayDateString();
			category = "";
			tags = "";
			description = "";
			slug = "";
			image = "";
			author = "";
			series = "";
			seriesOrder = "";
			pinned = false;
			draft = false;
			showMore = false;
			error = "";
			open = true;
		}}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			aria-hidden="true"
			class="text-[1.25rem]"
		>
			<!-- material-symbols:edit-outline-rounded（描边笔，与导航栏同族图标同笔重） -->
			<path
				fill="currentColor"
				d="M5 19h1.425L16.2 9.225L14.775 7.8L5 17.575zm-1 2q-.425 0-.712-.288T3 20v-2.425q0-.4.15-.763t.425-.637L16.2 3.575q.3-.275.663-.425t.762-.15t.775.15t.65.45L20.425 5q.3.275.437.65T21 6.4q0 .4-.138.763t-.437.662l-12.6 12.6q-.275.275-.638.425t-.762.15zM19 6.4L17.6 5zm-3.525 2.125l-.7-.725L16.2 9.225z"
			></path>
		</svg>
	</button>
{/if}

{#if open}
	<!-- body 级 fixed 悬浮窗（表格单元格裁剪教训：浮层一律 fixed + 高 z-index） -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
		<div
			class="card-base rounded-(--radius-large) w-full px-6 py-6 shadow-xl max-h-[85vh] overflow-y-auto write-surface"
			style="max-width: 28rem;"
			role="dialog"
			aria-modal="true"
			aria-label="新建文章"
		>
			<div class="text-sm font-medium text-90 mb-4">新建文章</div>
			<div class="mb-3">
				<label class={labelClass} for="we-seed-title">标题 *</label>
				<input
					id="we-seed-title"
					type="text"
					class={inputClass}
					placeholder="文章标题"
					bind:value={title}
					bind:this={titleInput}
					onkeydown={(event) => {
						if (event.key === "Enter") confirmNew();
					}}
				>
			</div>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 mb-3">
				<div>
					<label class={labelClass} for="we-seed-published">发布日期</label>
					<input id="we-seed-published" type="date" class={inputClass} bind:value={published}>
				</div>
				<div>
					<label class={labelClass} for="we-seed-category">分类</label>
					<input
						id="we-seed-category"
						type="text"
						class={inputClass}
						placeholder="如：日常"
						bind:value={category}
					>
				</div>
			</div>
			<div class="mb-3">
				<label class={labelClass} for="we-seed-tags">标签（逗号分隔）</label>
				<input
					id="we-seed-tags"
					type="text"
					class={inputClass}
					placeholder="随笔, 技术"
					bind:value={tags}
				>
			</div>
			<div class="mb-4">
				<label class={labelClass} for="we-seed-description">摘要</label>
				<input
					id="we-seed-description"
					type="text"
					class={inputClass}
					placeholder="用于列表与 meta 的简短描述"
					bind:value={description}
				>
			</div>
			<button
				type="button"
				class="flex items-center gap-1.5 text-xs text-50 hover:text-75 transition-colors mb-3"
				onclick={() => (showMore = !showMore)}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					class="w-3.5 h-3.5 transition-transform {showMore ? 'rotate-180' : ''}"
				>
					<path d="m6 9 6 6 6-6"></path>
				</svg>
				更多设置（可选）：URL 别名 / 封面图 / 作者 / 系列
			</button>
			{#if showMore}
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 mb-4">
					<div>
						<label class={labelClass} for="we-seed-slug">URL 别名（slug）</label>
						<input
							id="we-seed-slug"
							type="text"
							class={inputClass}
							placeholder="留空按标题自动生成拼音"
							bind:value={slug}
						>
					</div>
					<div>
						<label class={labelClass} for="we-seed-image">封面图（image）</label>
						<input
							id="we-seed-image"
							type="text"
							class={inputClass}
							placeholder="/assets/images/posts/… 或 URL"
							bind:value={image}
						>
					</div>
					<div>
						<label class={labelClass} for="we-seed-author">作者（author）</label>
						<input
							id="we-seed-author"
							type="text"
							class={inputClass}
							placeholder="留空使用站点默认"
							bind:value={author}
						>
					</div>
					<div>
						<label class={labelClass} for="we-seed-series">系列（series）</label>
						<input
							id="we-seed-series"
							type="text"
							class={inputClass}
							placeholder="系列名，非系列文章留空"
							bind:value={series}
						>
					</div>
					<div>
						<label class={labelClass} for="we-seed-series-order">系列序号（seriesOrder）</label>
						<input
							id="we-seed-series-order"
							type="number"
							class={inputClass}
							placeholder="如 1"
							bind:value={seriesOrder}
						>
					</div>
					<div class="flex items-center gap-5 sm:justify-end">
						<label class="flex items-center gap-2 text-sm text-75 cursor-pointer">
							<input type="checkbox" class="accent-(--primary) w-4 h-4" bind:checked={pinned}>
							置顶
						</label>
						<label class="flex items-center gap-2 text-sm text-75 cursor-pointer">
							<input type="checkbox" class="accent-(--primary) w-4 h-4" bind:checked={draft}>
							草稿
						</label>
					</div>
				</div>
			{/if}
			{#if error}
				<p class="text-xs text-(--primary) mb-3">{error}</p>
			{/if}
			<div class="flex justify-end gap-3">
				<button
					type="button"
					class="btn-plain rounded-(--radius-large) px-5 h-9 text-xs"
					onclick={close}
				>
					取消
				</button>
				<button
					type="button"
					class="btn-regular rounded-(--radius-large) px-5 h-9 text-xs"
					onclick={confirmNew}
				>
					填好了，开始写
				</button>
			</div>
			<p class="text-xs text-50 mt-4 leading-relaxed">
				发布日期已按今天预填，URL 别名留空会按标题自动生成拼音；确认后进入编辑器，所有字段和正文都还能随时修改。
			</p>
		</div>
	</div>
{/if}
