<template>
  <div v-if="viewMode !== 'NONE'" class="px-4 flex flex-col gap-y-2">
    <EditorView v-if="viewMode === 'EDITOR'" />
    <ReleaseView v-else-if="viewMode === 'RELEASE'" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { usePlanSpecContext } from "../SpecDetailView/context";
import EditorView from "./EditorView";
import ReleaseView from "./ReleaseView";

const { selectedSpec } = usePlanSpecContext();

const viewMode = computed((): "NONE" | "EDITOR" | "RELEASE" => {
  if (selectedSpec.value) {
    const spec = selectedSpec.value;
    // Check if this is a release-based spec (has release but no sheet)
    if (
      spec.config?.case === "changeDatabaseConfig" &&
      spec.config.value.release &&
      !spec.config.value.sheet
    ) {
      return "RELEASE";
    }
    // Otherwise, it's a sheet-based spec
    return "EDITOR";
  }
  return "NONE";
});
</script>
