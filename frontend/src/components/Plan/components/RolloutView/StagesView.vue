<template>
  <div class="w-full h-full flex flex-col p-4">
    <div class="w-full flex grow overflow-auto bg-zinc-50 p-6 rounded-lg">
      <div
        class="relative w-auto flex flex-row items-start justify-start gap-8"
      >
        <!-- Connecting line -->
        <div class="absolute top-5 border-t-2 border-gray-200 w-full z-0"></div>

        <StageCard
          v-for="stage in mergedStages"
          :key="stage.name"
          :stage="stage"
          :task-status-filter="taskStatusFilter"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Stage, Task_Status } from "@/types/proto-es/v1/rollout_service_pb";
import StageCard from "./StageCard.vue";

defineProps<{
  mergedStages: Stage[];
  taskStatusFilter: Task_Status[];
}>();
</script>
