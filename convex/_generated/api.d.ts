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
import type * as auth from "../auth.js";
import type * as featureRequests from "../featureRequests.js";
import type * as feedbackClient from "../feedbackClient.js";
import type * as http from "../http.js";
import type * as progress from "../progress.js";
import type * as refinementQuestions from "../refinementQuestions.js";
import type * as setupFeedback from "../setupFeedback.js";
import type * as todos from "../todos.js";
import type * as users from "../users.js";
import type * as wow from "../wow.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appVersion: typeof appVersion;
  auth: typeof auth;
  featureRequests: typeof featureRequests;
  feedbackClient: typeof feedbackClient;
  http: typeof http;
  progress: typeof progress;
  refinementQuestions: typeof refinementQuestions;
  setupFeedback: typeof setupFeedback;
  todos: typeof todos;
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
};
