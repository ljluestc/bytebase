import { create } from "@bufbuild/protobuf";
import { createContextValues } from "@connectrpc/connect";
import { computedAsync } from "@vueuse/core";
import { head } from "lodash-es";
import { defineStore } from "pinia";
import type { MaybeRef } from "vue";
import { computed, ref, unref, watch, watchEffect } from "vue";
import { databaseGroupServiceClientConnect } from "@/grpcweb";
import { silentContextKey } from "@/grpcweb/context-key";
import type { ConditionGroupExpr } from "@/plugins/cel";
import {
  buildCELExpr,
  emptySimpleExpr,
  resolveCELExpr,
  wrapAsGroup,
} from "@/plugins/cel";
import type {
  ComposedDatabase,
  ComposedDatabaseGroup,
  ComposedProject,
} from "@/types";
import { ExprSchema } from "@/types/proto-es/google/type/expr_pb";
import type {
  DatabaseGroup,
  DatabaseGroupView,
} from "@/types/proto-es/v1/database_group_service_pb";
import {
  CreateDatabaseGroupRequestSchema,
  DeleteDatabaseGroupRequestSchema,
  GetDatabaseGroupRequestSchema,
  ListDatabaseGroupsRequestSchema,
  UpdateDatabaseGroupRequestSchema,
  DatabaseGroupView as DatabaseGroupViewEnum,
  DatabaseGroupSchema,
} from "@/types/proto-es/v1/database_group_service_pb";
import {
  batchConvertCELStringToParsedExpr,
  batchConvertParsedExprToCELString,
} from "@/utils";
import { useCache } from "../cache";
import { batchGetOrFetchProjects, useProjectV1Store } from "./v1";
import {
  databaseGroupNamePrefix,
  getProjectNameAndDatabaseGroupName,
  projectNamePrefix,
} from "./v1/common";

const batchComposeDatabaseGroup = async (
  databaseGroupList: DatabaseGroup[]
): Promise<ComposedDatabaseGroup[]> => {
  const composedDatabaseGroupMap: Map<string, ComposedDatabaseGroup> =
    new Map();
  const expressions: string[] = [];
  const composedDatabaseGroupNameList: string[] = [];

  const projectStore = useProjectV1Store();

  await batchGetOrFetchProjects(
    databaseGroupList.map((databaseGroup) => {
      const [projectName, _] = getProjectNameAndDatabaseGroupName(
        databaseGroup.name
      );
      return `${projectNamePrefix}${projectName}`;
    })
  );

  for (const databaseGroup of databaseGroupList) {
    const [projectName, _] = getProjectNameAndDatabaseGroupName(
      databaseGroup.name
    );
    const project = projectStore.getProjectByName(
      `${projectNamePrefix}${projectName}`
    );

    composedDatabaseGroupMap.set(databaseGroup.name, {
      ...databaseGroup,
      projectName,
      projectEntity: project,
      simpleExpr: emptySimpleExpr(),
    });

    if (databaseGroup.databaseExpr?.expression) {
      expressions.push(databaseGroup.databaseExpr.expression);
      composedDatabaseGroupNameList.push(databaseGroup.name);
    }
  }

  const exprList = await batchConvertCELStringToParsedExpr(expressions);
  for (let i = 0; i < exprList.length; i++) {
    const databaseGroupName = composedDatabaseGroupNameList[i];

    const celExpr = exprList[i];
    const simpleExpr = resolveCELExpr(celExpr);
    composedDatabaseGroupMap.get(databaseGroupName)!.simpleExpr =
      wrapAsGroup(simpleExpr);
  }

  return [...composedDatabaseGroupMap.values()];
};

type DatabaseGroupCacheKey = [string /* name */, DatabaseGroupView];

export const useDBGroupStore = defineStore("db-group", () => {
  const cacheByName = useCache<DatabaseGroupCacheKey, ComposedDatabaseGroup>(
    "bb.database-group.by-name"
  );

  // Cache utils
  const setDatabaseGroupCache = (
    databaseGroup: ComposedDatabaseGroup,
    view: DatabaseGroupView
  ) => {
    if (view === DatabaseGroupViewEnum.FULL) {
      cacheByName.invalidateEntity([
        databaseGroup.name,
        DatabaseGroupViewEnum.BASIC,
      ]);
    }
    cacheByName.setEntity([databaseGroup.name, view], databaseGroup);
  };

  const getOrFetchDBGroupByName = async (
    name: string,
    options?: Partial<{
      skipCache: boolean;
      silent: boolean;
      view: DatabaseGroupView;
    }>
  ) => {
    const { skipCache, silent, view } = {
      ...{
        skipCache: false,
        silent: false,
        view: DatabaseGroupViewEnum.BASIC,
      },
      ...options,
    };
    if (!skipCache) {
      const cached = cacheByName.getEntity([name, view]);
      if (cached) return cached;
    }

    const request = create(GetDatabaseGroupRequestSchema, {
      name,
      view,
    });
    const databaseGroup =
      await databaseGroupServiceClientConnect.getDatabaseGroup(request, {
        contextValues: createContextValues().set(silentContextKey, silent),
      });
    const composedData = await batchComposeDatabaseGroup([databaseGroup]);
    const response = composedData[0];
    setDatabaseGroupCache(response, view);
    return response;
  };

  const fetchDBGroupListByProjectName = async (projectName: string) => {
    const request = create(ListDatabaseGroupsRequestSchema, {
      parent: projectName,
    });
    const { databaseGroups } =
      await databaseGroupServiceClientConnect.listDatabaseGroups(request);
    const composedList = [];
    const composeDatabaseGroups =
      await batchComposeDatabaseGroup(databaseGroups);
    for (const composedData of composeDatabaseGroups) {
      setDatabaseGroupCache(composedData, DatabaseGroupViewEnum.BASIC);
      composedList.push(composedData);
    }
    return composedList;
  };

  const getDBGroupByName = (
    name: string,
    view?: DatabaseGroupView
  ): ComposedDatabaseGroup | undefined => {
    if (!view) {
      return (
        cacheByName.getEntity([name, DatabaseGroupViewEnum.FULL]) ??
        cacheByName.getEntity([name, DatabaseGroupViewEnum.BASIC])
      );
    }
    return cacheByName.getEntity([name, view]);
  };

  const createDatabaseGroup = async ({
    projectName,
    databaseGroup,
    databaseGroupId,
    validateOnly = false,
  }: {
    projectName: string;
    databaseGroup: Pick<
      DatabaseGroup,
      "$typeName" | "name" | "title" | "databaseExpr"
    >;
    databaseGroupId: string;
    validateOnly?: boolean;
  }) => {
    const newDatabaseGroup = create(DatabaseGroupSchema, {
      name: databaseGroup.name,
      title: databaseGroup.title,
      databaseExpr: databaseGroup.databaseExpr,
      matchedDatabases: [],
      unmatchedDatabases: [],
    });
    const request = create(CreateDatabaseGroupRequestSchema, {
      parent: projectName,
      databaseGroup: newDatabaseGroup,
      databaseGroupId,
      validateOnly,
    });
    const createdDatabaseGroup =
      await databaseGroupServiceClientConnect.createDatabaseGroup(request, {
        contextValues: createContextValues().set(
          silentContextKey,
          validateOnly
        ),
      });
    if (!validateOnly) {
      const composedData = await batchComposeDatabaseGroup([
        createdDatabaseGroup,
      ]);
      setDatabaseGroupCache(composedData[0], DatabaseGroupViewEnum.FULL);
    }
    return createdDatabaseGroup;
  };

  const updateDatabaseGroup = async (
    databaseGroup: DatabaseGroup,
    updateMask: string[]
  ) => {
    const request = create(UpdateDatabaseGroupRequestSchema, {
      databaseGroup,
      updateMask: { paths: updateMask },
    });
    const updatedDatabaseGroup =
      await databaseGroupServiceClientConnect.updateDatabaseGroup(request);
    const composedData = await batchComposeDatabaseGroup([
      updatedDatabaseGroup,
    ]);
    setDatabaseGroupCache(composedData[0], DatabaseGroupViewEnum.FULL);
    return updatedDatabaseGroup;
  };

  const deleteDatabaseGroup = async (name: string) => {
    const request = create(DeleteDatabaseGroupRequestSchema, {
      name: name,
    });
    await databaseGroupServiceClientConnect.deleteDatabaseGroup(request);
    cacheByName.invalidateEntity([name, DatabaseGroupViewEnum.FULL]);
    cacheByName.invalidateEntity([name, DatabaseGroupViewEnum.BASIC]);
  };

  const fetchDatabaseGroupMatchList = async ({
    projectName,
    expr,
  }: {
    projectName: string;
    expr: ConditionGroupExpr;
  }) => {
    const celexpr = await buildCELExpr(expr);
    if (!celexpr) {
      return {
        matchedDatabaseList: [],
        unmatchedDatabaseList: [],
      };
    }
    const celStrings = await batchConvertParsedExprToCELString([celexpr]);
    const expression = head(celStrings) || "true"; // Fallback to true.
    const validateOnlyResourceId = `creating-database-group-${Date.now()}`;

    const result = await createDatabaseGroup({
      projectName: projectName,
      databaseGroup: create(DatabaseGroupSchema, {
        name: `${projectName}/${databaseGroupNamePrefix}${validateOnlyResourceId}`,
        title: validateOnlyResourceId,
        databaseExpr: create(ExprSchema, {
          expression,
        }),
      }),
      databaseGroupId: validateOnlyResourceId,
      validateOnly: true,
    });

    return {
      matchedDatabaseList: result.matchedDatabases.map((item) => item.name),
      unmatchedDatabaseList: result.unmatchedDatabases.map((item) => item.name),
    };
  };

  return {
    getOrFetchDBGroupByName,
    fetchDBGroupListByProjectName,
    getDBGroupByName,
    createDatabaseGroup,
    updateDatabaseGroup,
    deleteDatabaseGroup,
    fetchDatabaseGroupMatchList,
  };
});

export const useDBGroupListByProject = (project: MaybeRef<string>) => {
  const store = useDBGroupStore();
  const ready = ref(false);
  const dbGroupList = ref<ComposedDatabaseGroup[]>([]);

  watchEffect(() => {
    ready.value = false;
    dbGroupList.value = [];
    store.fetchDBGroupListByProjectName(unref(project)).then((response) => {
      ready.value = true;
      dbGroupList.value = response;
    });
  });

  return { dbGroupList, ready };
};

export const useDatabaseInGroupFilter = (
  project: MaybeRef<ComposedProject>,
  referenceDatabase: MaybeRef<ComposedDatabase | undefined>
) => {
  const isPreparingDatabaseGroups = ref(false);

  const databaseGroups = computedAsync(
    async () => {
      const request = create(ListDatabaseGroupsRequestSchema, {
        parent: unref(project).name,
      });
      const response =
        await databaseGroupServiceClientConnect.listDatabaseGroups(request);
      return Promise.all(
        response.databaseGroups.map(async (group) => {
          const getRequest = create(GetDatabaseGroupRequestSchema, {
            name: group.name,
            view: DatabaseGroupViewEnum.FULL,
          });
          return await databaseGroupServiceClientConnect.getDatabaseGroup(
            getRequest
          );
        })
      );
    },
    [],
    {
      evaluating: isPreparingDatabaseGroups,
    }
  );

  const groupsContainRefDB = computed(() => {
    const dbGroups = databaseGroups.value;
    const referenceDB = unref(referenceDatabase);
    if (!referenceDB) {
      return dbGroups;
    }
    return dbGroups.filter((group) => {
      return !!group.matchedDatabases.find(
        (match) => match.name === referenceDB.name
      );
    });
  });

  const databaseFilter = (db: ComposedDatabase) => {
    if (isPreparingDatabaseGroups.value) {
      return false;
    }
    const dbGroups = databaseGroups.value;
    if (!dbGroups) {
      // dbGroups not configured
      // allow all databases
      return true;
    }
    const referenceDB = unref(referenceDatabase);
    if (!referenceDB) {
      // No ref DB
      // allow all databases
      return true;
    }

    if (groupsContainRefDB.value.length === 0) {
      // the referenced DB is not in any group
      // allow all databases
      return true;
    }
    return groupsContainRefDB.value
      .flatMap((group) => group.matchedDatabases.map((match) => match.name))
      .includes(db.name);
  };
  return { isPreparingDatabaseGroups, databaseFilter };
};

export const useDatabaseGroupByName = (name: MaybeRef<string>) => {
  const store = useDBGroupStore();
  const ready = ref(true);
  watch(
    () => unref(name),
    (name) => {
      ready.value = false;
      store.getOrFetchDBGroupByName(name).then(() => {
        ready.value = true;
      });
    },
    { immediate: true }
  );
  const databaseGroup = computed(() => store.getDBGroupByName(unref(name)));

  return {
    databaseGroup,
    ready,
  };
};
