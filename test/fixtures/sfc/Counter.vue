<template>
  <button @click="increment">{{ label }} {{ count }}</button>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { formatLabel } from "./helpers";

interface Props {
  start: number;
}

const props = defineProps<Props>();
const count = ref(props.start);
const label = computed(() => formatLabel(count.value));

function increment(): void {
  count.value += 1;
}
</script>

<style scoped>
button { color: blue; }
</style>
