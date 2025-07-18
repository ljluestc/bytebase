<template>
  <BBModal
    :title="
      $t('subscription.request-n-days-trial', {
        days: subscriptionStore.trialingDays,
      })
    "
    @close="$emit('cancel')"
  >
    <div class="min-w-0 md:min-w-400">
      <p class="whitespace-pre-wrap">
        <i18n-t keypath="subscription.trial-for-plan">
          <template #days>
            {{ subscriptionStore.trialingDays }}
          </template>
          <template #plan>
            <span class="font-bold text-accent">
              {{
                $t(`subscription.plan.enterprise.title`)
              }}
            </span>
          </template>
        </i18n-t>
      </p>
      <div class="mt-7 flex justify-end">
        <NButton
          v-if="subscriptionStore.showTrial"
          type="primary"
          @click.prevent="trialSubscription"
        >
          {{
            $t("subscription.request-n-days-trial", {
              days: subscriptionStore.trialingDays,
            })
          }}
        </NButton>
        <NButton v-else type="primary" @click.prevent="learnMore">
          {{ $t("common.learn-more") }}
        </NButton>
      </div>
    </div>
  </BBModal>
  <WeChatQRModal
    v-if="state.showQRCodeModal"
    :title="$t('subscription.request-with-qr')"
    @close="state.showQRCodeModal = false"
  />
</template>

<script lang="ts" setup>
import { BBModal } from "@/bbkit";
import { useLanguage } from "@/composables/useLanguage";
import { SETTING_ROUTE_WORKSPACE_SUBSCRIPTION } from "@/router/dashboard/workspaceSetting";
import { useSubscriptionV1Store } from "@/store";
import { ENTERPRISE_INQUIRE_LINK } from "@/types";
import { NButton } from "naive-ui";
import { reactive } from "vue";
import { useRouter } from "vue-router";
import WeChatQRModal from "./WeChatQRModal.vue";

interface LocalState {
  showQRCodeModal: boolean;
}

const state = reactive<LocalState>({
  showQRCodeModal: false,
});

defineEmits<{
  (event: "cancel"): void;
}>();

const router = useRouter();
const { locale } = useLanguage();

const subscriptionStore = useSubscriptionV1Store();

const learnMore = () => {
  router.push({ name: SETTING_ROUTE_WORKSPACE_SUBSCRIPTION });
};

const trialSubscription = () => {
  if (locale.value === "zh-CN") {
    state.showQRCodeModal = true;
  } else {
    window.open(ENTERPRISE_INQUIRE_LINK, "_blank");
  }
};
</script>
