import { v } from "convex/values";
import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
// Feedback tables live in the @convex-dev/feedback component, not here.
export default defineSchema({
  appVersion: defineTable({ version: v.number(), deploymentName: v.string(), deployedAt: v.number() }), ...authTables });
