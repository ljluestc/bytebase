<template>
  <div>
    <h3
      id="domain-restriction"
      class="font-medium flex flex-row justify-start items-center"
    >
      <span class="mr-2">{{
        $t("settings.general.workspace.domain-restriction.self")
      }}</span>
    </h3>
    <p class="text-sm text-gray-400 mt-1">
      {{ $t("settings.general.workspace.domain-restriction.description") }}
    </p>
    <div class="w-full flex flex-col gap-2 mt-2">
      <div
        v-for="(domain, i) in state.domains"
        :key="i"
        class="w-full flex items-center justify-center space-x-1"
      >
        <NInput
          :value="domain"
          :disabled="!allowEdit"
          :placeholder="
            $t(
              'settings.general.workspace.domain-restriction.domain-input-placeholder'
            )
          "
          type="text"
          @update:value="($event) => updateDomain(i, $event)"
        />
        <NButton quaternary size="small" @click="removeDomain(i)">
          <template #icon>
            <XIcon class="w-4" />
          </template>
        </NButton>
      </div>
      <div>
        <NButton tertiary size="small" @click="addDomain">
          <template #icon>
            <PlusIcon class="w-4" />
          </template>
          Add domain
        </NButton>
      </div>

      <div class="w-full flex flex-row justify-between items-center">
        <NCheckbox
          v-model:checked="state.enableRestriction"
          :disabled="validDomains.length === 0 || !hasFeature || !allowEdit"
        >
          <div class="font-medium flex items-center gap-x-2">
            {{
              $t(
                "settings.general.workspace.domain-restriction.members-restriction.self"
              )
            }}
            <FeatureBadge
              :feature="PlanFeature.FEATURE_USER_EMAIL_DOMAIN_RESTRICTION"
            />
          </div>
          <p class="text-sm text-gray-400 leading-tight">
            {{
              $t(
                "settings.general.workspace.domain-restriction.members-restriction.description"
              )
            }}
          </p>
        </NCheckbox>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { isEqual, cloneDeep } from "lodash-es";
import { PlusIcon, XIcon } from "lucide-vue-next";
import { NCheckbox, NInput, NButton } from "naive-ui";
import { computed, reactive } from "vue";
import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { featureToRef } from "@/store";
import { useSettingV1Store } from "@/store/modules/v1/setting";
import { PlanFeature } from "@/types/proto-es/v1/subscription_service_pb";
import { FeatureBadge } from "../FeatureGuard";

const initialState = computed((): LocalState => {
  const defaultState: LocalState = {
    domains: [],
    enableRestriction: false,
  };
  if (Array.isArray(settingV1Store.workspaceProfileSetting?.domains)) {
    defaultState.domains = [...settingV1Store.workspaceProfileSetting?.domains];
    defaultState.enableRestriction =
      settingV1Store.workspaceProfileSetting?.enforceIdentityDomain || false;
  }
  return defaultState;
});

interface LocalState {
  domains: string[];
  enableRestriction: boolean;
}

defineProps<{
  allowEdit: boolean;
}>();

const settingV1Store = useSettingV1Store();
const state = reactive<LocalState>(cloneDeep(initialState.value));

const hasFeature = featureToRef(
  PlanFeature.FEATURE_USER_EMAIL_DOMAIN_RESTRICTION
);

const updateDomain = (index: number, domain: string) => {
  state.domains[index] = domain;
};

const addDomain = () => {
  state.domains.push("");
};

const removeDomain = (index: number) => {
  state.domains.splice(index, 1);
  if (validDomains.value.length === 0) {
    state.enableRestriction = false;
  }
};

const validDomains = computed(() => {
  return state.domains.filter((domain) => !!domain);
});

defineExpose({
  isDirty: computed(
    () =>
      !isEqual(
        {
          ...state,
          domains: validDomains.value,
        },
        initialState.value
      )
  ),
  update: async () => {
    if (validDomains.value.length === 0) {
      state.enableRestriction = false;
    }
    const updateMask: string[] = [];
    if (initialState.value.enableRestriction !== state.enableRestriction) {
      updateMask.push(
        "value.workspace_profile_setting_value.enforce_identity_domain"
      );
    }

    if (!isEqual(validDomains.value, initialState.value.domains)) {
      updateMask.push("value.workspace_profile_setting_value.domains");
    }
    if (updateMask.length > 0) {
      await settingV1Store.updateWorkspaceProfile({
        payload: {
          domains: validDomains.value,
          enforceIdentityDomain: state.enableRestriction,
        },
        updateMask: create(FieldMaskSchema, { paths: updateMask }),
      });
    }
  },
  revert: () => {
    Object.assign(state, initialState.value);
  },
});
</script>
