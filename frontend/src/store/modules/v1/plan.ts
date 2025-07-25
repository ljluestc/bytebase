import dayjs from "dayjs";
import { uniq } from "lodash-es";
import { defineStore } from "pinia";
import { create } from "@bufbuild/protobuf";
import { planServiceClientConnect } from "@/grpcweb";
import {
  SearchPlansRequestSchema,
  GetPlanRequestSchema,
} from "@/types/proto-es/v1/plan_service_pb";
import type { Plan } from "@/types/proto-es/v1/plan_service_pb";
import {
  getTsRangeFromSearchParams,
  getValueFromSearchParams,
  type SearchParams,
} from "@/utils";
import { useUserStore } from "../user";

export interface PlanFind {
  project: string;
  creator?: string;
  createdTsAfter?: number;
  createdTsBefore?: number;
  hasIssue?: boolean;
  hasPipeline?: boolean;
}

export const buildPlanFilter = (find: PlanFind): string => {
  const filter: string[] = [];
  if (find.creator) {
    filter.push(`creator == "${find.creator}"`);
  }
  if (find.createdTsAfter) {
    filter.push(
      `create_time >= "${dayjs(find.createdTsAfter).utc().format()}"`
    );
  }
  if (find.createdTsBefore) {
    filter.push(
      `create_time <= "${dayjs(find.createdTsBefore).utc().format()}"`
    );
  }
  if (find.hasIssue !== undefined) {
    filter.push(`has_issue == ${find.hasIssue}`);
  }
  if (find.hasPipeline !== undefined) {
    filter.push(`has_pipeline == ${find.hasPipeline}`);
  }
  return filter.join(" && ");
};

export const buildPlanFindBySearchParams = (
  params: SearchParams,
  defaultFind?: Partial<PlanFind>
) => {
  const { scopes } = params;
  const projectScope = scopes.find((s) => s.id === "project");

  const createdTsRange = getTsRangeFromSearchParams(params, "created");

  const filter: PlanFind = {
    ...defaultFind,
    project: `projects/${projectScope?.value ?? "-"}`,
    createdTsAfter: createdTsRange?.[0],
    createdTsBefore: createdTsRange?.[1],
    creator: getValueFromSearchParams(params, "creator", "users/"),
  };
  return filter;
};

export type ListPlanParams = {
  find: PlanFind;
  pageSize?: number;
  pageToken?: string;
};

export const usePlanStore = defineStore("plan", () => {
  const searchPlans = async ({ find, pageSize, pageToken }: ListPlanParams) => {
    const request = create(SearchPlansRequestSchema, {
      parent: find.project,
      filter: buildPlanFilter(find),
      pageSize,
      pageToken,
    });
    const resp = await planServiceClientConnect.searchPlans(request);
    const plans = resp.plans;
    // Prepare creator for the plans.
    const users = uniq(plans.map((plan) => plan.creator));
    await useUserStore().batchGetUsers(users);
    return {
      nextPageToken: resp.nextPageToken,
      plans,
    };
  };

  const fetchPlanByName = async (name: string): Promise<Plan> => {
    const request = create(GetPlanRequestSchema, {
      name,
    });
    const response = await planServiceClientConnect.getPlan(request);
    return response;
  };

  return {
    searchPlans,
    fetchPlanByName,
  };
});
