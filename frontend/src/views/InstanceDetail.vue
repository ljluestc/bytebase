<template>
  <div class="space-y-2 px-6" v-bind="$attrs">
    <ArchiveBanner v-if="instance.state === State.DELETED" />

    <div v-if="!embedded" class="flex items-center justify-between">
      <div class="flex items-center gap-x-2">
        <EngineIcon :engine="instance.engine" custom-class="!h-6" />
        <span class="text-lg font-medium">{{ instanceV1Name(instance) }}</span>
      </div>
    </div>

    <NTabs v-model:value="state.selectedTab">
      <template #suffix>
        <div class="flex items-center space-x-2">
          <InstanceSyncButton
            v-if="instance.state === State.ACTIVE"
            @sync-schema="syncSchema"
          />
          <NButton
            v-if="allowCreateDatabase"
            type="primary"
            @click.prevent="createDatabase"
          >
            <template #icon>
              <PlusIcon class="h-4 w-4" />
            </template>
            {{ $t("instance.new-database") }}
          </NButton>
        </div>
      </template>
      <NTabPane name="overview" :tab="$t('common.overview')">
        <InstanceForm class="-mt-2" :instance="instance">
          <InstanceFormBody :hide-archive-restore="hideArchiveRestore" />
          <InstanceFormButtons class="sticky bottom-0 z-10" />
        </InstanceForm>
      </NTabPane>
      <NTabPane name="databases" :tab="$t('common.databases')">
        <div class="space-y-2">
          <div
            class="w-full flex flex-col sm:flex-row items-start sm:items-end justify-between gap-2"
          >
            <AdvancedSearch
              v-model:params="state.params"
              class="flex-1"
              :autofocus="false"
              :placeholder="$t('database.filter-database')"
              :scope-options="scopeOptions"
            />
          </div>
          <DatabaseOperations
            :databases="selectedDatabases"
            @refresh="() => pagedDatabaseTableRef?.refresh()"
            @update="
              (databases) => pagedDatabaseTableRef?.updateCache(databases)
            "
          />
          <PagedDatabaseTable
            ref="pagedDatabaseTableRef"
            mode="INSTANCE"
            :footer-class="'pb-4'"
            :show-selection="true"
            :filter="filter"
            :parent="instance.name"
            v-model:selected-database-names="state.selectedDatabaseNameList"
          />
        </div>
      </NTabPane>
      <NTabPane name="users" :tab="$t('instance.users')">
        <InstanceRoleTable :instance-role-list="instanceRoleList" />
      </NTabPane>
    </NTabs>
  </div>

  <Drawer
    v-model:show="state.showCreateDatabaseModal"
    :title="$t('quick-action.create-db')"
  >
    <CreateDatabasePrepPanel
      :environment-name="
        environment ? formatEnvironmentName(environment.id) : undefined
      "
      :instance-name="instance.name"
      @dismiss="state.showCreateDatabaseModal = false"
    />
  </Drawer>
</template>

<script lang="tsx" setup>
import { useTitle } from "@vueuse/core";
import { cloneDeep } from "lodash-es";
import { PlusIcon } from "lucide-vue-next";
import { NButton, NTabPane, NTabs } from "naive-ui";
import { computed, reactive, watch, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter, useRoute } from "vue-router";
import AdvancedSearch from "@/components/AdvancedSearch";
import { useCommonSearchScopeOptions } from "@/components/AdvancedSearch/useCommonSearchScopeOptions";
import ArchiveBanner from "@/components/ArchiveBanner.vue";
import { CreateDatabasePrepPanel } from "@/components/CreateDatabasePrepForm";
import { EngineIcon } from "@/components/Icon";
import InstanceSyncButton from "@/components/Instance/InstanceSyncButton.vue";
import {
  InstanceForm,
  Form as InstanceFormBody,
  Buttons as InstanceFormButtons,
} from "@/components/InstanceForm/";
import { InstanceRoleTable, Drawer } from "@/components/v2";
import {
  PagedDatabaseTable,
  DatabaseOperations,
} from "@/components/v2/Model/DatabaseV1Table";
import { useBodyLayoutContext } from "@/layouts/common";
import {
  pushNotification,
  useDatabaseV1Store,
  useInstanceV1Store,
  useEnvironmentV1Store,
  useAppFeature,
} from "@/store";
import {
  instanceNamePrefix,
  projectNamePrefix,
  environmentNamePrefix,
} from "@/store/modules/v1/common";
import {
  type ComposedDatabase,
  formatEnvironmentName,
  isValidDatabaseName,
} from "@/types";
import { State } from "@/types/proto-es/v1/common_pb";
import { DatabaseChangeMode } from "@/types/proto-es/v1/setting_service_pb";
import {
  instanceV1HasCreateDatabase,
  instanceV1Name,
  CommonFilterScopeIdList,
} from "@/utils";
import type { SearchParams, SearchScope } from "@/utils";

const instanceHashList = ["overview", "databases", "users"] as const;
export type InstanceHash = (typeof instanceHashList)[number];
const isInstanceHash = (x: any): x is InstanceHash =>
  instanceHashList.includes(x);

interface LocalState {
  showCreateDatabaseModal: boolean;
  syncingSchema: boolean;
  selectedDatabaseNameList: string[];
  params: SearchParams;
  selectedTab: InstanceHash;
}

const props = defineProps<{
  instanceId: string;
  embedded?: boolean;
  hideArchiveRestore?: boolean;
}>();

defineOptions({
  inheritAttrs: false,
});

if (!props.embedded) {
  const { overrideMainContainerClass } = useBodyLayoutContext();
  overrideMainContainerClass("!pb-0");
}

const { t } = useI18n();
const router = useRouter();
const instanceV1Store = useInstanceV1Store();
const databaseStore = useDatabaseV1Store();
const databaseChangeMode = useAppFeature("bb.feature.database-change-mode");
const pagedDatabaseTableRef = ref<InstanceType<typeof PagedDatabaseTable>>();

const readonlyScopes = computed((): SearchScope[] => [
  { id: "instance", value: props.instanceId, readonly: true },
]);

const state = reactive<LocalState>({
  showCreateDatabaseModal: false,
  syncingSchema: false,
  selectedDatabaseNameList: [],
  params: {
    query: "",
    scopes: [...readonlyScopes.value],
  },
  selectedTab: "overview",
});

const route = useRoute();

const scopeOptions = useCommonSearchScopeOptions([
  ...CommonFilterScopeIdList,
  "project",
  "database-label",
]);

watch(
  () => route.hash,
  (hash) => {
    const targetHash = hash.replace(/^#?/g, "") as InstanceHash;
    if (isInstanceHash(targetHash)) {
      state.selectedTab = targetHash;
    }
  },
  { immediate: true }
);

watch(
  () => state.selectedTab,
  (tab) => {
    const query = cloneDeep(route.query);
    delete query["qs"];
    router.replace({
      query,
      hash: `#${tab}`,
    });
  },
  { immediate: true }
);

const instance = computed(() => {
  return instanceV1Store.getInstanceByName(
    `${instanceNamePrefix}${props.instanceId}`
  );
});

const environment = computed(() => {
  return useEnvironmentV1Store().getEnvironmentByName(
    instance.value.environment
  );
});

const selectedEnvironment = computed(() => {
  const environmentId = state.params.scopes.find(
    (scope) => scope.id === "environment"
  )?.value;
  if (!environmentId) {
    return;
  }
  return `${environmentNamePrefix}${environmentId}`;
});

const selectedProject = computed(() => {
  const projectId = state.params.scopes.find(
    (scope) => scope.id === "project"
  )?.value;
  if (!projectId) {
    return;
  }
  return `${projectNamePrefix}${projectId}`;
});

const selectedLabels = computed(() => {
  return state.params.scopes
    .filter((scope) => scope.id === "database-label")
    .map((scope) => scope.value);
});

const filter = computed(() => ({
  environment: selectedEnvironment.value,
  project: selectedProject.value,
  query: state.params.query,
  labels: selectedLabels.value,
}));

const instanceRoleList = computed(() => {
  return instance.value.roles;
});

const allowCreateDatabase = computed(() => {
  return (
    databaseChangeMode.value === DatabaseChangeMode.PIPELINE &&
    instance.value.state === State.ACTIVE &&
    instanceV1HasCreateDatabase(instance.value)
  );
});

const syncSchema = async (enableFullSync: boolean) => {
  await instanceV1Store.syncInstance(instance.value.name, enableFullSync);
  // Remove the database list cache for the instance.
  databaseStore.removeCacheByInstance(instance.value.name);
  pushNotification({
    module: "bytebase",
    style: "SUCCESS",
    title: t(
      "instance.successfully-synced-schema-for-instance-instance-value-name",
      [instance.value.title]
    ),
  });
};

const createDatabase = () => {
  state.showCreateDatabaseModal = true;
};

useTitle(computed(() => instance.value.title));

const selectedDatabases = computed((): ComposedDatabase[] => {
  return state.selectedDatabaseNameList
    .map((databaseName) => databaseStore.getDatabaseByName(databaseName))
    .filter((database) => isValidDatabaseName(database.name));
});
</script>
