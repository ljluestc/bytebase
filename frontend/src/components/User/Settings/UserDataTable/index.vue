<template>
  <NDataTable
    key="user-table"
    :columns="columns"
    :data="userList"
    :loading="loading"
    :striped="true"
    :bordered="true"
    :row-key="(data: User) => data.name"
  />

  <BBAlert
    v-model:show="state.showResetKeyAlert"
    type="warning"
    :ok-text="$t('settings.members.reset-service-key')"
    :title="$t('settings.members.reset-service-key')"
    :description="$t('settings.members.reset-service-key-alert')"
    @ok="resetServiceKey"
    @cancel="state.showResetKeyAlert = false"
  />
</template>

<script lang="ts" setup>
import type { DataTableColumn } from "naive-ui";
import { NDataTable } from "naive-ui";
import { computed, reactive, h } from "vue";
import { useI18n } from "vue-i18n";
import { BBAlert } from "@/bbkit";
import { useUserStore, useWorkspaceV1Store, pushNotification } from "@/store";
import type { Group } from "@/types/proto-es/v1/group_service_pb";
import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { type User, UpdateUserRequestSchema } from "@/types/proto-es/v1/user_service_pb";
import { toClipboard } from "@/utils";
import GroupsCell from "./cells/GroupsCell.vue";
import UserNameCell from "./cells/UserNameCell.vue";
import UserOperationsCell from "./cells/UserOperationsCell.vue";
import UserRolesCell from "./cells/UserRolesCell.vue";

interface LocalState {
  showResetKeyAlert: boolean;
  targetServiceAccount?: User;
}

defineOptions({
  name: "UserDataTable",
});

const props = defineProps<{
  showRoles: boolean;
  userList: User[];
  loading: boolean;
  onClickUser?: (user: User, event: MouseEvent) => void;
}>();

const emit = defineEmits<{
  (event: "update-user", user: User): void;
  (event: "select-group", group: Group): void;
}>();

const { t } = useI18n();
const userStore = useUserStore();
const workspaceStore = useWorkspaceV1Store();

const state = reactive<LocalState>({
  showResetKeyAlert: false,
});

const columns = computed(() => {
  const columns: (DataTableColumn<User> & { hide?: boolean })[] = [
    {
      key: "account",
      title: t("settings.members.table.account"),
      width: "32rem",
      resizable: true,
      render: (user) => {
        return h(UserNameCell, {
          user,
          "onReset-service-key": tryResetServiceKey,
          "on-click-user": props.onClickUser,
        });
      },
    },
    {
      key: "roles",
      title: t("settings.members.table.role"),
      resizable: true,
      hide: !props.showRoles,
      render: (user: User) => {
        return h(UserRolesCell, {
          roles: [...workspaceStore.getWorkspaceRolesByEmail(user.email)],
        });
      },
    },
    {
      key: "groups",
      title: t("settings.members.table.groups"),
      resizable: true,
      render: (user: User) => {
        return h(GroupsCell, {
          user,
          "onSelect-group": (group) => emit("select-group", group),
        });
      },
    },
    {
      key: "operations",
      title: "",
      width: "4rem",
      render: (user: User) => {
        return h(UserOperationsCell, {
          user,
          "onClick-user": (user: User, e: MouseEvent) => {
            if (props.onClickUser) {
              props.onClickUser(user, e);
            }
          },
          "onUpdate-user": (user: User) => {
            emit("update-user", user);
          },
        });
      },
    },
  ];
  return columns.filter((column) => !column.hide);
});

const tryResetServiceKey = (user: User) => {
  state.showResetKeyAlert = true;
  state.targetServiceAccount = user;
};

const resetServiceKey = () => {
  state.showResetKeyAlert = false;
  const user = state.targetServiceAccount;

  if (!user) {
    return;
  }
  userStore
    .updateUser(create(UpdateUserRequestSchema, {
      user,
      updateMask: create(FieldMaskSchema, {
        paths: ["service_key"]
      }),
      regenerateRecoveryCodes: false,
      regenerateTempMfaSecret: false,
    }))
    .then((updatedUser) => {
      if (updatedUser.serviceKey) {
        toClipboard(updatedUser.serviceKey).then(() => {
          pushNotification({
            module: "bytebase",
            style: "INFO",
            title: t("settings.members.service-key-copied"),
          });
        });
      }
    });
};
</script>
