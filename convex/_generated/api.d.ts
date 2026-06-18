/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appVersion from "../appVersion.js";
import type * as artifacts from "../artifacts.js";
import type * as auth from "../auth.js";
import type * as featureRequests from "../featureRequests.js";
import type * as feedbackClient from "../feedbackClient.js";
import type * as http from "../http.js";
import type * as progress from "../progress.js";
import type * as projects from "../projects.js";
import type * as refinementQuestions from "../refinementQuestions.js";
import type * as scientist from "../scientist.js";
import type * as setupFeedback from "../setupFeedback.js";
import type * as tasks from "../tasks.js";
import type * as todos from "../todos.js";
import type * as tools_ask_user from "../tools/ask_user.js";
import type * as tools_code from "../tools/code.js";
import type * as tools_index from "../tools/index.js";
import type * as tools_literature_search from "../tools/literature_search.js";
import type * as tools_uniprot_lookup from "../tools/uniprot_lookup.js";
import type * as users from "../users.js";
import type * as wow from "../wow.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appVersion: typeof appVersion;
  artifacts: typeof artifacts;
  auth: typeof auth;
  featureRequests: typeof featureRequests;
  feedbackClient: typeof feedbackClient;
  http: typeof http;
  progress: typeof progress;
  projects: typeof projects;
  refinementQuestions: typeof refinementQuestions;
  scientist: typeof scientist;
  setupFeedback: typeof setupFeedback;
  tasks: typeof tasks;
  todos: typeof todos;
  "tools/ask_user": typeof tools_ask_user;
  "tools/code": typeof tools_code;
  "tools/index": typeof tools_index;
  "tools/literature_search": typeof tools_literature_search;
  "tools/uniprot_lookup": typeof tools_uniprot_lookup;
  users: typeof users;
  wow: typeof wow;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  feedback: import("@convex-dev/feedback/_generated/component.js").ComponentApi<"feedback">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  sandbox: import("@convex-dev/sandbox/_generated/component.js").ComponentApi<"sandbox">;
};
