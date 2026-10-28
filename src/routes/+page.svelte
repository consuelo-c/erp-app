<script lang="ts" module>
	// Explicit rendering: the widget also appears after arriving here from another page of the app,
	// where a script tag in the head would already have run. The script loads only on this page.
	const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

	let scriptLoad: Promise<void> | undefined;

	function loadTurnstile(): Promise<void> {
		scriptLoad ??= new Promise((done, failed) => {
			const script = document.createElement('script');
			script.src = TURNSTILE_SCRIPT;
			script.onload = () => done();
			script.onerror = () => {
				scriptLoad = undefined;
				failed(new Error('Turnstile did not load'));
			};
			document.head.appendChild(script);
		});
		return scriptLoad;
	}
</script>

<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import Card from '$lib/components/Card.svelte';
	import Field from '$lib/components/Field.svelte';
	import IconButton from '$lib/components/IconButton.svelte';
	import Input from '$lib/components/Input.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import Screen from '$lib/components/Screen.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import WhatsAppButton from '$lib/components/WhatsAppButton.svelte';
	import { ORDER_STATUS_LABELS } from '$lib/labels';
	import type { PageProps } from './$types';

	// The public landing: the logo, the client's lookup and the company's WhatsApp. One match opens
	// its page; two or more list below the form. Every label says what it is: the client has never
	// used the app.
	let { data, form }: PageProps = $props();

	let submitting = $state(false);
	let widgetId: string | undefined;

	function turnstileWidget(container: HTMLElement) {
		let removed = false;
		loadTurnstile()
			.then(() => {
				if (!removed && window.turnstile) {
					widgetId = window.turnstile.render(container, { sitekey: data.siteKey, language: 'es' });
				}
			})
			.catch(() => {
				// The server refuses an unverified lookup, with its own message.
			});
		return () => {
			removed = true;
			if (undefined !== widgetId) {
				window.turnstile?.remove(widgetId);
				widgetId = undefined;
			}
		};
	}

	// A token is valid once: the widget resets after every submit, whatever the answer.
	const lookup: SubmitFunction = () => {
		submitting = true;
		return async ({ update }) => {
			await update({ reset: false });
			submitting = false;
			if (undefined !== widgetId) {
				window.turnstile?.reset(widgetId);
			}
		};
	};
</script>

<svelte:head>
	<title>Banquetes Consuelo C</title>
</svelte:head>

<Screen>
	{#snippet header()}
		<ScreenHeader>
			<span class="landing__entry">
				<IconButton href={resolve('/login')} icon="login" label="Empleados" />
			</span>
		</ScreenHeader>
	{/snippet}

	<div class="landing">
		<img class="landing__logo" src="/banquetes-consuelo-c-logo.svg" alt="Banquetes Consuelo C" />

		<form class="form-stack" method="POST" use:enhance={lookup}>
			<h1 class="landing__title">Consulte su pedido</h1>
			<Field
				label="Teléfono"
				id="phone"
				hint="El teléfono con el que hizo el pedido."
				error={form?.errors?.phone}
			>
				<Input
					id="phone"
					name="phone"
					type="tel"
					inputmode="tel"
					autocomplete="tel"
					placeholder="Ej. 310 442 8890"
					value={form?.phone ?? ''}
					required
					aria-invalid={undefined !== form?.errors?.phone}
				/>
			</Field>
			<Field label="Fecha del evento" id="event_date" error={form?.errors?.event_date}>
				<Input
					id="event_date"
					name="event_date"
					type="date"
					min={data.minDate}
					value={form?.event_date ?? ''}
					required
					aria-invalid={undefined !== form?.errors?.event_date}
				/>
			</Field>
			<div class="landing__turnstile" {@attach turnstileWidget}></div>
			<Button type="submit" disabled={submitting}>
				{submitting ? 'Consultando…' : 'Consultar'}
			</Button>
			{#if form?.message}
				<Notice tone="error">{form.message}</Notice>
			{/if}
			{#if form?.matches}
				<ul class="landing__matches">
					{#each form.matches as match (match.id)}
						<li>
							<Card href={resolve('/mi-pedido/[token]', { token: match.token })}>
								<span class="landing__match">
									Pedido #{match.id} · {ORDER_STATUS_LABELS[match.status]}
									<span class="landing__chevron" aria-hidden="true">›</span>
								</span>
							</Card>
						</li>
					{/each}
				</ul>
			{/if}
		</form>
	</div>
</Screen>

{#if data.whatsAppHref}
	<WhatsAppButton href={data.whatsAppHref} />
{/if}

<style>
	.landing__entry {
		margin-left: auto;
	}

	/* The bottom padding keeps the results clear of the WhatsApp button. */
	.landing {
		max-width: 420px;
		padding-bottom: 124px;
		margin: 0 auto;
	}

	/* Wide enough for the script logo's thin strokes to stay legible, as on the login. */
	.landing__logo {
		display: block;
		width: 75%;
		max-width: 240px;
		margin: var(--space-14) auto 36px;
	}

	.landing__title {
		margin: 0 0 var(--space-2);
		font-size: var(--text-3xl);
		font-weight: var(--weight-bold);
	}

	/* Turnstile's own iframe, 300 by 65. */
	.landing__turnstile {
		min-height: 65px;
	}

	/* The form is already narrow: its button keeps the fields' width, as on the login. */
	.landing :global(.btn) {
		max-width: none;
	}

	.landing__matches {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.landing__match {
		display: flex;
		gap: var(--space-6);
		align-items: center;
		justify-content: space-between;
		font-size: var(--text-input);
		font-weight: var(--weight-semibold);
	}

	.landing__chevron {
		font-size: var(--text-2xl);
		color: var(--text-secondary);
	}

	@container (width >= 1024px) {
		.landing__logo {
			width: 280px;
			max-width: none;
			margin-top: var(--space-14);
		}
	}
</style>
