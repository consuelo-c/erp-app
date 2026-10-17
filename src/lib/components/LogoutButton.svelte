<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';
	import Modal from './Modal.svelte';

	// «Cerrar sesión» in the session row. Ending the session asks first, as every session-ending
	// action does.
	let open = $state(false);
	const formId = $props.id();
</script>

<Button type="button" variant="secondary" size="sm" inline onclick={() => (open = true)}>
	<Icon name="exit" size="sm" />Cerrar sesión
</Button>

<!-- A form, not a link: logging out is a POST, covered by SvelteKit's checkOrigin. The submit button
     sits in the dialog and reaches the form through its `form` attribute. -->
<form id={formId} method="POST" action={resolve('/logout')} hidden></form>

<Modal bind:open title="Cerrar sesión" body="Vas a salir de tu cuenta en este dispositivo.">
	{#snippet actions()}
		<Button type="button" variant="secondary" onclick={() => (open = false)}>Cancelar</Button>
		<Button type="submit" form={formId}>Cerrar sesión</Button>
	{/snippet}
</Modal>
