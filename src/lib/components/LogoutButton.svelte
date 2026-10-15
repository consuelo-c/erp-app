<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from './Button.svelte';
	import IconButton from './IconButton.svelte';
	import Modal from './Modal.svelte';

	// The header's exit icon. Ending the session asks first, as every session-ending action does.
	let open = $state(false);
	const formId = $props.id();
</script>

<IconButton icon="exit" label="Cerrar sesión" onclick={() => (open = true)} />

<!-- A form, not a link: logging out is a POST, covered by SvelteKit's checkOrigin. The submit button
     sits in the dialog and reaches the form through its `form` attribute. -->
<form id={formId} method="POST" action={resolve('/logout')} hidden></form>

<Modal bind:open title="Cerrar sesión" body="Vas a salir de tu cuenta en este dispositivo.">
	{#snippet actions()}
		<Button type="button" variant="secondary" onclick={() => (open = false)}>Cancelar</Button>
		<Button type="submit" form={formId}>Cerrar sesión</Button>
	{/snippet}
</Modal>
