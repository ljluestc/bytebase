<template>
  <NDataTable
    :columns="columns"
    :data="mixedTableList"
    :row-props="rowProps"
    :max-height="640"
    :virtual-scroll="true"
    :row-key="
      (table: TableMetadata) => `${database.name}.${schemaName}.${table.name}`
    "
    :striped="true"
    :bordered="true"
  />

  <TableDetailDrawer
    :show="!!state.selectedTableName"
    :database-name="database.name"
    :schema-name="schemaName"
    :table-name="state.selectedTableName ?? ''"
    :classification-config="classificationConfig"
    @apply-classification="
      (table: string, id: string) => onClassificationIdApply(table, id)
    "
    @dismiss="state.selectedTableName = undefined"
  />
</template>

<script lang="ts" setup>
import ClassificationCell from "@/components/ColumnDataTable/ClassificationCell.vue";
import { updateTableCatalog } from "@/components/ColumnDataTable/utils";
import {
  featureToRef,
  getTableCatalog,
  useDatabaseCatalog,
  useSettingV1Store,
} from "@/store/modules";
import type { ComposedDatabase } from "@/types";
import { Engine } from "@/types/proto-es/v1/common_pb";
import type { TableMetadata } from "@/types/proto-es/v1/database_service_pb";
import { PlanFeature } from "@/types/proto-es/v1/subscription_service_pb";
import { bytesToString, hasSchemaProperty } from "@/utils";
import type { DataTableColumn } from "naive-ui";
import { NDataTable } from "naive-ui";
import type { PropType } from "vue";
import { computed, h, onMounted, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import TableDetailDrawer from "./TableDetailDrawer.vue";

type LocalState = {
  selectedTableName?: string;
};

const props = defineProps({
  database: {
    required: true,
    type: Object as PropType<ComposedDatabase>,
  },
  schemaName: {
    type: String,
    default: "",
  },
  tableList: {
    required: true,
    type: Object as PropType<TableMetadata[]>,
  },
  search: {
    type: String,
    default: "",
  },
});

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const state = reactive<LocalState>({});
const settingStore = useSettingV1Store();

onMounted(() => {
  const table = route.query.table as string;
  if (table) {
    state.selectedTableName = table;
  }
});

watch(
  () => state.selectedTableName,
  (table) => {
    router.push({
      query: {
        table,
        schema: props.schemaName ? props.schemaName : undefined,
      },
    });
  }
);

const classificationConfig = computed(() => {
  return settingStore.getProjectClassification(
    props.database.projectEntity.dataClassificationConfigId
  );
});

const hasSensitiveDataFeature = featureToRef(PlanFeature.FEATURE_DATA_MASKING);

const engine = computed(() => props.database.instanceResource.engine);

const isPostgres = computed(
  () => engine.value === Engine.POSTGRES || engine.value === Engine.RISINGWAVE
);

const hasEngineProperty = computed(() => {
  return !isPostgres.value;
});

const hasPartitionTables = computed(() => {
  return (
    // Only show partition tables for PostgreSQL.
    engine.value === Engine.POSTGRES
  );
});

const databaseCatalog = useDatabaseCatalog(props.database.name, false);

const columns = computed(() => {
  const columns: (DataTableColumn<TableMetadata> & { hide?: boolean })[] = [
    {
      key: "schema",
      title: t("common.schema"),
      hide: !hasSchemaProperty(engine.value),
      ellipsis: {
        tooltip: true,
      },
      render: () => {
        return props.schemaName || t("db.schema.default");
      },
    },
    {
      key: "name",
      title: t("common.name"),
      ellipsis: {
        tooltip: true,
      },
      render: (row) => {
        return row.name;
      },
    },
    {
      key: "engine",
      title: t("database.engine"),
      hide: !hasEngineProperty.value,
      render: (row) => {
        return row.engine;
      },
    },
    {
      key: "classification",
      title: t("database.classification.self"),
      hide: !hasSensitiveDataFeature.value,
      resizable: true,
      minWidth: 140,
      render: (table) => {
        const tableCatalog = getTableCatalog(
          databaseCatalog.value,
          props.schemaName,
          table.name
        );
        return h(ClassificationCell, {
          classification: tableCatalog.classification,
          classificationConfig: classificationConfig.value,
          engine: engine.value,
          onApply: (id: string) => onClassificationIdApply(table.name, id),
        });
      },
    },
    {
      key: "partitioned",
      title: t("database.partitioned"),
      hide: !hasPartitionTables.value,
      render: (table) => {
        return table.partitions.length > 0 ? "True" : "";
      },
    },
    {
      key: "rowCountEst",
      title: t("database.row-count-est"),
      render: (row) => {
        return String(row.rowCount);
      },
    },
    {
      key: "dataSize",
      title: t("database.data-size"),
      render: (row) => {
        return bytesToString(Number(row.dataSize));
      },
    },
    {
      key: "indexSize",
      title: t("database.index-size"),
      render: (row) => {
        return bytesToString(Number(row.indexSize));
      },
    },
    {
      key: "comment",
      title: t("database.comment"),
      ellipsis: {
        tooltip: true,
      },
      render: (row) => {
        return row.userComment;
      },
    },
  ];

  return columns.filter((column) => !column.hide);
});

const rowProps = (row: TableMetadata) => {
  return {
    style: "cursor: pointer;",
    onClick: () => {
      state.selectedTableName = row.name;
    },
  };
};

const mixedTableList = computed(() => {
  const tableList = props.tableList;
  if (props.search) {
    return tableList.filter((table) => {
      return table.name.toLowerCase().includes(props.search.toLowerCase());
    });
  }
  return tableList;
});

const onClassificationIdApply = async (
  table: string,
  classification: string
) => {
  await updateTableCatalog({
    database: props.database.name,
    schema: props.schemaName,
    table,
    tableCatalog: {
      classification,
    },
  });
};
</script>
