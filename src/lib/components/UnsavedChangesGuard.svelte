<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { on } from 'svelte/events';
	import Button from './Button.svelte';
	import Modal from './Modal.svelte';

	// Watches the form with this id: once something is typed in it, leaving the screen asks first.
	// Reloading or closing the tab can only get the browser's own dialog.
	let { form }: { form: string } = $props();

	let dirty = false;
	let open = $state(false);
	let leave = () => {};

	$effect(() => {
		const offInput = on(document, 'input', (event) => {
			if (form === (event.target as HTMLInputElement).form?.id) {
				dirty = true;
			}
		});
		// Saving clears it, so the save's own redirect leaves without asking.
		const offSubmit = on(document, 'submit', (event) => {
			if (form === (event.target as HTMLFormElement).id) {
				dirty = false;
			}
		});
		return () => {
			offInput();
			offSubmit();
		};
	});

	// A failed save comes back with what was typed: still unsaved.
	$effect(() => {
		if (page.form) {
			dirty = true;
		}
	});

	beforeNavigate((navigation) => {
		if (!dirty) {
			return;
		}
		navigation.cancel();
		if ('leave' === navigation.type) {
			return;
		}
		const { delta, to } = navigation;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- `to.url` is the URL SvelteKit already resolved
		leave = 'popstate' === navigation.type ? () => history.go(delta) : () => goto(to!.url);
		open = true;
	});

	function confirmLeave() {
		dirty = false;
		open = false;
		leave();
	}
</script>

<Modal
	bind:open
	title="¿Salir sin guardar?"
	body="Los cambios que hiciste en esta pantalla se pierden."
>
	{#snippet actions()}
		<Button type="button" variant="secondary" onclick={() => (open = false)}>
			Seguir editando
		</Button>
		<Button type="button" onclick={confirmLeave}>Salir sin guardar</Button>
	{/snippet}
</Modal>
