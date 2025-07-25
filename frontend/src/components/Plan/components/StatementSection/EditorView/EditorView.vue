<template>
  <div class="flex flex-col gap-y-2">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-x-4">
        <div class="flex items-center gap-x-1 text-sm font-medium">
          <span
            class="text-base font-medium"
            :class="isEmpty(state.statement) ? 'text-red-600' : ''"
          >
            {{ statementTitle }}
          </span>
          <span v-if="isEmpty(state.statement)" class="text-red-600">*</span>
        </div>
      </div>
      <div class="flex items-center justify-end gap-x-2">
        <template v-if="isCreating">
          <SQLUploadButton
            size="small"
            :loading="state.isUploadingFile"
            @update:sql="handleUpdateStatement"
          >
            {{ $t("issue.upload-sql") }}
          </SQLUploadButton>
        </template>

        <template v-else>
          <template v-if="!state.isEditing">
            <template v-if="shouldShowEditButton">
              <!-- for small size sheets, show full featured UI editing button group -->
              <NTooltip :disabled="denyEditStatementReasons.length === 0">
                <template #trigger>
                  <NButton
                    v-if="!isSheetOversize"
                    size="small"
                    tag="div"
                    :disabled="denyEditStatementReasons.length > 0"
                    @click.prevent="beginEdit"
                  >
                    {{ $t("common.edit") }}
                  </NButton>
                  <!-- for oversized sheets, only allow to upload and overwrite the sheet -->
                  <SQLUploadButton
                    v-else
                    size="small"
                    :loading="state.isUploadingFile"
                    @update:sql="handleUpdateStatementAndOverwrite"
                  >
                    {{ $t("issue.upload-sql") }}
                  </SQLUploadButton>
                </template>
                <template #default>
                  <ErrorList :errors="denyEditStatementReasons" />
                </template>
              </NTooltip>
            </template>
          </template>
          <template v-else>
            <SQLUploadButton
              size="small"
              :loading="state.isUploadingFile"
              @update:sql="handleUpdateStatement"
            >
              {{ $t("issue.upload-sql") }}
            </SQLUploadButton>
            <NButton
              v-if="state.isEditing"
              size="small"
              :disabled="!allowSaveSQL"
              @click.prevent="saveEdit"
            >
              {{ $t("common.save") }}
            </NButton>
            <NButton
              v-if="state.isEditing"
              size="small"
              quaternary
              @click.prevent="cancelEdit"
            >
              {{ $t("common.cancel") }}
            </NButton>
          </template>
        </template>
      </div>
    </div>

    <BBAttention
      v-if="isSheetOversize"
      type="warning"
      :title="$t('issue.statement-from-sheet-warning')"
    >
      <template #action>
        <DownloadSheetButton v-if="sheetName" :sheet="sheetName" size="small" />
      </template>
    </BBAttention>

    <div class="relative">
      <MonacoEditor
        ref="monacoEditorRef"
        class="w-full h-auto max-h-[240px] min-h-[120px] border rounded-[3px]"
        :filename="filename"
        :content="state.statement"
        :language="language"
        :auto-focus="false"
        :readonly="isEditorReadonly"
        :dialect="dialect"
        :advices="isEditorReadonly || isCreating ? markers : []"
        :auto-height="{ min: 160, max: 240 }"
        :auto-complete-context="{
          instance: database.instance,
          database: database.name,
          scene: 'all',
        }"
        @update:content="handleStatementChange"
      />
      <div class="absolute bottom-1 right-4">
        <NButton
          size="small"
          :quaternary="true"
          @click="state.showEditorModal = true"
        >
          <template #icon>
            <ExpandIcon class="w-4 h-4" />
          </template>
        </NButton>
      </div>
    </div>
  </div>

  <BBModal
    v-model:show="state.showEditorModal"
    :title="statementTitle"
    :trap-focus="true"
    header-class="!border-b-0"
    container-class="!pt-0 !overflow-hidden"
  >
    <div
      id="modal-editor-container"
      style="
        width: calc(100vw - 10rem);
        height: calc(100vh - 10rem);
        overflow: hidden;
        position: relative;
      "
      class="border rounded-[3px]"
    >
      <MonacoEditor
        v-if="state.showEditorModal"
        class="w-full h-full"
        :filename="filename"
        :content="state.statement"
        :language="language"
        :auto-focus="false"
        :readonly="isEditorReadonly"
        :dialect="dialect"
        :advices="isEditorReadonly || isCreating ? markers : []"
        :auto-complete-context="{
          instance: database.instance,
          database: database.name,
          scene: 'all',
        }"
        @update:content="handleStatementChange"
      />
    </div>
  </BBModal>
</template>

<script setup lang="ts">
import { create } from "@bufbuild/protobuf";
import { cloneDeep, head, includes, isEmpty } from "lodash-es";
import { ExpandIcon } from "lucide-vue-next";
import { NButton, NTooltip, useDialog } from "naive-ui";
import { v1 as uuidv1 } from "uuid";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { BBAttention, BBModal } from "@/bbkit";
import { MonacoEditor } from "@/components/MonacoEditor";
import { extensionNameOfLanguage } from "@/components/MonacoEditor/utils";
import { ErrorList } from "@/components/Plan/components/common";
import {
  createEmptyLocalSheet,
  databaseEngineForSpec,
  databaseForSpec,
  usePlanContext,
  planCheckRunListForSpec,
} from "@/components/Plan/logic";
import DownloadSheetButton from "@/components/Sheet/DownloadSheetButton.vue";
import SQLUploadButton from "@/components/misc/SQLUploadButton.vue";
import { planServiceClientConnect } from "@/grpcweb";
import {
  pushNotification,
  useCurrentProjectV1,
  useSheetV1Store,
} from "@/store";
import type { SQLDialect } from "@/types";
import { dialectOfEngineV1 } from "@/types";
import { UpdatePlanRequestSchema } from "@/types/proto-es/v1/plan_service_pb";
import { Task_Status } from "@/types/proto-es/v1/rollout_service_pb";
import { SheetSchema } from "@/types/proto-es/v1/sheet_service_pb";
import {
  getSheetStatement,
  getStatementSize,
  setSheetStatement,
  useInstanceV1EditorLanguage,
} from "@/utils";
import { usePlanSpecContext } from "../../SpecDetailView/context";
import { useSQLAdviceMarkers } from "../useSQLAdviceMarkers";
import type { EditState } from "./useTempEditState";
import { useTempEditState } from "./useTempEditState";

type LocalState = EditState & {
  showEditorModal: boolean;
  isUploadingFile: boolean;
};

const { t } = useI18n();
const dialog = useDialog();
const { project } = useCurrentProjectV1();
const { isCreating, plan, events, planCheckRuns, rollout } = usePlanContext();
const { selectedSpec } = usePlanSpecContext();
const monacoEditorRef = ref<InstanceType<typeof MonacoEditor>>();

const state = reactive<LocalState>({
  isEditing: false,
  statement: "",
  showEditorModal: false,
  isUploadingFile: false,
});

const database = computed(() => {
  return databaseForSpec(project.value, selectedSpec.value);
});

const language = useInstanceV1EditorLanguage(
  computed(() => database.value.instanceResource)
);
const filename = computed(() => {
  const name = uuidv1();
  const ext = extensionNameOfLanguage(language.value);
  return `${name}.${ext}`;
});
const dialect = computed((): SQLDialect => {
  const db = database.value;
  return dialectOfEngineV1(db.instanceResource.engine);
});
const statementTitle = computed(() => {
  return language.value === "sql" ? t("common.sql") : t("common.statement");
});
const planCheckRunsForSelectedSpec = computed(() =>
  planCheckRunListForSpec(planCheckRuns.value, selectedSpec.value)
);
const { markers } = useSQLAdviceMarkers(
  isCreating,
  planCheckRunsForSelectedSpec
);

/**
 * to set the MonacoEditor as readonly
 * This happens when
 * - Not in edit mode
 * - Disallowed to edit statement
 */
const isEditorReadonly = computed(() => {
  if (isCreating.value) {
    return false;
  }
  return !state.isEditing || isSheetOversize.value || false;
});

const {
  sheet,
  sheetName,
  sheetReady,
  sheetStatement,
  reset: resetTempEditState,
} = useTempEditState(state);

const isSheetOversize = computed(() => {
  if (isCreating.value) return false;
  if (state.isEditing) return false;
  if (!sheetReady.value) return false;
  if (!sheet.value) return false;
  return getStatementSize(getSheetStatement(sheet.value)).lt(
    sheet.value.contentSize
  );
});

const denyEditStatementReasons = computed(() => {
  return [];
});

const shouldShowEditButton = computed(() => {
  // Need not to show "Edit" while the plan is still pending create.
  if (isCreating.value) {
    return false;
  }
  // Will show another button group as [Upload][Cancel][Save]
  // while editing
  if (state.isEditing) {
    return false;
  }
  if (plan.value.rollout && rollout?.value) {
    const tasks = rollout.value.stages
      .flatMap((stage) => stage.tasks)
      .filter((task) => task.specId === selectedSpec.value.id);
    if (
      tasks.some((task) =>
        includes(
          [
            Task_Status.RUNNING,
            Task_Status.PENDING,
            Task_Status.DONE,
            Task_Status.SKIPPED,
          ],
          task.status
        )
      )
    ) {
      return false;
    }
  }
  return true;
});

const allowSaveSQL = computed((): boolean => {
  if (state.statement === "") {
    // Not allowed if the statement is empty.
    return false;
  }
  if (!sheetReady.value) {
    return false;
  }
  if (state.statement === sheetStatement.value) {
    // Not allowed if the statement is not modified.
    return false;
  }

  // Allowed to save otherwise
  return true;
});

const beginEdit = () => {
  state.isEditing = true;
};

const saveEdit = async () => {
  try {
    await updateStatement(state.statement);
    resetTempEditState();
  } finally {
    state.isEditing = false;
  }
};

const cancelEdit = () => {
  state.statement = sheetStatement.value;
  state.isEditing = false;
};

const showOverwriteConfirmDialog = () => {
  return new Promise((resolve, reject) => {
    // Show a confirm dialog before replacing if the editing statement is not empty.
    dialog.create({
      positiveText: t("common.confirm"),
      negativeText: t("common.cancel"),
      title: t("issue.overwrite-current-statement"),
      autoFocus: false,
      closable: false,
      maskClosable: false,
      closeOnEsc: false,
      onNegativeClick: () => {
        reject();
      },
      onPositiveClick: () => {
        resolve(undefined);
      },
    });
  });
};

const handleUpdateStatementAndOverwrite = async (
  statement: string,
  filename: string
) => {
  try {
    await showOverwriteConfirmDialog();
  } catch {
    return;
  }

  state.isEditing = true;
  state.statement = statement;
  await handleUpdateStatement(statement, filename);
};

const handleUpdateStatement = async (statement: string, filename: string) => {
  try {
    state.isUploadingFile = true;
    handleStatementChange(statement);
    if (sheet.value) {
      sheet.value.title = filename;
    }
    resetTempEditState();
  } finally {
    state.isUploadingFile = false;
  }
};

const updateStatement = async (statement: string) => {
  const planPatch = cloneDeep(plan.value);
  if (!planPatch) {
    return;
  }
  const specsToPatch = planPatch.specs.filter(
    (spec) => spec.id === selectedSpec.value.id
  );
  const specEngine = await databaseEngineForSpec(head(specsToPatch));
  const sheet = create(SheetSchema, {
    ...createEmptyLocalSheet(),
    title: plan.value.title,
    engine: specEngine 
    ,
  });
  setSheetStatement(sheet, statement);
  const createdSheet = await useSheetV1Store().createSheet(
    project.value.name,
    sheet
  );

  for (const spec of specsToPatch) {
    if (spec.config?.case === "changeDatabaseConfig") {
      spec.config.value.sheet = createdSheet.name;
    } else if (spec.config?.case === "exportDataConfig") {
      spec.config.value.sheet = createdSheet.name;
    } else {
      throw new Error(
        `Unsupported spec type for plan update ${JSON.stringify(spec)}`
      );
    }
  }

  const request = create(UpdatePlanRequestSchema, {
    plan: planPatch,
    updateMask: { paths: ["specs"] },
  });
  const response = await planServiceClientConnect.updatePlan(request);

  Object.assign(plan.value, response);
  events.emit("status-changed", { eager: true });
  pushNotification({
    module: "bytebase",
    style: "SUCCESS",
    title: t("common.updated"),
  });
};

const handleStatementChange = (statement: string) => {
  if (isEditorReadonly.value) {
    return;
  }

  state.statement = statement;
  if (isCreating.value) {
    // When creating an plan, update the local sheet directly.
    if (!sheet.value) return;
    setSheetStatement(sheet.value, statement);
  }
};

watch(
  sheetStatement,
  (statement) => {
    state.statement = statement;
  },
  { immediate: true }
);

watch(isCreating, (curr, prev) => {
  // Reset the edit state after creating the plan.
  if (!curr && prev) {
    state.isEditing = false;
  }
});

defineExpose({
  get editor() {
    return monacoEditorRef.value;
  },
});
</script>
