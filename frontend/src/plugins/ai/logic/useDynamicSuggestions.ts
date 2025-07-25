import { head, uniq, values } from "lodash-es";
import { computed, reactive, ref } from "vue";
import { create as createProto } from "@bufbuild/protobuf";

import { hashCode } from "@/bbkit/BBUtil";
import { sqlServiceClientConnect } from "@/grpcweb";

import { type AICompletionRequest_Message, AICompletionRequest_MessageSchema, AICompletionRequestSchema } from "@/types/proto-es/v1/sql_service_pb";
import { WebStorageHelper } from "@/utils";
import { useAIContext } from "./context";
import * as promptUtils from "./prompt";

export type SuggestionContext = {
  metadata: string; // schema text
  key: string; // a hash key used by storage
  suggestions: string[];
  ready: boolean;
  state: "LOADING" | "IDLE" | "ENDED";
  used: Set<string>;
  current: () => string | undefined;
  consume: () => void;
  fetch: () => Promise<string[]>; // returns empty means reaches the end
  next: () => Promise<string | undefined>; // returns next suggestion or empty (ended)
};

const cache = ref(new Map<string, SuggestionContext>());
const MAX_STORED_SUGGESTIONS = 10;

const keyOf = (metadata: string) => String(hashCode(metadata));

export const useDynamicSuggestions = () => {
  const context = useAIContext();
  const storage = new WebStorageHelper("bb.plugin.open-ai.suggestions");

  const metadata = computed(() => {
    const meta = context.databaseMetadata.value;
    const engine = context.engine.value;
    const schema = context.schema.value;

    if (meta && engine) {
      return promptUtils.databaseMetadataToText(meta, engine, schema);
    }
    return "";
  });

  const requestAI = async (messages: AICompletionRequest_Message[]) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const request = createProto(AICompletionRequestSchema, { messages });
      const response = await sqlServiceClientConnect.aICompletion(request);
      const text =
        head(head(response.candidates)?.content?.parts)?.text?.trim() ?? "";
      const card = JSON.parse(text) as Record<string, string>;
      return values(card ?? {});
    } catch {
      return [];
    }
  };

  const createSuggestion = (metadata: string) => {
    const suggestion: SuggestionContext = reactive({
      metadata,
      key: keyOf(metadata),
      suggestions: [],
      index: 0,
      state: "IDLE",
      ready: false,
      used: new Set(),
      current() {
        const { suggestions } = suggestion;
        return head(suggestions);
      },
      consume() {
        const { suggestions, used } = suggestion;
        const sug = suggestion.current();
        if (!sug) return;
        suggestions.shift();
        used.add(sug);
        if (suggestions.length === 0) {
          suggestion.fetch();
        }
      },
      async fetch() {
        const { state, used, suggestions, key } = suggestion;
        if (state === "ENDED") return [];

        const { command, prompt } = promptUtils.dynamicSuggestions(
          metadata,
          new Set([...used.values(), ...suggestions])
        );
        const messages: AICompletionRequest_Message[] = [
          createProto(AICompletionRequest_MessageSchema, {
            role: "system",
            content: command,
          }),
          createProto(AICompletionRequest_MessageSchema, {
            role: "user",
            content: prompt,
          }),
        ];
        console.debug("[DynamicSuggestions]");
        console.debug(command);
        console.debug(prompt);

        suggestion.state = "LOADING";
        const response = await requestAI(messages);
        console.debug("[DynamicSuggestions] response", response);
        const more = uniq(
          response.filter((sug) => {
            if (used.has(sug)) return false;
            if (suggestions.includes(sug)) return false;
            return true;
          })
        );
        suggestions.push(...more);
        suggestion.state = more.length === 0 ? "ENDED" : "IDLE";

        const combined = uniq([...suggestions, ...used.values()]).slice(
          0,
          MAX_STORED_SUGGESTIONS
        );
        if (combined.length > 0) {
          storage.save(key, combined);
        }

        return more;
      },
      async next() {
        const originalState = suggestion.state;
        if (originalState === "ENDED") return;
        const curr = suggestion.current();
        if (curr) {
          suggestion.used.add(curr);
        }
        if (suggestion.suggestions.length === 1) {
          await suggestion.fetch();
        }
        suggestion.suggestions.shift();
        return suggestion.current();
      },
    });
    const stored = storage.load<string[]>(suggestion.key, []);
    if (stored && stored.length > 0) {
      suggestion.ready = true;
      suggestion.suggestions = stored;
    } else {
      suggestion.fetch().then(() => {
        suggestion.ready = true;
      });
    }
    cache.value.set(metadata, suggestion);
    return suggestion;
  };

  const getOrCreateSuggestion = (metadata: string) => {
    const cached = cache.value.get(metadata);
    if (cached) return cached;
    return createSuggestion(metadata);
  };

  return computed(() => {
    if (!metadata.value) return undefined;
    return getOrCreateSuggestion(metadata.value);
  });
};
