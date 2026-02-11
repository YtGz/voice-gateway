<script lang="ts">
	interface Props {
		level: number;
		isActive: boolean;
	}
	
	let { level, isActive }: Props = $props();
</script>

<div class="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
	<div 
		class="h-full transition-all duration-75 rounded-full {isActive ? 'bg-green-500' : 'bg-blue-500'}"
		style="width: {Math.min(100, level * 100)}%"
	></div>
</div>
