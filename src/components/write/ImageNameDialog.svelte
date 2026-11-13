<script lang="ts">
/**
 * 插图命名卡：选图后先定名再插入 —— 预填建议名（回车直接用原名）、
 * 后缀固定不可改、Esc 取消。插入后仍可直接改正文里的路径来重命名，
 * 或删掉那一行引用来删图；图片本体在点「暂存草稿/发布」前只存浏览器内存。
 */
let {
	previewUrl,
	suggested,
	ext,
	onconfirm,
	oncancel,
}: {
	previewUrl: string;
	suggested: string;
	ext: string;
	onconfirm: (name: string) => void;
	oncancel: () => void;
} = $props();

let nameInput = $state<HTMLInputElement | null>(null);
let value = $state(suggested);

$effect(() => {
	// 光标落在末尾而不是全选：接着打字即改名，直接回车 = 用建议名
	const el = nameInput;
	if (!el) return;
	el.focus();
	const end = el.value.length;
	el.setSelectionRange(end, end);
});

function confirm() {
	onconfirm(value);
}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === "Escape") oncancel();
	}}
/>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
	role="dialog"
	aria-modal="true"
	aria-label="命名这张图片"
>
	<div class="card-base w-full max-w-md rounded-(--radius-large) p-6">
		<div class="text-sm font-medium text-90 mb-4">命名这张图片</div>
		<img
			src={previewUrl}
			alt="待插入图片预览"
			class="max-h-40 max-w-full w-auto mx-auto rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/10 object-contain mb-4"
		>
		<div class="flex items-center gap-2">
			<input
				bind:this={nameInput}
				bind:value={value}
				type="text"
				onkeydown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						confirm();
					}
				}}
				class="w-full px-3 py-2 text-sm bg-transparent border border-black/10 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-(--primary) focus:border-(--primary) hover:border-black/20 dark:hover:border-white/20 text-75 write-input transition-colors outline-hidden font-mono"
				aria-label="图片文件名（不含后缀）"
			>
			<span
				class="shrink-0 px-2 py-1.5 text-xs text-50 font-mono rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10"
				title="后缀跟随原图，不可修改"
			>
				{ext}
			</span>
		</div>
		<p class="text-xs text-50 mt-3 leading-relaxed">
			回车确认用当前名字；插入后也可以直接改正文里的路径来重命名，删掉那一行引用即删图。
		</p>
		<div class="flex justify-end gap-3 mt-5">
			<button
				type="button"
				class="btn-plain rounded-(--radius-large) px-5 h-9 text-xs"
				onclick={oncancel}
			>
				取消
			</button>
			<button
				type="button"
				class="btn-regular rounded-(--radius-large) px-5 h-9 text-xs"
				onclick={confirm}
			>
				插入图片
			</button>
		</div>
	</div>
</div>
