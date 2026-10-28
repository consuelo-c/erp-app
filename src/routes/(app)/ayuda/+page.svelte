<script lang="ts">
	import { page } from '$app/state';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { formatInstantDate } from '$lib/datetime';
	import type { PageProps } from './$types';

	// No edit button: the editor is in Sistema. Every question starts closed, several open at once.
	let { data }: PageProps = $props();

	// Not every browser opens a closed <details> for the URL's fragment: it's opened here, on arrival
	// and on every change of the hash, so a link to one question opens it.
	$effect(() => {
		const question = document.getElementById(page.url.hash.slice(1));
		if (question instanceof HTMLDetailsElement) {
			question.open = true;
			question.scrollIntoView();
		}
	});

	function showAltText(image: HTMLImageElement) {
		const missing = document.createElement('div');
		missing.className = 'prose__img-missing';
		missing.setAttribute('role', 'img');
		missing.setAttribute('aria-label', image.alt);
		missing.textContent = image.alt;
		image.replaceWith(missing);
	}

	// An image that doesn't load leaves its alt text in its place. `error` doesn't bubble, so it's
	// caught on the way down; one that failed before hydration is found by its empty size.
	function replaceBrokenImages(node: HTMLElement) {
		for (const image of node.querySelectorAll('img')) {
			if (image.complete && 0 === image.naturalWidth) {
				showAltText(image);
			}
		}
		const onError = ({ target }: Event) => {
			if (target instanceof HTMLImageElement) {
				showAltText(target);
			}
		};
		node.addEventListener('error', onError, true);
		return () => node.removeEventListener('error', onError, true);
	}
</script>

<svelte:head>
	<title>Ayuda · Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader title="Ayuda" />
	{/snippet}

	<!-- eslint-disable svelte/no-at-html-tags -- renderHelp's output: raw HTML escaped, links and images filtered -->
	<div {@attach replaceBrokenImages}>
		<div class="prose">{@html data.help.intro}</div>
		{#if data.help.questions.length}
			<div class="disclosure-list">
				{#each data.help.questions as question (question.id)}
					<details class="disclosure" id={question.id}>
						<summary class="disclosure__summary">
							<span>{@html question.heading}</span>
							<span class="disclosure__chevron" aria-hidden="true"></span>
						</summary>
						<div class="disclosure__body prose">{@html question.body}</div>
					</details>
				{/each}
			</div>
		{/if}
	</div>
	<!-- eslint-enable svelte/no-at-html-tags -->

	{#if data.updatedAt}
		<p class="meta updated">Actualizado el {formatInstantDate(data.updatedAt)}</p>
	{/if}
</Screen>

<style>
	/* Stacked apart, so several open ones stay separate; an open one gets the ink border. */
	.disclosure-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		margin-top: var(--space-10);
	}

	.disclosure {
		background: var(--surface-card);
		border: var(--border-w) solid var(--border-default);
		border-radius: var(--radius-card);
	}

	.disclosure[open] {
		border-color: var(--border-strong);
	}

	.disclosure__summary {
		box-sizing: border-box;
		display: flex;
		gap: var(--space-6);
		align-items: center;
		min-height: var(--tap-min);
		padding: var(--space-6) var(--space-8);
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
		line-height: 1.35;
		text-wrap: pretty;
		cursor: pointer;
		list-style: none;
	}

	.disclosure__summary::-webkit-details-marker {
		display: none;
	}

	.disclosure__summary > :first-child {
		flex: 1;
		min-width: 0;
	}

	.disclosure__chevron {
		flex: none;
		width: 16px;
		font-size: var(--text-lg);
		line-height: 1;
		color: var(--text-secondary);
		text-align: center;
	}

	.disclosure__chevron::before {
		content: '›';
	}

	.disclosure[open] .disclosure__chevron::before {
		content: '⌄';
	}

	.disclosure__body {
		padding: var(--space-6) var(--space-8) var(--space-8);
		border-top: var(--border-w-hair) solid var(--border-default);
	}

	@media (hover: hover) {
		.disclosure:not([open]):hover {
			border-color: var(--text-disabled);
		}
	}

	.updated {
		margin-top: var(--space-12);
	}
</style>
