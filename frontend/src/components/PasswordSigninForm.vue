<template>
  <form class="space-y-6 px-1" @submit.prevent="trySignin()">
    <div>
      <label
        for="email"
        class="block text-sm font-medium leading-5 text-control"
      >
        {{ $t("common.email") }}
        <span class="text-red-600">*</span>
      </label>
      <div class="mt-1 rounded-md shadow-sm">
        <BBTextField
          v-model:value="state.email"
          required
          :input-props="{
            id: 'email',
            autocomplete: 'on',
            type: 'email',
          }"
          placeholder="jim@example.com"
        />
      </div>
    </div>

    <div>
      <label
        for="password"
        class="flex justify-between text-sm font-medium leading-5 gap-4 text-control"
      >
        <div>
          {{ $t("common.password") }}
          <span class="text-red-600">*</span>
        </div>
        <router-link
          v-if="props.showForgotPassword"
          :to="{
            path: '/auth/password-forgot',
            query: {
              hint: route.query.hint,
            },
          }"
          class="text-sm font-normal text-control-light hover:underline focus:outline-none"
          tabindex="-1"
        >
          {{ $t("auth.sign-in.forget-password") }}
        </router-link>
      </label>
      <div
        class="relative flex flex-row items-center mt-1 rounded-md shadow-sm"
      >
        <BBTextField
          v-model:value="state.password"
          :type="state.showPassword ? 'text' : 'password'"
          :input-props="{ id: 'password', autocomplete: 'on' }"
          required
        />
        <div
          class="hover:cursor-pointer absolute right-3"
          @click="
            () => {
              state.showPassword = !state.showPassword;
            }
          "
        >
          <EyeIcon v-if="state.showPassword" class="w-4 h-4" />
          <EyeOffIcon v-else class="w-4 h-4" />
        </div>
      </div>
    </div>

    <div class="w-full">
      <NButton
        attr-type="submit"
        type="primary"
        :disabled="!allowSignin"
        :loading="state.isLoading"
        size="large"
        style="width: 100%"
      >
        {{ $t("common.sign-in") }}
      </NButton>
    </div>
  </form>
</template>

<script setup lang="ts">
import { create } from "@bufbuild/protobuf";
import { EyeIcon, EyeOffIcon } from "lucide-vue-next";
import { NButton } from "naive-ui";
import { storeToRefs } from "pinia";
import { computed, reactive, onMounted } from "vue";
import { useRoute } from "vue-router";
import { BBTextField } from "@/bbkit";
import { useAuthStore, useActuatorV1Store } from "@/store";
import { LoginRequestSchema } from "@/types/proto-es/v1/auth_service_pb";

interface LocalState {
  email: string;
  password: string;
  showPassword: boolean;
  isLoading: boolean;
}

const props = withDefaults(
  defineProps<{
    showForgotPassword?: boolean;
  }>(),
  {
    showForgotPassword: true,
  }
);

const route = useRoute();
const authStore = useAuthStore();
const { isDemo } = storeToRefs(useActuatorV1Store());

const state = reactive<LocalState>({
  email: "",
  password: "",
  showPassword: false,
  isLoading: false,
});

onMounted(async () => {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  state.email = params.get("email") ?? (isDemo.value ? "demo@example.com" : "");
  state.password = params.get("password") ?? (isDemo.value ? "12345678" : "");
  state.showPassword = !!isDemo.value;

  // Try to signin with example account in demo site.
  if (
    (window.location.href.startsWith("https://demo.bytebase.com") ||
      window.location.href.startsWith("https://demo.sql-editor.com")) &&
    isDemo.value &&
    state.email &&
    state.password
  ) {
    await trySignin();
  }
});

const allowSignin = computed(() => {
  return state.email && state.password;
});

const trySignin = async () => {
  if (state.isLoading) return;
  state.isLoading = true;
  try {
    await authStore.login(
      create(LoginRequestSchema, {
        email: state.email,
        password: state.password,
        web: true,
      })
    );
  } finally {
    state.isLoading = false;
  }
};
</script>
