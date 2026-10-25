<script lang="ts">
/**
 * 导航栏「写文章」图标入口：token 验证通过后才渲染（访客看不到任何编辑入口）。
 * 点击弹出新建文章悬浮窗：标题 / 分类 / 标签 / 摘要先行填写，
 * 确认后经 sessionStorage 种子交给 /write/?new=1，编辑器内 frontmatter 自动预填。
 */
import { tick } from "svelte";
import { ensureVerified, resolveToken } from "@/utils/write/auth";

let authed = $state(false);
let open = $state(false);
let title = $state("");
let category = $state("");
let tags = $state("");
let description = $state("");
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
	const seed = {
		title: trimmed,
		category: category.trim(),
		tags: tags
			.split(/[,，]/)
			.map((tag) => tag.trim())
			.filter(Boolean),
		description: description.trim(),
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
		aria-label="写文章"
		title="写文章"
		onclick={() => {
			title = "";
			category = "";
			tags = "";
			description = "";
			error = "";
			open = true;
		}}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			class="text-[1.25rem]"
		>
			<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path>
		</svg>
	</button>
{/if}

{#if open}
	<!-- body 级 fixed 悬浮窗（表格单元格裁剪教训：浮层一律 fixed + 高 z-index） -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
		<div
			class="card-base rounded-(--radius-large) w-full px-6 py-6 shadow-xl"
			style="max-width: 28rem;"
			role="dialog"
			aria-modal="true"
			aria-label="新建文章"
		>
			<div class="text-sm font-medium text-90 mb-4">新建文章</div>
			<div class="mb-3">
				<label class={labelClass} for="we-seed-title">标题 ＊</label>
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
					<label class={labelClass} for="we-seed-category">分类</label>
					<input
						id="we-seed-category"
						type="text"
						class={inputClass}
						placeholder="如：日常"
						bind:value={category}
					>
				</div>
				<div>
					<label class={labelClass} for="we-seed-tags">标签（逗号分隔）</label>
					<input
						id="we-seed-tags"
						type="text"
						class={inputClass}
						placeholder="随笔, 技术"
						bind:value={tags}
					>
				</div>
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
				确认后进入编辑器：日期、文件名、slug 等其余字段自动预填，仍可随时修改。
			</p>
		</div>
	</div>
{/if}
