<template>
  <div class="w-full flex items-start gap-x-4 flex-wrap">
    <div
      class="text-base font-medium inline-flex items-center"
      :class="labelClass"
    >
      {{ $t("task.task-checks") }}
    </div>

    <div class="flex-1">
      <PlanCheckRunBadgeBar
        :plan-check-run-list="planCheckRunList"
        @select-type="selectedType = $event"
      />
    </div>

    <div class="flex justify-end items-center shrink-0">
      <PlanCheckRunButton
        v-if="allowRunChecks"
        :plan-check-run-list="planCheckRunList"
        @run-checks="runChecks"
      />
    </div>

    <PlanCheckRunModal
      v-if="planCheckRunList.length > 0 && selectedType"
      :selected-type="selectedType"
      :plan-check-run-list="planCheckRunList"
      :database="database"
      @close="selectedType = undefined"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { create } from "@bufbuild/protobuf";
import { planServiceClientConnect } from "@/grpcweb";
import { RunPlanChecksRequestSchema } from "@/types/proto-es/v1/plan_service_pb";
import type { ComposedDatabase } from "@/types";
import type {
  PlanCheckRun,
  PlanCheckRun_Type,
} from "@/types/proto-es/v1/plan_service_pb";
import type { VueClass } from "@/utils";
import PlanCheckRunBadgeBar from "./PlanCheckRunBadgeBar.vue";
import PlanCheckRunButton from "./PlanCheckRunButton.vue";
import PlanCheckRunModal from "./PlanCheckRunModal.vue";
import { usePlanCheckRunContext } from "./context";

const props = withDefaults(
  defineProps<{
    allowRunChecks?: boolean;
    labelClass?: VueClass;
    planName: string;
    planCheckRunList?: PlanCheckRun[];
    database: ComposedDatabase;
  }>(),
  {
    allowRunChecks: true,
    labelClass: "",
    planCheckRunList: () => [],
  }
);

const { events } = usePlanCheckRunContext();

const selectedType = ref<PlanCheckRun_Type>();

const runChecks = async () => {
  const request = create(RunPlanChecksRequestSchema, {
    name: props.planName,
  });
  await planServiceClientConnect.runPlanChecks(request);
  events.emit("status-changed");
};
</script>
